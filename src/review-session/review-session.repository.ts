import { Injectable } from '@nestjs/common';
import { ActivityAttemptStatus, Prisma, ReviewSessionStatus, SignalStatus, SkillMeasurementSource } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { REVIEW_MASTERY_DERIVATION_VERSION } from './mastery/review-mastery.engine';
import { OBJECTIVE_ACTIVITY_TYPES } from '../content/activity/activity-registry';
import { resumableLessonWhere } from '../content/visibility/learner-content-visibility';
import { parseTriggerActivityIds, REPEATED_MISTAKE_SIGNAL_TYPE } from '../learner-signals/repeated-mistake.detector';
import { SelectionActivity } from './selection/review-activity-selection';

const OBJECTIVE_TYPE_LIST = [...OBJECTIVE_ACTIVITY_TYPES];

export interface CreateReviewAttemptData {
  userId: string;
  activityId: string;
  lessonRevisionId: string;
  reviewSessionId: string;
  attemptNo: number;
  answer: Prisma.InputJsonValue;
  isCorrect: boolean;
  deterministicScore: number;
  clientRequestId: string;
  submittedAt: Date;
}

const ATTEMPT_VIEW = { id: true, activityId: true, attemptNo: true, isCorrect: true, deterministicScore: true, status: true, submittedAt: true, reviewSessionId: true, answer: true } as const;

/** Review Session persistence. Writes ONLY LearnerReviewSession / LearnerReviewSessionActivity /
 *  ActivityAttempt(reviewSessionId). Never mutates progress/completion/skill state/roadmap/plan/signals. */
@Injectable()
export class ReviewSessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Urgent-takedown gate (Phase 2.2B §5): Lesson + full hierarchy still learner-accessible (canonical authority). */
  async isLessonAccessible(lessonId: string): Promise<boolean> {
    return (await this.prisma.lesson.findFirst({ where: resumableLessonWhere(lessonId), select: { id: true } })) !== null;
  }

  /** Review-namespaced per (user, skill, lesson) serialization (§32). Distinct keyspace; released at commit. */
  async advisoryLock(tx: Prisma.TransactionClient, userId: string, skillId: string, lessonId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'rev:' + userId + ':' + skillId}), hashtext(${lessonId}))`;
  }

  findActiveSession(tx: Prisma.TransactionClient, userId: string, skillId: string, lessonId: string) {
    return tx.learnerReviewSession.findFirst({ where: { userId, skillId, lessonId, status: ReviewSessionStatus.ACTIVE }, select: { id: true } });
  }

  /** Encountered revision authority (§18): Completion wins over Progress; null → not encountered. */
  async encounteredRevisionId(userId: string, lessonId: string): Promise<string | null> {
    const completion = await this.prisma.learnerLessonCompletion.findFirst({ where: { userId, lessonId }, select: { lessonRevisionId: true } });
    if (completion) return completion.lessonRevisionId;
    const progress = await this.prisma.learnerLessonProgress.findUnique({ where: { userId_lessonId: { userId, lessonId } }, select: { lessonRevisionId: true } });
    return progress?.lessonRevisionId ?? null;
  }

  /** Supported objective activities in the pinned encountered revision, with target-Skill attribution flags (§23). */
  async selectionActivities(revisionId: string, targetSkillId: string): Promise<SelectionActivity[]> {
    const rows = await this.prisma.activity.findMany({
      where: { lessonRevisionId: revisionId, type: { in: OBJECTIVE_TYPE_LIST } },
      select: { id: true, position: true, skills: { select: { skillId: true } } },
      orderBy: { position: 'asc' },
    });
    return rows.map((a) => ({ activityId: a.id, position: a.position, hasAnyActivitySkill: a.skills.length > 0, attributedToTarget: a.skills.some((s) => s.skillId === targetSkillId) }));
  }

  async lessonHasSkill(lessonId: string, skillId: string): Promise<boolean> {
    return (await this.prisma.lessonSkill.findFirst({ where: { lessonId, skillId }, select: { id: true } })) !== null;
  }

  /** Trigger Activity ids from the ACTIVE REPEATED_MISTAKE signal (strict parser; ordering provenance only, §26). */
  async triggerActivityIds(userId: string, skillId: string): Promise<string[]> {
    const signal = await this.prisma.learnerSignal.findFirst({ where: { userId, skillId, type: REPEATED_MISTAKE_SIGNAL_TYPE, status: SignalStatus.ACTIVE }, select: { evidenceRefs: true } });
    return signal ? parseTriggerActivityIds(signal.evidenceRefs) : [];
  }

  /** Atomic create: session header + immutable ordered activity snapshot (§29). */
  async createSession(tx: Prisma.TransactionClient, data: { userId: string; skillId: string; lessonId: string; lessonRevisionId: string; provenance: Prisma.InputJsonValue; orderedActivityIds: string[] }): Promise<string> {
    const session = await tx.learnerReviewSession.create({
      data: { userId: data.userId, skillId: data.skillId, lessonId: data.lessonId, lessonRevisionId: data.lessonRevisionId, provenance: data.provenance, status: ReviewSessionStatus.ACTIVE },
      select: { id: true },
    });
    await tx.learnerReviewSessionActivity.createMany({ data: data.orderedActivityIds.map((activityId, i) => ({ reviewSessionId: session.id, activityId, position: i + 1 })) });
    return session.id;
  }

  /** Own session header (null → not own / not found). */
  ownSession(userId: string, sessionId: string) {
    return this.prisma.learnerReviewSession.findFirst({
      where: { id: sessionId, userId },
      select: { id: true, status: true, skillId: true, lessonId: true, lessonRevisionId: true, startedAt: true, completedAt: true, skill: { select: { id: true, name: true } } },
    });
  }

  /** Ordered selected activities (snapshot) with their raw payload for learner-safe projection. */
  sessionActivities(sessionId: string) {
    return this.prisma.learnerReviewSessionActivity.findMany({
      where: { reviewSessionId: sessionId },
      orderBy: { position: 'asc' },
      select: { position: true, activity: { select: { id: true, type: true, payload: true } } },
    });
  }

  /** Membership check — the Activity must be in this session's immutable snapshot (§38). */
  async sessionActivity(sessionId: string, activityId: string) {
    return this.prisma.learnerReviewSessionActivity.findFirst({ where: { reviewSessionId: sessionId, activityId }, select: { id: true } });
  }

  /** Activity for submit scoring (type + pinned revision + payload). */
  activityById(activityId: string) {
    return this.prisma.activity.findUnique({ where: { id: activityId }, select: { id: true, type: true, lessonRevisionId: true, payload: true } });
  }

  /** Per-activity review-attempt summary for THIS session only (§36/48). */
  async attemptSummary(sessionId: string): Promise<Map<string, { attemptCount: number; bestDeterministicScore: number }>> {
    const rows = await this.prisma.activityAttempt.groupBy({
      by: ['activityId'],
      where: { reviewSessionId: sessionId, status: ActivityAttemptStatus.SUBMITTED },
      _count: { _all: true },
      _max: { deterministicScore: true },
    });
    return new Map(rows.map((r) => [r.activityId, { attemptCount: r._count._all, bestDeterministicScore: r._max.deterministicScore ?? 0 }]));
  }

  // ── review attempts (own persistence; reviewSessionId provenance) ──

  findAttemptByClientRequest(userId: string, clientRequestId: string) {
    return this.prisma.activityAttempt.findFirst({ where: { userId, clientRequestId }, select: ATTEMPT_VIEW });
  }

  async maxAttemptNo(userId: string, activityId: string): Promise<number> {
    const row = await this.prisma.activityAttempt.aggregate({ where: { userId, activityId }, _max: { attemptNo: true } });
    return row._max.attemptNo ?? 0;
  }

  createReviewAttempt(data: CreateReviewAttemptData) {
    return this.prisma.activityAttempt.create({
      data: {
        userId: data.userId,
        activityId: data.activityId,
        lessonRevisionId: data.lessonRevisionId,
        reviewSessionId: data.reviewSessionId, // review provenance (TD-127); learningSessionId stays null
        attemptNo: data.attemptNo,
        status: ActivityAttemptStatus.SUBMITTED,
        answer: data.answer,
        isCorrect: data.isCorrect,
        deterministicScore: data.deterministicScore,
        clientRequestId: data.clientRequestId,
        submittedAt: data.submittedAt,
      },
      select: ATTEMPT_VIEW,
    });
  }

  /** Conditional terminal transition ACTIVE → COMPLETED (idempotent, concurrency-safe, §46/49). */
  markCompleted(sessionId: string, completedAt: Date) {
    return this.prisma.learnerReviewSession.updateMany({ where: { id: sessionId, status: ReviewSessionStatus.ACTIVE }, data: { status: ReviewSessionStatus.COMPLETED, completedAt } });
  }

  // ── review mastery (Phase 1.9C) ──

  /** Session identity for review-mastery derivation (only a COMPLETED session is derivable, §16). */
  sessionForMastery(sessionId: string) {
    return this.prisma.learnerReviewSession.findUnique({ where: { id: sessionId }, select: { id: true, userId: true, skillId: true, status: true, completedAt: true } });
  }

  async selectedActivityIds(sessionId: string): Promise<string[]> {
    const rows = await this.prisma.learnerReviewSessionActivity.findMany({ where: { reviewSessionId: sessionId }, orderBy: { position: 'asc' }, select: { activityId: true } });
    return rows.map((r) => r.activityId);
  }

  /** Best (max) deterministic score per selected Activity for THIS review session (§8). */
  async bestReviewScores(sessionId: string, activityIds: string[]): Promise<Map<string, number>> {
    if (activityIds.length === 0) return new Map();
    const rows = await this.prisma.activityAttempt.groupBy({
      by: ['activityId'],
      where: { reviewSessionId: sessionId, activityId: { in: activityIds }, status: ActivityAttemptStatus.SUBMITTED, deterministicScore: { not: null } },
      _max: { deterministicScore: true },
    });
    return new Map(rows.map((r) => [r.activityId, r._max.deterministicScore ?? 0]));
  }

  /** Append-only, idempotent REVIEW_MASTERY measurement (ON CONFLICT DO NOTHING via review idempotency partial-unique, RM-DB-02).
   *  lessonId left NULL — provenance is reviewSessionId (TD-130 §4). SkillMeasurement is the only measurement write. */
  createReviewMeasurement(data: { userId: string; skillId: string; reviewSessionId: string; scoreBp: number; confidenceBp: number; evidenceCount: number; observedAt: Date }) {
    return this.prisma.skillMeasurement.createMany({
      data: [{ userId: data.userId, skillId: data.skillId, source: SkillMeasurementSource.REVIEW_MASTERY, reviewSessionId: data.reviewSessionId, scoreBp: data.scoreBp, confidenceBp: data.confidenceBp, evidenceCount: data.evidenceCount, observedAt: data.observedAt, displayLevel: null, derivationVersion: REVIEW_MASTERY_DERIVATION_VERSION }],
      skipDuplicates: true,
    });
  }

  /** The REVIEW_MASTERY measurement for a session (getSession display, §49/50). */
  reviewMeasurement(sessionId: string) {
    return this.prisma.skillMeasurement.findFirst({
      where: { reviewSessionId: sessionId, source: SkillMeasurementSource.REVIEW_MASTERY, derivationVersion: REVIEW_MASTERY_DERIVATION_VERSION },
      select: { skillId: true, scoreBp: true, confidenceBp: true, evidenceCount: true },
    });
  }

  isUniqueViolation(e: unknown): boolean {
    return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
  }
}
