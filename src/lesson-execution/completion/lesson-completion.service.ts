import { Injectable, Logger } from '@nestjs/common';
import {
  ActivityNotFoundError,
  ActivityNotInPinnedRevisionError,
  ActivityTypeNotSupportedError,
  LessonAlreadyCompletedError,
  LessonCompletionUnsupportedActivityError,
  LessonConfigurationInvalidError,
  LessonNotReadyForCompletionError,
  LessonProgressNotFoundError,
} from '../../common/errors';
import { RoadmapService } from '../../roadmap/roadmap.service';
import { LearningProgressService } from '../../learning-progress/learning-progress.service';
import { ActivityAttemptRepository } from '../activity/activity-attempt.repository';
import { isViewOnlyActivityType } from '../../content/activity/activity-registry';
import { computeEligibility } from './lesson-completion-eligibility';
import { LESSON_MASTERY_DERIVATION_VERSION, MasteryActivityInput, deriveLessonMastery } from './lesson-mastery.engine';
import { LessonCompletionRepository } from './lesson-completion.repository';

export interface LessonMasteryView {
  measured: boolean;
  skills: { skillId: string; scoreBp: number; confidenceBp: number; evidenceCount: number; displayLevel: null }[];
}
export interface LessonCompletionView {
  lessonId: string;
  lessonRevisionId: string;
  status: 'COMPLETED';
  completedAt: string;
  mastery: LessonMasteryView;
}

/**
 * Lesson Completion + lesson-mastery milestone (Phase 1.7C). Completion = the whole pinned revision was
 * performed (correctness never gates it, §12). Mastery = MASTERY_TEST evidence only (§18). Writes
 * LearnerLessonCompletion + terminal LearnerLessonProgress + SkillMeasurement(LESSON_MASTERY), and
 * reconciles the Roadmap via the existing hook. NEVER LearnerSkillState (§36), Signal, reward, or AI.
 */
@Injectable()
export class LessonCompletionService {
  private readonly logger = new Logger('LessonCompletion');

  constructor(
    private readonly repo: LessonCompletionRepository,
    private readonly attempts: ActivityAttemptRepository,
    private readonly roadmap: RoadmapService,
    private readonly learningProgress: LearningProgressService,
  ) {}

  /** Mark a view-only activity step performed (TEXT/EXPLANATION/IMAGE/AUDIO/EXAMPLE). No ActivityAttempt (§5). */
  async markViewOnlyStep(userId: string, lessonId: string, activityId: string): Promise<{ lessonId: string; activityId: string; recorded: true }> {
    if (!(await this.repo.isLessonAccessible(lessonId))) throw new LessonNotReadyForCompletionError('lesson not available'); // takedown gate (§4)
    const progress = await this.repo.findProgress(userId, lessonId);
    if (!progress) throw new LessonProgressNotFoundError('no execution');
    if (progress.status !== 'IN_PROGRESS') throw new LessonAlreadyCompletedError('lesson not in progress');

    const activity = await this.attempts.findActivity(activityId);
    if (!activity) throw new ActivityNotFoundError('activity not found');
    if (activity.lessonRevisionId !== progress.lessonRevisionId) throw new ActivityNotInPinnedRevisionError('wrong revision');
    if (!isViewOnlyActivityType(activity.type)) throw new ActivityTypeNotSupportedError('not a view-only activity'); // objective/deferred → reject (§5/43)

    await this.attempts.recordActivityStep(userId, lessonId, activityId); // set-union, idempotent (§5)
    return { lessonId, activityId, recorded: true };
  }

  /** Complete the Lesson (idempotent). Persists completion, derives mastery, reconciles roadmap (§10/11/38). */
  async completeLesson(userId: string, lessonId: string): Promise<LessonCompletionView> {
    if (!(await this.repo.isLessonAccessible(lessonId))) throw new LessonNotReadyForCompletionError('lesson not available'); // takedown gate (§4)
    const progress = await this.repo.findProgress(userId, lessonId);
    if (!progress) throw new LessonProgressNotFoundError('no execution');

    const existing = await this.repo.findCompletion(userId, lessonId);
    if (existing) {
      // Idempotent replay + recovery (§16/39/28): ensure mastery → merge state → reconcile, return current.
      const mastery = await this.finalize(userId, lessonId, progress.lessonRevisionId, existing.completedAt);
      return this.view(lessonId, progress.lessonRevisionId, existing.completedAt, mastery);
    }

    // Eligibility — every pinned activity performed; no unsupported required activity (§8/9/11).
    const activities = await this.repo.pinnedActivities(progress.lessonRevisionId);
    if (activities.length === 0) throw new LessonConfigurationInvalidError('lesson has no activities'); // §9
    const submitted = await this.repo.submittedActivityIds(userId, progress.lessonRevisionId);
    const completedSet = new Set(Array.isArray(progress.completedActivities) ? (progress.completedActivities as string[]) : []);
    const elig = computeEligibility(activities, completedSet, submitted);
    if (elig.unsupportedActivityIds.length > 0) throw new LessonCompletionUnsupportedActivityError('unsupported activity'); // §4/50
    if (!elig.eligible) throw new LessonNotReadyForCompletionError('not ready'); // §11

    const masteryBestCache = await this.masteryBestCache(userId, progress.lessonRevisionId);

    const now = new Date();
    let completedAt: Date;
    try {
      const created = await this.repo.createCompletion({ userId, lessonId, lessonRevisionId: progress.lessonRevisionId, completedAt: now, startedAt: progress.startedAt, masteryBestScore: masteryBestCache });
      await this.repo.markProgressCompleted(userId, lessonId, now, masteryBestCache);
      completedAt = created.completedAt;
    } catch (e) {
      if (this.repo.isUniqueViolation(e)) {
        const winner = await this.repo.findCompletion(userId, lessonId); // concurrent completion (§15)
        completedAt = winner!.completedAt;
      } else throw e;
    }

    const mastery = await this.finalize(userId, lessonId, progress.lessonRevisionId, completedAt);
    return this.view(lessonId, progress.lessonRevisionId, completedAt, mastery);
  }

  // ── internal ──

  /**
   * Downstream, idempotent, recoverable (§28/38): B ensure LESSON_MASTERY measurements → B2 merge current
   * state (the single writer, TD-115) → C reconcile roadmap. Each step is safe to re-run; a later-step
   * failure never rolls back the authoritative completion (repair via the recompute endpoint / retry).
   */
  private async finalize(userId: string, lessonId: string, revisionId: string, observedAt: Date): Promise<LessonMasteryView> {
    const mastery = await this.ensureMasteryDerived(userId, lessonId, revisionId, observedAt);
    if (mastery.skills.length > 0) await this.learningProgress.recomputeSkills(userId, mastery.skills.map((s) => s.skillId)); // §28/55
    await this.reconcileRoadmaps(userId, lessonId); // §40
    return mastery;
  }

  private async masteryBestCache(userId: string, revisionId: string): Promise<number | null> {
    const ids = (await this.repo.masteryTestActivityIds(revisionId)).map((a) => a.id);
    if (ids.length === 0) return null;
    const vals = [...(await this.repo.bestScores(userId, ids)).values()];
    return vals.length ? Math.max(...vals) : 0;
  }

  /** Idempotently derive + persist LESSON_MASTERY SkillMeasurements with normalized merge metadata
   *  (evidenceCount + observedAt, TD-113). Current-state materialization is delegated to the merge engine. */
  private async ensureMasteryDerived(userId: string, lessonId: string, revisionId: string, observedAt: Date): Promise<LessonMasteryView> {
    const masteryIds = (await this.repo.masteryTestActivityIds(revisionId)).map((a) => a.id);
    if (masteryIds.length === 0) return { measured: false, skills: [] }; // no mastery test → no measurement (§23/58)

    const [best, actSkills, lessonSkillIds, lessonSubject] = await Promise.all([
      this.repo.bestScores(userId, masteryIds),
      this.repo.activitySkills(masteryIds),
      this.repo.lessonSkillIds(lessonId),
      this.repo.lessonSubjectId(lessonId),
    ]);
    const candidateSkillIds = new Set<string>();
    for (const id of masteryIds) for (const s of actSkills.get(id) ?? lessonSkillIds) candidateSkillIds.add(s);
    const skillSubj = await this.repo.skillSubjects([...candidateSkillIds]);

    const inputs: MasteryActivityInput[] = [];
    for (const activityId of masteryIds) {
      const bestScore = best.get(activityId);
      if (bestScore === undefined) continue; // no valid attempt (eligibility should have ensured one)
      const attributed = (actSkills.get(activityId) ?? lessonSkillIds) // ActivitySkill, else LessonSkill fallback (§24/25)
        .filter((s) => skillSubj.get(s) === lessonSubject); // subject scope — exclude cross-subject (§66)
      if (attributed.length === 0) continue; // unattributed evidence — no fabrication (§25/57)
      inputs.push({ activityId, bestScoreBp: bestScore, skillIds: attributed });
    }

    const entries = deriveLessonMastery(inputs);
    if (entries.length === 0) return { measured: false, skills: [] };
    await this.repo.createMasteryMeasurements(
      entries.map((e) => ({ userId, lessonId, skillId: e.skillId, scoreBp: e.scoreBp, confidenceBp: e.confidenceBp, evidenceCount: e.evidenceCount, observedAt })),
      LESSON_MASTERY_DERIVATION_VERSION,
    );
    return { measured: true, skills: entries.map((e) => ({ skillId: e.skillId, scoreBp: e.scoreBp, confidenceBp: e.confidenceBp, evidenceCount: e.evidenceCount, displayLevel: null })) };
  }

  private async reconcileRoadmaps(userId: string, lessonId: string): Promise<void> {
    const ids = await this.repo.activeRoadmapIdsContainingLesson(userId, lessonId);
    for (const roadmapId of ids) {
      try {
        await this.roadmap.reconcileCompletion(userId, roadmapId); // idempotent (§40); LessonCompletion is item authority
      } catch {
        this.logger.warn(`roadmap reconcile deferred for ${roadmapId}`); // recoverable; completion stands (§39)
      }
    }
  }

  private view(lessonId: string, lessonRevisionId: string, completedAt: Date, mastery: LessonMasteryView): LessonCompletionView {
    return { lessonId, lessonRevisionId, status: 'COMPLETED', completedAt: completedAt.toISOString(), mastery };
  }
}
