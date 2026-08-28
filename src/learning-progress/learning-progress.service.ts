import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ResourceNotFoundError } from '../common/errors';
import { LearnerSignalsService } from '../learner-signals/learner-signals.service';
import { LearningProgressRepository } from './learning-progress.repository';
import { mergeSkillV2 } from './merge/learning-progress-merge-v2.engine';

export interface SkillStateView {
  skillId: string;
  masteryScoreBp: number;
  confidenceBp: number | null;
  evidenceCount: number;
  displayLevel: null;
  lastMeasurementAt: string | null;
}

/**
 * Learning Progress Merge (Phase 1.8A). The ONE writer of LearnerSkillState (TD-115). Every recompute
 * rebuilds current state FROM SCRATCH from immutable SkillMeasurement history via learning-progress-merge-v1
 * (§30) — deterministic, repairable, rebuildable. No Signals / Rewards / Roadmap / DailyPlan / AI (§72).
 */
@Injectable()
export class LearningProgressService {
  private readonly logger = new Logger('LearningProgress');

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: LearningProgressRepository,
    private readonly signals: LearnerSignalsService,
  ) {}

  /** Recompute + materialize current state for one user+skill under a per-(user,skill) serialization lock. */
  async recomputeSkill(userId: string, skillId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.repo.advisoryLock(tx, userId, skillId); // serialize; then load FRESH inside the lock (§31)
      const measurements = await this.repo.supportedMeasurements(userId, skillId, tx);
      const result = mergeSkillV2(measurements); // learning-progress-merge-v2 is the current engine (TD-131)
      if (result === null) return; // no supported evidence → do NOT write or delete existing state (§60)
      await this.repo.upsertState(tx, {
        userId,
        skillId,
        masteryScoreBp: result.masteryScoreBp,
        confidenceBp: result.confidenceBp,
        evidenceCount: result.evidenceCount,
        lastMeasurementAt: result.lastMeasurementAt,
      });
    });
  }

  /** Recompute a set of skills — each in its own lock/transaction (different skills never block, §33).
   *  After each state commit, fire the downstream ADVISORY state-signal evaluation (WEAK_SKILL + REVIEW_DUE,
   *  1.8C §29): the merge engine stays signal-unaware; a signal failure never rolls back the authoritative
   *  state (§31) — reconcile repairs it. Runs OUTSIDE the merge transaction to avoid nesting. */
  async recomputeSkills(userId: string, skillIds: string[]): Promise<void> {
    const ordered = [...new Set(skillIds)].sort(); // dedup + deterministic order
    for (const skillId of ordered) {
      await this.recomputeSkill(userId, skillId);
      try {
        await this.signals.evaluateStateSignals(userId, skillId);
      } catch {
        this.logger.warn(`state-signal evaluation deferred for skill ${skillId}`);
      }
    }
  }

  /** Repair/rebuild every affected current state in a Subject from existing measurements (§34/35). */
  async recomputeSubject(userId: string, subjectId: string): Promise<{ subjectId: string; skills: SkillStateView[] }> {
    const subject = await this.repo.getSubject(subjectId);
    if (!subject) throw new ResourceNotFoundError('subject not found');
    const skillIds = await this.repo.subjectSkillIdsForRecompute(userId, subjectId);
    await this.recomputeSkills(userId, skillIds);
    const states = await this.repo.subjectStates(userId, subjectId);
    return {
      subjectId,
      skills: states.map((s) => ({
        skillId: s.skillId,
        masteryScoreBp: s.masteryScoreBp,
        confidenceBp: s.confidenceBp,
        evidenceCount: s.evidenceCount,
        displayLevel: null,
        lastMeasurementAt: s.lastMeasurementAt ? s.lastMeasurementAt.toISOString() : null,
      })),
    };
  }

  /**
   * Recompute every (learner, skill) whose evidence draws on the given defective canonical artifacts — used by the
   * Content Quality evidence-integrity workflow after an INVALIDATED decision. Rebuilds current projections from
   * scratch; the now-inadmissible evidence is excluded by the derived admissibility filter in supportedMeasurements
   * (§35a). Immutable SkillMeasurement/ActivityAttempt/AssessmentResponse history is never touched.
   */
  async recomputeAffectedByArtifacts(activityIds: string[], itemIds: string[]): Promise<{ affected: number }> {
    const pairs = await this.repo.affectedUserSkills(activityIds, itemIds);
    const byUser = new Map<string, string[]>();
    for (const p of pairs) byUser.set(p.userId, [...(byUser.get(p.userId) ?? []), p.skillId]);
    for (const [userId, skillIds] of byUser) await this.recomputeSkills(userId, skillIds);
    return { affected: pairs.length };
  }
}
