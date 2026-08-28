import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { LearningProgressService } from '../learning-progress/learning-progress.service';
import { LearnerSignalsService } from '../learner-signals/learner-signals.service';
import { DailyMissionService } from '../daily-mission/daily-mission.service';
import { ReviewMasteryService } from './review-mastery.service';
import {
  ActivityAttemptRequestConflictError,
  ReviewCandidateNotAvailableError,
  ReviewSessionActivityNotAvailableError,
  ReviewSessionAlreadyCompletedError,
  ReviewSessionNoReviewableActivityError,
  ReviewSessionNotFoundError,
  ReviewSessionNotReadyError,
} from '../common/errors';
import { ReviewService } from '../review/review.service';
import { parseInteractiveActivity, scoreInteractive, canonicalizeInteractive, projectInteractiveForLearner, type InteractiveActivity } from '../content/activity/activity-interaction';
import { isObjectiveActivityType } from '../content/activity/activity-registry';
import { ActivityType } from '@prisma/client';
import { ReviewSessionRepository } from './review-session.repository';
import { REVIEW_SESSION_EVIDENCE_SCHEMA, selectReviewActivities } from './selection/review-activity-selection';

type AttemptRow = Awaited<ReturnType<ReviewSessionRepository['findAttemptByClientRequest']>>;

/**
 * Review Session execution (Phase 1.9B-2). Explicit learner-triggered reinforcement for ONE Skill + ONE
 * encountered logical Lesson. Writes only LearnerReviewSession / its activity snapshot / review-provenance
 * ActivityAttempt. NEVER touches LessonProgress / LessonCompletion / SkillMeasurement / SkillState / Roadmap /
 * DailyPlan / signals / rewards (TD-125/126/127).
 */
@Injectable()
export class ReviewSessionService {
  private readonly logger = new Logger('ReviewSession');

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: ReviewSessionRepository,
    private readonly reviewCandidates: ReviewService,
    private readonly reviewMastery: ReviewMasteryService,
    private readonly learningProgress: LearningProgressService,
    private readonly signals: LearnerSignalsService,
    private readonly missions: DailyMissionService,
  ) {}

  /** Start (or resume) a review session for a currently-valid candidate. Idempotent per (user, skill, lesson). */
  async start(userId: string, subjectId: string, skillId: string, lessonId: string) {
    // Urgent-takedown gate (§5): a taken-down (ARCHIVED) Lesson/hierarchy is not a valid review candidate — deny
    // start AND resume, indistinguishably from an unencountered lesson. Never leak that hidden content exists.
    if (!(await this.repo.isLessonAccessible(lessonId))) throw new ReviewCandidateNotAvailableError('review candidate not available');
    const sessionId = await this.prisma.$transaction(async (tx) => {
      await this.repo.advisoryLock(tx, userId, skillId, lessonId); // serialize NEW creation (§32)
      const existing = await this.repo.findActiveSession(tx, userId, skillId, lessonId);
      if (existing) return existing.id; // resume — no candidate/signal revalidation for an already-started session (§31)

      // NEW session: revalidate the 1.9A candidate from scratch (§16/17).
      const { signalTypes } = await this.reviewCandidates.assertCandidateAvailable(userId, subjectId, skillId, lessonId);
      const revisionId = await this.repo.encounteredRevisionId(userId, lessonId); // completion wins (§18)
      if (!revisionId) throw new ReviewCandidateNotAvailableError('lesson not encountered');

      const [activities, hasLessonSkill, triggerIds] = await Promise.all([
        this.repo.selectionActivities(revisionId, skillId),
        this.repo.lessonHasSkill(lessonId, skillId),
        this.repo.triggerActivityIds(userId, skillId),
      ]);
      const orderedActivityIds = selectReviewActivities(activities, hasLessonSkill, triggerIds); // pure (§23/24/26)
      if (orderedActivityIds.length === 0) throw new ReviewSessionNoReviewableActivityError('no reviewable activity');

      const provenance = { schemaVersion: REVIEW_SESSION_EVIDENCE_SCHEMA, signalTypes }; // §4/20 provenance only
      try {
        return await this.repo.createSession(tx, { userId, skillId, lessonId, lessonRevisionId: revisionId, provenance, orderedActivityIds });
      } catch (e) {
        if (this.repo.isUniqueViolation(e)) {
          const winner = await this.repo.findActiveSession(tx, userId, skillId, lessonId); // concurrent start (§32)
          if (winner) return winner.id;
        }
        throw e;
      }
    });
    return this.getSession(userId, sessionId);
  }

  /**
   * V2 entry: start (or resume) a review for a target the caller has already resolved AND authorized (e.g. the V2
   * roadmap, which gates on point acquisition + skill membership). Reuses the ENTIRE review aggregate + finalize
   * (snapshot pinning, submit, complete, REVIEW_MASTERY, recompute, signal resolution) — the only difference from
   * start() is the gate: no V1 encountered-candidate revalidation, and the encountered revision is supplied.
   */
  async startForResolvedTarget(
    userId: string,
    target: { subjectId: string; skillId: string; lessonId: string; lessonRevisionId: string; signalTypes: string[] },
  ) {
    const { skillId, lessonId, lessonRevisionId, signalTypes } = target;
    if (!(await this.repo.isLessonAccessible(lessonId))) throw new ReviewCandidateNotAvailableError('review candidate not available');
    const sessionId = await this.prisma.$transaction(async (tx) => {
      await this.repo.advisoryLock(tx, userId, skillId, lessonId);
      const existing = await this.repo.findActiveSession(tx, userId, skillId, lessonId);
      if (existing) return existing.id; // resume the same pinned session (§31/38)

      const [activities, hasLessonSkill, triggerIds] = await Promise.all([
        this.repo.selectionActivities(lessonRevisionId, skillId),
        this.repo.lessonHasSkill(lessonId, skillId),
        this.repo.triggerActivityIds(userId, skillId),
      ]);
      const orderedActivityIds = selectReviewActivities(activities, hasLessonSkill, triggerIds);
      if (orderedActivityIds.length === 0) throw new ReviewSessionNoReviewableActivityError('no reviewable activity');

      const provenance = { schemaVersion: REVIEW_SESSION_EVIDENCE_SCHEMA, signalTypes };
      try {
        return await this.repo.createSession(tx, { userId, skillId, lessonId, lessonRevisionId, provenance, orderedActivityIds });
      } catch (e) {
        if (this.repo.isUniqueViolation(e)) {
          const winner = await this.repo.findActiveSession(tx, userId, skillId, lessonId);
          if (winner) return winner.id;
        }
        throw e;
      }
    });
    return this.getSession(userId, sessionId);
  }

  /** Learner-safe review session projection (§34/35). No candidate re-evaluation for an already-started session. */
  async getSession(userId: string, sessionId: string) {
    const session = await this.repo.ownSession(userId, sessionId);
    if (!session) throw new ReviewSessionNotFoundError('review session not found'); // 404-safe IDOR (§88)
    // Urgent-takedown gate (§5): hidden Lesson/hierarchy → 404-safe, indistinguishable from a non-existent session.
    if (!(await this.repo.isLessonAccessible(session.lessonId))) throw new ReviewSessionNotFoundError('review session not found');
    const [activities, summary, measurement] = await Promise.all([this.repo.sessionActivities(sessionId), this.repo.attemptSummary(sessionId), this.repo.reviewMeasurement(sessionId)]);
    return {
      id: session.id,
      status: session.status,
      skill: { id: session.skill.id, name: session.skill.name },
      lesson: { id: session.lessonId },
      lessonRevisionId: session.lessonRevisionId,
      startedAt: session.startedAt.toISOString(),
      completedAt: session.completedAt ? session.completedAt.toISOString() : null,
      mastery: measurement // §49/50 learner-safe summary only (no raw attempts/answers/thresholds)
        ? { measured: true, skillId: measurement.skillId, scoreBp: measurement.scoreBp, confidenceBp: measurement.confidenceBp, evidenceCount: measurement.evidenceCount, displayLevel: null }
        : { measured: false },
      activities: activities.map((a) => {
        const s = summary.get(a.activity.id);
        return {
          ...this.projectActivity(a.activity.id, a.activity.type, a.position, a.activity.payload),
          attempted: !!s,
          attemptCount: s?.attemptCount ?? 0,
          bestDeterministicScore: s?.bestDeterministicScore ?? 0,
        };
      }),
    };
  }

  /** Submit an objective review attempt; server scores + records with reviewSessionId provenance (§37-39). */
  async submitAttempt(userId: string, sessionId: string, activityId: string, clientRequestId: string, answer: Record<string, unknown>) {
    const view = await this.persistReviewAttempt(userId, sessionId, activityId, clientRequestId, answer);
    // Phase 2.0B: review attempts are legitimate objective evidence → advisory daily-mission evaluation (§9/23).
    try {
      await this.missions.evaluateActivityAttempt(userId, view.attemptId);
    } catch {
      this.logger.warn(`mission evaluation deferred for review attempt ${view.attemptId}`);
    }
    return view;
  }

  private async persistReviewAttempt(userId: string, sessionId: string, activityId: string, clientRequestId: string, answer: Record<string, unknown>) {
    const session = await this.repo.ownSession(userId, sessionId);
    if (!session) throw new ReviewSessionNotFoundError('review session not found');
    // Urgent-takedown gate (§5): deny objective review submission on a hidden Lesson/hierarchy, before any scoring or
    // attempt create; do not leak that the content exists. History rows are left intact (no delete/cancel/repin).
    if (!(await this.repo.isLessonAccessible(session.lessonId))) throw new ReviewSessionActivityNotAvailableError('activity not available');
    if (session.status !== 'ACTIVE') throw new ReviewSessionAlreadyCompletedError('session already completed');

    const member = await this.repo.sessionActivity(sessionId, activityId); // snapshot membership is authority (§38)
    if (!member) throw new ReviewSessionActivityNotAvailableError('activity not in session');
    const activity = await this.repo.activityById(activityId);
    if (!activity || activity.lessonRevisionId !== session.lessonRevisionId || !isObjectiveActivityType(activity.type)) throw new ReviewSessionActivityNotAvailableError('activity not available'); // cross-revision / type (§29)

    const interactive = parseInteractiveActivity(activity.payload); // ACTIVITY_PAYLOAD_INVALID (safe) — choice OR structured
    const scored = scoreInteractive(interactive, answer); // ACTIVITY_INVALID_RESPONSE
    const canonical = canonicalizeInteractive(interactive, answer);

    const prior = await this.repo.findAttemptByClientRequest(userId, clientRequestId); // durable idempotency (§41)
    if (prior) return this.replayOrConflict(prior, sessionId, activityId, interactive, canonical);

    for (let tries = 0; tries < 6; tries++) {
      const attemptNo = (await this.repo.maxAttemptNo(userId, activityId)) + 1; // shared normal+review sequence (§42)
      try {
        const attempt = await this.repo.createReviewAttempt({ userId, activityId, lessonRevisionId: session.lessonRevisionId, reviewSessionId: sessionId, attemptNo, answer: answer as never, isCorrect: scored.isCorrect, deterministicScore: scored.deterministicScore, clientRequestId, submittedAt: new Date() });
        return this.attemptView(attempt);
      } catch (e) {
        if (!this.repo.isUniqueViolation(e)) throw e;
        const byReq = await this.repo.findAttemptByClientRequest(userId, clientRequestId);
        if (byReq) return this.replayOrConflict(byReq, sessionId, activityId, interactive, canonical); // concurrent same request
        // else attemptNo raced with a different request — retry with a fresh number.
      }
    }
    throw new ReviewSessionActivityNotAvailableError('attempt could not be recorded'); // defensive
  }

  /** Complete when every selected activity has ≥1 review-linked SUBMITTED attempt. Correctness never gates (§46/50). */
  async complete(userId: string, sessionId: string) {
    const session = await this.repo.ownSession(userId, sessionId);
    if (!session) throw new ReviewSessionNotFoundError('review session not found');
    // Urgent-takedown gate (§5): deny completion (including idempotent recovery) on a hidden Lesson/hierarchy, before
    // any completion processing; do not leak that the content exists. Session/history rows are left intact.
    if (!(await this.repo.isLessonAccessible(session.lessonId))) throw new ReviewSessionActivityNotAvailableError('activity not available');
    if (session.status === 'COMPLETED') {
      await this.finalizeReview(userId, sessionId, session.skillId); // idempotent recovery — ensure downstream materialized (§31)
      return this.getSession(userId, sessionId);
    }

    const [activities, summary] = await Promise.all([this.repo.sessionActivities(sessionId), this.repo.attemptSummary(sessionId)]);
    if (!activities.every((a) => summary.has(a.activity.id))) throw new ReviewSessionNotReadyError('not all activities attempted'); // §40/47
    await this.repo.markCompleted(sessionId, new Date()); // Phase A: conditional ACTIVE→COMPLETED (§48/49)
    await this.finalizeReview(userId, sessionId, session.skillId); // Phases B/C/D
    return this.getSession(userId, sessionId);
  }

  /**
   * Downstream, idempotent, recoverable (§30/31/40): B ensure REVIEW_MASTERY measurement → C recompute current
   * state (merge-v2, which also fires WEAK_SKILL/REVIEW_DUE evaluation) → D repeated-mistake reconcile. A failure
   * never rolls back the authoritative COMPLETED session; reconcile/retry repairs it. Review writes only
   * SkillMeasurement; state via LearningProgress (single writer), signals via LearnerSignals only.
   */
  private async finalizeReview(userId: string, sessionId: string, skillId: string): Promise<void> {
    try {
      await this.reviewMastery.ensureDerived(userId, sessionId); // B
      await this.learningProgress.recomputeSkills(userId, [skillId]); // C — merge-v2 + state-signal (WEAK/REVIEW) hook (§34/35)
      await this.signals.evaluateSkills(userId, [skillId]); // D — REPEATED_MISTAKE reconcile from latest outcomes (§38)
    } catch {
      this.logger.warn(`review materialization deferred for session ${sessionId}`);
    }
  }

  // ── internal ──

  private replayOrConflict(prior: NonNullable<AttemptRow>, sessionId: string, activityId: string, interactive: InteractiveActivity, canonical: string) {
    if (prior.reviewSessionId === sessionId && prior.activityId === activityId && canonicalizeInteractive(interactive, prior.answer) === canonical) return this.attemptView(prior); // idempotent replay
    throw new ActivityAttemptRequestConflictError('client request id already used with a different submission'); // §41
  }

  private attemptView(a: NonNullable<AttemptRow>) {
    return { attemptId: a.id, activityId: a.activityId, attemptNo: a.attemptNo, isCorrect: a.isCorrect === true, deterministicScore: a.deterministicScore ?? 0, status: a.status, reviewSessionId: a.reviewSessionId, submittedAt: a.submittedAt ? a.submittedAt.toISOString() : null };
  }

  private projectActivity(id: string, type: ActivityType, position: number, rawPayload: unknown) {
    try {
      return projectInteractiveForLearner(id, type, position, parseInteractiveActivity(rawPayload)); // learner-safe: no answerKey / accepted set (§35)
    } catch {
      return { id, type, position }; // malformed payload → metadata only, never leak
    }
  }
}
