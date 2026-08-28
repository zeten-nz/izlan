import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Clock } from '../common/clock';
import { reviewActivation } from '../learner-signals/review-due-signal.policy';
import { LearningCoreRepository, isUniqueViolation } from './learning-core.repository';
import { derivePointAttention, POINT_ATTENTION_POLICY_VERSION, type AttentionReasonCode, type SkillAttentionInput } from './attention/point-attention.engine';

export const V2_ROADMAP_ENGINE_VERSION = 'v2-roadmap-generation-v1';
export { POINT_ATTENTION_POLICY_VERSION };

export interface V2RoadmapPointView {
  roadmapPointId: string;
  pointKey: string;
  title: string;
  learningOutcome: Prisma.JsonValue | null;
  estimatedEffortMin: number | null;
  sortOrder: number;
  availability: string; // LOCKED | AVAILABLE | IN_PROGRESS | CONTENT_UNAVAILABLE
  acquisition: string | null; // null | LEARNED | VALIDATED
  attention: string; // NONE | REVIEW_DUE | REPAIR_REQUIRED — DERIVED over active signals + retention policy
  attentionReason: AttentionReasonCode | null; // REPEATED_MISTAKE | PERSISTENT_WEAKNESS | RETENTION_DUE | null
  attentionSkill: { id: string; name: string } | null; // the skill driving attention (learner-facing name)
  learned: boolean;
  validated: boolean;
  activeSessionId: string | null;
}

export interface V2RoadmapView {
  generation: { id: string; subjectId: string; trackId: string; generationNo: number; generatedAt: string } | null;
  points: V2RoadmapPointView[];
}

/**
 * V2 roadmap read/generation. Reads the learner's CURRENT LearnerRoadmapGeneration (creating it once from the
 * published canonical points), then projects each RoadmapPointProjection with a LIVE acquisition overlay from
 * the authoritative PointAcquisitionEvent log — so the roadmap reflects LEARNED without inventing completion.
 * Own-user only: the generation is always scoped by userId.
 */
@Injectable()
export class V2RoadmapService {
  constructor(
    private readonly repo: LearningCoreRepository,
    private readonly clock: Clock,
  ) {}

  async getRoadmap(userId: string, subjectId: string): Promise<V2RoadmapView> {
    const track = await this.repo.findSubjectTrack(subjectId);
    if (!track) return { generation: null, points: [] };
    const publishedPoints = await this.repo.listPublishedPoints(track.levelIds);
    if (publishedPoints.length === 0) return { generation: null, points: [] };

    let generation = await this.repo.findCurrentGeneration(userId, subjectId);
    if (!generation) {
      try {
        generation = await this.repo.createGeneration(userId, subjectId, track.trackId, V2_ROADMAP_ENGINE_VERSION, publishedPoints);
      } catch (e) {
        if (isUniqueViolation(e)) {
          generation = await this.repo.findCurrentGeneration(userId, subjectId); // concurrent create won the one-CURRENT partial unique
        }
        if (!generation) throw e;
      }
    }

    let projections = await this.repo.getProjections(generation.id);

    // Publication integration: a point published AFTER this generation was frozen is not in its projection set.
    // Regenerate lazily (supersede → new CURRENT generation) so the learner picks up the new canonical point
    // WITHOUT rewriting history — old generation stays SUPERSEDED and acquisitions survive (keyed to the point).
    const projectedIds = new Set(projections.map((p) => p.roadmapPointId));
    if (publishedPoints.some((p) => !projectedIds.has(p.pointId))) {
      try {
        generation = await this.repo.regenerate(userId, subjectId, track.trackId, V2_ROADMAP_ENGINE_VERSION, publishedPoints, generation.id);
      } catch (e) {
        if (isUniqueViolation(e)) generation = (await this.repo.findCurrentGeneration(userId, subjectId))!; // concurrent regenerate won
        else throw e;
      }
      projections = await this.repo.getProjections(generation.id);
    }
    const pointIds = projections.map((p) => p.roadmapPointId);
    const acquisitionMap = await this.repo.acquisitionByPoint(userId, pointIds);
    const acquired = new Set([...acquisitionMap.keys()]); // learned OR validated points

    // Attention is derived ONLY for acquired points ("established, now needs review/repair"). Load the signal facts
    // + current competence state for their required skills, then project attention over them (never stored).
    const acquiredSkillIds = new Set<string>();
    for (const p of projections) {
      if (!acquired.has(p.roadmapPointId)) continue;
      for (const se of p.pointRevision.skillExpectations) acquiredSkillIds.add(se.expectation.skillId);
    }
    const [activeSessions, signalsBySkill, skillStates, skillNames] = await Promise.all([
      this.repo.activeSessionIdForPoints(userId, pointIds),
      acquiredSkillIds.size > 0 ? this.repo.activeAttentionSignals(userId, subjectId) : Promise.resolve(new Map<string, string[]>()),
      this.repo.skillStatesForAttention(userId, [...acquiredSkillIds]),
      this.repo.skillNames([...acquiredSkillIds]),
    ]);
    const now = this.clock.now();

    const points: V2RoadmapPointView[] = projections.map((p) => {
      const acq = acquisitionMap.get(p.roadmapPointId) ?? null; // LEARNED | VALIDATED | null (authoritative overlay)
      const isAcquired = acq !== null;
      const activeSessionId = activeSessions.get(p.roadmapPointId) ?? null;
      const prereqsSatisfied = p.pointRevision.prerequisites.every((pre) => acquired.has(pre.prerequisitePointId));
      // Availability is derived: acquired → AVAILABLE; else IN_PROGRESS if a session is open; else gated by prereqs
      // (validated/learned prerequisites unlock dependents); CONTENT_UNAVAILABLE is preserved.
      const availability = isAcquired
        ? 'AVAILABLE'
        : activeSessionId
          ? 'IN_PROGRESS'
          : p.availability === 'CONTENT_UNAVAILABLE'
            ? 'CONTENT_UNAVAILABLE'
            : prereqsSatisfied
              ? 'AVAILABLE'
              : 'LOCKED';

      // Derive attention (repair/review) over the acquired point's required skills. Not derived for
      // not-yet-acquired points (a point still being learned is neither "repair" nor "review").
      let attention = 'NONE';
      let attentionReason: AttentionReasonCode | null = null;
      let attentionSkill: { id: string; name: string } | null = null;
      if (isAcquired) {
        const skillInputs: SkillAttentionInput[] = p.pointRevision.skillExpectations.map((se) => {
          const sid = se.expectation.skillId;
          const st = skillStates.get(sid);
          const reviewDue =
            st != null &&
            reviewActivation({ masteryScoreBp: st.masteryScoreBp, confidenceBp: st.confidenceBp ?? 0, evidenceCount: st.evidenceCount, lastMeasurementAt: st.lastMeasurementAt }, now) !== null;
          return { skillId: sid, activeSignalTypes: signalsBySkill.get(sid) ?? [], reviewDue };
        });
        const derived = derivePointAttention(skillInputs);
        attention = derived.attention;
        attentionReason = derived.reasonCode === 'NONE' ? null : derived.reasonCode;
        attentionSkill = derived.reasonSkillId ? { id: derived.reasonSkillId, name: skillNames.get(derived.reasonSkillId) ?? '' } : null;
      }

      return {
        roadmapPointId: p.roadmapPointId,
        pointKey: p.point.pointKey,
        title: p.pointRevision.title,
        learningOutcome: p.pointRevision.learningOutcome,
        estimatedEffortMin: p.pointRevision.estimatedEffortMin,
        sortOrder: p.sortOrder,
        availability,
        acquisition: acq,
        attention,
        attentionReason,
        attentionSkill,
        learned: acq === 'LEARNED',
        validated: acq === 'VALIDATED',
        activeSessionId,
      };
    });

    return {
      generation: {
        id: generation.id,
        subjectId: generation.subjectId,
        trackId: generation.trackId,
        generationNo: generation.generationNo,
        generatedAt: generation.generatedAt.toISOString(),
      },
      points,
    };
  }
}
