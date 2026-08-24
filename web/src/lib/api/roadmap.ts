import { apiRequest } from './client';
import { isNotFound } from './errors';
import type { RoadmapProgress } from './types';

/**
 * GET /api/roadmaps/me/subjects/:subjectId/active — the active roadmap, or `null` when none exists yet.
 * A 404 (ROADMAP_NOT_FOUND) is an ordinary "not created yet" state, not an error — it is mapped to null here.
 */
export async function fetchActiveRoadmap(subjectId: string): Promise<RoadmapProgress | null> {
  try {
    return await apiRequest<RoadmapProgress>(`/api/roadmaps/me/subjects/${subjectId}/active`);
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}
