import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LearningCoreRepository, isUniqueViolation } from './learning-core.repository';

export const V2_ROADMAP_ENGINE_VERSION = 'v2-roadmap-generation-v1';

export interface V2RoadmapPointView {
  roadmapPointId: string;
  pointKey: string;
  title: string;
  learningOutcome: Prisma.JsonValue | null;
  estimatedEffortMin: number | null;
  sortOrder: number;
  availability: string; // LOCKED | AVAILABLE | IN_PROGRESS | CONTENT_UNAVAILABLE
  acquisition: string | null; // null | LEARNED | VALIDATED
  attention: string; // NONE | REVIEW_DUE | REPAIR_REQUIRED
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
  constructor(private readonly repo: LearningCoreRepository) {}

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

    const projections = await this.repo.getProjections(generation.id);
    const pointIds = projections.map((p) => p.roadmapPointId);
    const [acquisitionMap, activeSessions] = await Promise.all([
      this.repo.acquisitionByPoint(userId, pointIds),
      this.repo.activeSessionIdForPoints(userId, pointIds),
    ]);
    const acquired = new Set([...acquisitionMap.keys()]); // learned OR validated points

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
      return {
        roadmapPointId: p.roadmapPointId,
        pointKey: p.point.pointKey,
        title: p.pointRevision.title,
        learningOutcome: p.pointRevision.learningOutcome,
        estimatedEffortMin: p.pointRevision.estimatedEffortMin,
        sortOrder: p.sortOrder,
        availability,
        acquisition: acq,
        attention: p.attention,
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
