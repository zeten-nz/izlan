import { Injectable } from '@nestjs/common';
import { RoadmapNotFoundError } from '../../common/errors';
import { RoadmapRepository } from '../roadmap.repository';
import { ProgressContext, ProgressSummary, RoadmapItemState, deriveItems, nextItemId, summarize } from './roadmap-progress';

type RoadmapRow = NonNullable<Awaited<ReturnType<RoadmapRepository['findOwnRoadmap']>>>;

export interface RoadmapProgressView {
  id: string;
  subjectId: string;
  trackId: string;
  status: string;
  sourceAssessmentAttemptId: string | null;
  progress: ProgressSummary;
  nextItemId: string | null;
  items: { id: string; position: number; state: RoadmapItemState; skillId: string | null; lesson: { id: string | null; title: string | null } }[];
}

/**
 * Roadmap read model projector (TD-101). The SINGLE serializer for both GET endpoints (§22/23).
 * Read-only — never mutates roadmap/progress/completion (§16). Batch queries only, O(few) not O(items) (§24).
 */
@Injectable()
export class RoadmapReadService {
  constructor(private readonly repo: RoadmapRepository) {}

  async getActive(userId: string, subjectId: string): Promise<RoadmapProgressView> {
    const roadmap = await this.repo.findActiveRoadmap(userId, subjectId);
    if (!roadmap) throw new RoadmapNotFoundError('no active roadmap');
    return this.project(userId, roadmap);
  }

  async getById(userId: string, roadmapId: string): Promise<RoadmapProgressView> {
    const roadmap = await this.repo.findOwnRoadmap(userId, roadmapId);
    if (!roadmap) throw new RoadmapNotFoundError('roadmap not found');
    return this.project(userId, roadmap);
  }

  /** Project a loaded roadmap into the derived progress read model. Position ASC is canonical order (§12). */
  async project(userId: string, roadmap: RoadmapRow): Promise<RoadmapProgressView> {
    const items = [...roadmap.items].sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1));
    const lessonIds = items.map((i) => i.lessonId).filter((x): x is string => x !== null);

    // Batch loads — a fixed number of queries regardless of item count (§24).
    const [completed, inProgress, meta] = await Promise.all([
      this.repo.completedLessonIds(userId),
      this.repo.inProgressLessonIds(userId),
      this.repo.lessonMeta(lessonIds),
    ]);
    const edges = await this.repo.prerequisiteEdges(lessonIds);

    const prereqOf = new Map<string, string[]>();
    for (const e of edges) (prereqOf.get(e.lessonId) ?? prereqOf.set(e.lessonId, []).get(e.lessonId)!).push(e.prerequisiteLessonId);
    const available = new Set<string>();
    for (const [lid, m] of meta) if (m.eligible) available.add(lid);

    const ctx: ProgressContext = { completed, inProgress, available, prereqOf };
    const derived = deriveItems(items.map((i) => ({ roadmapItemId: i.id, position: i.position, lessonId: i.lessonId })), ctx);
    const stateById = new Map(derived.map((d) => [d.roadmapItemId, d.state]));

    return {
      id: roadmap.id,
      subjectId: roadmap.subjectId,
      trackId: roadmap.trackId,
      status: roadmap.status,
      sourceAssessmentAttemptId: roadmap.sourceAssessmentAttemptId,
      progress: summarize(derived),
      nextItemId: nextItemId(derived),
      items: items.map((i) => ({
        id: i.id,
        position: i.position,
        state: stateById.get(i.id)!,
        skillId: i.skillId, // roadmap rationale/origin — NOT current mastery authority (§38)
        lesson: { id: i.lessonId, title: i.lessonId ? meta.get(i.lessonId)?.title ?? null : null },
      })),
    };
  }
}
