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

/**
 * POST /api/roadmaps/diagnostics/:attemptId/initial — generate (or idempotently return) the initial roadmap from a
 * completed diagnostic. Backend-authored and idempotent; we only need it to succeed before entering /learn.
 */
export function generateInitialRoadmap(attemptId: string): Promise<{ roadmap: { id: string; status: string }; uncoveredSkillIds: string[] }> {
  return apiRequest(`/api/roadmaps/diagnostics/${attemptId}/initial`, { method: 'POST' });
}
