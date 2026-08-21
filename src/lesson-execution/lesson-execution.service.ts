import { Injectable, Logger } from '@nestjs/common';
import { ActivityType, Prisma } from '@prisma/client';
import { Clock } from '../common/clock';
import {
  ActivityAttemptRequestConflictError,
  ActivityNotFoundError,
  ActivityNotInPinnedRevisionError,
  ActivityTypeNotSupportedError,
  DailyPlanConfigurationInvalidError,
  DailyPlanItemNotFoundError,
  LessonAlreadyCompletedError,
  LessonNotExecutableError,
  LessonProgressNotFoundError,
} from '../common/errors';
import { ProfileRepository } from '../profile/profile.repository';
import { RoadmapRepository } from '../roadmap/roadmap.repository';
import { ProgressContext, deriveItemState } from '../roadmap/read/roadmap-progress';
import { localDateInTimezone, toDateOnly } from '../daily-plan/local-date.util';
import { LessonExecutionRepository, isUniqueViolation } from './lesson-execution.repository';
import { ActivityAttemptRepository } from './activity/activity-attempt.repository';
import { ObjectiveActivityScorerService } from './activity/objective-activity-scorer.service';
import { parseObjectiveActivityPayload } from './activity/objective-activity-payload';
import { getActivityDefinition } from '../content/activity/activity-registry';
import { LearnerProjectedActivity, projectActivityForLearnerRuntime } from '../content/activity/learner-activity-projection';
import { LearnerSignalsService } from '../learner-signals/learner-signals.service';
import { DailyMissionService } from '../daily-mission/daily-mission.service';

type ProgressRow = NonNullable<Awaited<ReturnType<LessonExecutionRepository['findProgress']>>>;
type AttemptRow = NonNullable<Awaited<ReturnType<ActivityAttemptRepository['findByClientRequest']>>>;
type LearnerActivity = LearnerProjectedActivity;

export interface LessonExecutionView {
  lessonId: string;
  lessonRevisionId: string;
  progress: { status: string; startedAt: string; lastActivityId: string | null };
  lesson: { title: string; description: string | null; estimatedDurationMin: number | null };
  activities: LearnerActivity[];
}

export interface ActivityAttemptView {
  attemptId: string;
  activityId: string;
  attemptNo: number;
  isCorrect: boolean;
  deterministicScore: number;
  status: string;
  submittedAt: string | null;
}

/**
 * Lesson Execution Foundation (Phase 1.7B). Entry is TODAY'S CURRENT DailyPlanItem only (no arbitrary
 * lesson start, §3). First start pins the exact published LessonRevision; resume stays pinned (§8, TD-107).
 * Writes ONLY LearnerLessonProgress — NO LessonCompletion / Roadmap / DailyPlan / Skill / reward / AI (§31-38).
 */
@Injectable()
export class LessonExecutionService {
  private readonly logger = new Logger('LessonExecution');

  constructor(
    private readonly repo: LessonExecutionRepository,
    private readonly roadmapRepo: RoadmapRepository,
    private readonly profiles: ProfileRepository,
    private readonly clock: Clock,
    private readonly attempts: ActivityAttemptRepository,
    private readonly scorer: ObjectiveActivityScorerService,
    private readonly signals: LearnerSignalsService,
    private readonly missions: DailyMissionService,
  ) {}

  /** Start (or resume) execution of a Lesson referenced by today's CURRENT DailyPlanItem (§3/4/6/7/8/10). */
  async startFromDailyPlanItem(userId: string, dailyPlanItemId: string): Promise<LessonExecutionView> {
    const localDate = await this.today(userId);

    const item = await this.repo.findTodayPlanItem(userId, localDate, dailyPlanItemId);
    if (!item) throw new DailyPlanItemNotFoundError('not in today\'s plan'); // wrong owner / stale plan / unknown (§4/42)
    if (item.itemType !== 'LESSON' || !item.lessonId) throw new LessonNotExecutableError('not a lesson item');
    const lessonId = item.lessonId;

    // Live executability — reuse the Phase 1.6B roadmap state machine, do not re-derive prerequisites (§6).
    const state = await this.lessonState(userId, lessonId);
    if (state === 'COMPLETED') throw new LessonAlreadyCompletedError('lesson already completed'); // §7
    if (state !== 'AVAILABLE' && state !== 'IN_PROGRESS') throw new LessonNotExecutableError('lesson blocked or unavailable'); // §6/43

    // Idempotent: existing progress resumes with its pinned revision (never repin, §10). Resume requires the Lesson +
    // full hierarchy to still be learner-visible — an urgent takedown (Lesson ARCHIVED) denies resume (Phase 2.2B §38).
    const existing = await this.repo.findProgress(userId, lessonId);
    if (existing) {
      if (!(await this.repo.isLessonResumable(lessonId))) throw new LessonNotExecutableError('lesson not available');
      return this.toView(existing);
    }

    // First start pins the current published revision.
    const revisionId = await this.repo.publishedRevisionId(lessonId);
    if (!revisionId) throw new LessonNotExecutableError('no published revision'); // §8/48
    let progress: ProgressRow;
    try {
      progress = await this.repo.createProgress(userId, lessonId, revisionId);
    } catch (e) {
      if (isUniqueViolation(e)) {
        // Concurrent first start (§11): the winner's row is the single pinned execution.
        const winner = await this.repo.findProgress(userId, lessonId);
        if (winner) return this.toView(winner);
      }
      throw e;
    }
    return this.toView(progress);
  }

  /** Resume an own execution — returns the PINNED revision, never a newer current revision (§40/45). */
  async resume(userId: string, lessonId: string): Promise<LessonExecutionView> {
    const progress = await this.repo.findProgress(userId, lessonId);
    if (!progress) throw new LessonProgressNotFoundError('no execution');
    if (!(await this.repo.isLessonResumable(lessonId))) throw new LessonNotExecutableError('lesson not available'); // takedown / hierarchy hidden (§38)
    return this.toView(progress);
  }

  // ── internal ──

  private async today(userId: string): Promise<Date> {
    const profile = await this.profiles.getProfile(userId);
    if (!profile?.timezone) throw new DailyPlanConfigurationInvalidError('no profile timezone');
    return toDateOnly(localDateInTimezone(this.clock.now(), profile.timezone));
  }

  private async lessonState(userId: string, lessonId: string): Promise<string> {
    const [completed, inProgress, meta] = await Promise.all([
      this.roadmapRepo.completedLessonIds(userId),
      this.roadmapRepo.inProgressLessonIds(userId),
      this.roadmapRepo.lessonMeta([lessonId]),
    ]);
    const edges = await this.roadmapRepo.prerequisiteEdges([lessonId]);
    const prereqOf = new Map<string, string[]>();
    for (const e of edges) (prereqOf.get(e.lessonId) ?? prereqOf.set(e.lessonId, []).get(e.lessonId)!).push(e.prerequisiteLessonId);
    const available = new Set<string>();
    for (const [lid, m] of meta) if (m.eligible) available.add(lid);
    const ctx: ProgressContext = { completed, inProgress, available, prereqOf };
    return deriveItemState(lessonId, ctx);
  }

  private async toView(progress: ProgressRow): Promise<LessonExecutionView> {
    const rev = await this.repo.revisionContent(progress.lessonRevisionId); // PINNED revision (§45)
    if (!rev) throw new LessonNotExecutableError('pinned revision missing');
    return {
      lessonId: progress.lessonId,
      lessonRevisionId: progress.lessonRevisionId,
      progress: { status: progress.status, startedAt: progress.startedAt.toISOString(), lastActivityId: progress.lastActivityId },
      lesson: { title: rev.title, description: rev.description, estimatedDurationMin: rev.estimatedDurationMin },
      activities: rev.activities.map((a) => this.projectActivity(a)),
    };
  }

  /**
   * Learner-safe Activity projection via the ONE shared projector (Phase 2.2B §32): OBJECTIVE → answerKey stripped;
   * TEXT/EXPLANATION/EXAMPLE → validated markdown body; IMAGE/AUDIO + deferred → metadata only. Malformed → metadata only.
   */
  private projectActivity(a: { id: string; type: ActivityType; position: number; payload: Prisma.JsonValue }): LearnerActivity {
    return projectActivityForLearnerRuntime(a);
  }

  // ── Activity submission (Phase 1.7B-2) ──

  /**
   * Submit an objective activity answer under a pinned execution. Backend scores deterministically;
   * evidence is append-only ActivityAttempt. Idempotent by clientRequestId (§16-19). Writes NO
   * LessonCompletion / Roadmap / DailyPlan / Skill / reward / AI (§31/34/35/36/37/38).
   */
  async submitActivityAttempt(userId: string, lessonId: string, activityId: string, clientRequestId: string, answer: Record<string, unknown>): Promise<ActivityAttemptView> {
    const view = await this.persistAttempt(userId, lessonId, activityId, clientRequestId, answer);
    // §27/28: downstream ADVISORY signal evaluation (also on idempotent replay). A failure never rolls back the
    // authoritative ActivityAttempt — reconcile/retry repairs it (§29). No skill-state/roadmap/reward coupling.
    try {
      await this.signals.evaluateForActivity(userId, activityId);
    } catch {
      this.logger.warn(`signal evaluation deferred for activity ${activityId}`);
    }
    // Phase 2.0B: downstream ADVISORY daily-mission evaluation. Failure never rolls back the attempt (§22); reconcile repairs.
    try {
      await this.missions.evaluateActivityAttempt(userId, view.attemptId);
    } catch {
      this.logger.warn(`mission evaluation deferred for attempt ${view.attemptId}`);
    }
    return view;
  }

  private async persistAttempt(userId: string, lessonId: string, activityId: string, clientRequestId: string, answer: Record<string, unknown>): Promise<ActivityAttemptView> {
    const progress = await this.repo.findProgress(userId, lessonId);
    if (!progress) throw new LessonProgressNotFoundError('no execution'); // must have started (§40)
    if (progress.status !== 'IN_PROGRESS') throw new LessonAlreadyCompletedError('lesson not in progress'); // no completed-lesson bypass

    const activity = await this.attempts.findActivity(activityId);
    if (!activity) throw new ActivityNotFoundError('activity not found');
    if (activity.lessonRevisionId !== progress.lessonRevisionId) throw new ActivityNotInPinnedRevisionError('wrong revision'); // §13/43
    if (getActivityDefinition(activity.type).executionKind !== 'OBJECTIVE') throw new ActivityTypeNotSupportedError('activity type not supported'); // §11/33

    const payload = parseObjectiveActivityPayload(activity.payload); // ACTIVITY_PAYLOAD_INVALID (safe, §38)
    const scored = this.scorer.score(payload, answer); // ACTIVITY_INVALID_RESPONSE (§37)
    const canonical = this.scorer.canonicalize(payload, answer);

    // Idempotency: a prior attempt under this durable request id (§17/18).
    const prior = await this.attempts.findByClientRequest(userId, clientRequestId);
    if (prior) return this.replayOrConflict(prior, activity.id, payload, canonical);

    for (let tries = 0; tries < 6; tries++) {
      const attemptNo = (await this.attempts.maxAttemptNo(userId, activityId)) + 1;
      try {
        const attempt = await this.attempts.create({
          userId,
          activityId,
          lessonRevisionId: progress.lessonRevisionId,
          attemptNo,
          answer: answer as Prisma.InputJsonValue,
          isCorrect: scored.isCorrect,
          deterministicScore: scored.deterministicScore,
          clientRequestId,
          submittedAt: this.clock.now(), // injected clock (deterministic; drives the learner-local mission day)
        });
        await this.attempts.recordActivityStep(userId, lessonId, activityId); // resume cache only (§28/30) — NOT completion
        return this.toAttemptView(attempt);
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
        // Either a concurrent same-clientRequestId winner, or an attemptNo collision (concurrent new request).
        const byReq = await this.attempts.findByClientRequest(userId, clientRequestId);
        if (byReq) return this.replayOrConflict(byReq, activity.id, payload, canonical); // same request already recorded (§22)
        // else attemptNo raced with a DIFFERENT request (§21) — retry with a fresh number.
      }
    }
    throw new LessonNotExecutableError('attempt could not be recorded'); // defensive (bounded retry)
  }

  private replayOrConflict(existing: AttemptRow, activityId: string, payload: ReturnType<typeof parseObjectiveActivityPayload>, canonical: string): ActivityAttemptView {
    if (existing.activityId === activityId && this.scorer.canonicalize(payload, existing.answer) === canonical) return this.toAttemptView(existing); // idempotent (§17)
    throw new ActivityAttemptRequestConflictError('request id already used'); // §18
  }

  private toAttemptView(a: { id: string; activityId: string; attemptNo: number; isCorrect: boolean | null; deterministicScore: number | null; status: string; submittedAt: Date | null }): ActivityAttemptView {
    return {
      attemptId: a.id,
      activityId: a.activityId,
      attemptNo: a.attemptNo,
      isCorrect: a.isCorrect ?? false,
      deterministicScore: a.deterministicScore ?? 0,
      status: a.status,
      submittedAt: a.submittedAt ? a.submittedAt.toISOString() : null,
    };
  }
}
