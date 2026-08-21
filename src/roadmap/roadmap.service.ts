import { Injectable } from '@nestjs/common';
import {
  AssessmentAttemptNotFoundError,
  RoadmapAlreadyActiveError,
  RoadmapConfigurationInvalidError,
  RoadmapNoEligibleContentError,
  RoadmapNotFoundError,
  SkillProfileNotDerivedError,
} from '../common/errors';
import { SKILL_PROFILE_DIAGNOSTIC_VERSION } from '../skill-profile/derivation/diagnostic-profile.types';
import { GapRankingEngine } from './gap/gap-ranking.engine';
import { RoadmapCandidateService } from './candidate/roadmap-candidate.service';
import { RoadmapRepository, isUniqueViolation } from './roadmap.repository';
import { RoadmapReadService, RoadmapProgressView } from './read/roadmap-read.service';

type RoadmapRow = NonNullable<Awaited<ReturnType<RoadmapRepository['findOwnRoadmap']>>>;

export interface RoadmapView {
  id: string;
  subjectId: string;
  trackId: string;
  status: string;
  sourceAssessmentAttemptId: string | null;
  items: { id: string; itemType: string; lessonId: string | null; checkpointId: string | null; skillId: string | null; position: number; status: string }[];
}

/**
 * Roadmap Foundation (Phase 1.6A). Deterministic initial roadmap from an exact diagnostic snapshot.
 * READ-ONLY against LearnerSkillState / SkillMeasurement / lesson progress (§30/31). No AI / DailyPlan
 * / LearnerSignal / XP / IZL (§32/33/34/66).
 */
@Injectable()
export class RoadmapService {
  constructor(
    private readonly repo: RoadmapRepository,
    private readonly gapEngine: GapRankingEngine,
    private readonly candidate: RoadmapCandidateService,
    private readonly read: RoadmapReadService,
  ) {}

  /** Generate (or idempotently return) the initial ACTIVE roadmap for a completed diagnostic (§7/22/23). */
  async generateInitial(userId: string, attemptId: string): Promise<{ roadmap: RoadmapView; uncoveredSkillIds: string[] }> {
    const attempt = await this.repo.findSourceAttempt(userId, attemptId);
    if (!attempt) throw new AssessmentAttemptNotFoundError('attempt not found');
    if (!attempt.trackId) throw new RoadmapConfigurationInvalidError('diagnostic has no track');

    const measurements = await this.repo.diagnosticMeasurements(attemptId, SKILL_PROFILE_DIAGNOSTIC_VERSION);
    if (measurements.length === 0) throw new SkillProfileNotDerivedError('skill profile not derived');

    // Existing ACTIVE roadmap for the subject: same source → idempotent replay; different source → conflict.
    const existing = await this.repo.findActiveRoadmap(userId, attempt.subjectId);
    if (existing) {
      if (existing.sourceAssessmentAttemptId === attemptId) return { roadmap: this.toView(existing), uncoveredSkillIds: [] };
      throw new RoadmapAlreadyActiveError('active roadmap exists');
    }

    const evidence = await this.repo.evidenceCountsBySkill(attemptId);
    const measured = measurements.map((m) => ({ skillId: m.skillId, masteryScoreBp: m.scoreBp, confidenceBp: m.confidenceBp ?? 0, evidenceCount: evidence.get(m.skillId) ?? 0 }));
    const rankedGaps = this.gapEngine.rank(measured);

    const { plan, uncoveredSkillIds } = await this.candidate.computePlan(userId, rankedGaps);
    if (plan.length === 0) throw new RoadmapNoEligibleContentError('no eligible content'); // §20 — no empty ACTIVE roadmap

    let roadmapId: string;
    try {
      roadmapId = await this.repo.createRoadmap({ userId, subjectId: attempt.subjectId, trackId: attempt.trackId, sourceAssessmentAttemptId: attemptId }, plan);
    } catch (e) {
      // ux_active_roadmap race (§24): a concurrent request won.
      if (isUniqueViolation(e)) {
        const winner = await this.repo.findActiveRoadmap(userId, attempt.subjectId);
        if (winner?.sourceAssessmentAttemptId === attemptId) return { roadmap: this.toView(winner), uncoveredSkillIds: [] };
        throw new RoadmapAlreadyActiveError('active roadmap exists');
      }
      throw e;
    }

    const created = await this.repo.findOwnRoadmap(userId, roadmapId);
    return { roadmap: this.toView(created!), uncoveredSkillIds };
  }

  /**
   * Idempotent, concurrency-safe ACTIVE → COMPLETED reconciliation (§14/15/33-35). Command, not a read
   * (§16). Completes iff EVERY persisted item's Lesson has an authoritative completion — an item that is
   * merely UNAVAILABLE (never completed) keeps the roadmap incomplete (no silently-dropped learning, §14).
   * This is the hook a future Lesson-completion flow will call (§17). Read-only against progress/completion.
   */
  async reconcileCompletion(userId: string, roadmapId: string): Promise<RoadmapProgressView> {
    const roadmap = await this.repo.findOwnRoadmap(userId, roadmapId);
    if (!roadmap) throw new RoadmapNotFoundError('roadmap not found');

    const itemLessonIds = roadmap.items.map((i) => i.lessonId).filter((x): x is string => x !== null);
    const completed = await this.repo.completedLessonIds(userId);
    const allComplete =
      roadmap.items.length > 0 && roadmap.items.every((i) => i.lessonId !== null) && itemLessonIds.every((id) => completed.has(id));

    if (roadmap.status === 'ACTIVE' && allComplete) {
      await this.repo.transitionToCompleted(roadmapId, userId); // conditional; concurrent second call is a no-op
    }
    return this.read.getById(userId, roadmapId);
  }

  private toView(r: RoadmapRow): RoadmapView {
    return {
      id: r.id,
      subjectId: r.subjectId,
      trackId: r.trackId,
      status: r.status,
      sourceAssessmentAttemptId: r.sourceAssessmentAttemptId,
      items: r.items.map((i) => ({
        id: i.id,
        itemType: i.itemType,
        lessonId: i.lessonId,
        checkpointId: i.checkpointId,
        skillId: i.skillId,
        position: i.position,
        status: i.status,
      })),
    };
  }
}
