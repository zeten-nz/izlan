import { apiRequest } from './client';
import type { AttemptView, PlacementAnswer } from './types';

/**
 * Placement (initial diagnostic) assessment API (Phase 02B). Backend is authoritative: it starts/resumes, scores,
 * advances the engine and decides completion — the client never computes correctness, progress, or the next item.
 */

/** GET /api/assessments/placement/availability — non-leaky probe, `{ available }` only (never a reason). */
export function checkPlacementAvailability(learningIntentId: string): Promise<{ available: boolean }> {
  return apiRequest<{ available: boolean }>(`/api/assessments/placement/availability?learningIntentId=${encodeURIComponent(learningIntentId)}`);
}

/** POST /api/assessments/placement/start — start OR resume the learner's own in-progress attempt (idempotent). */
export function startPlacement(learningIntentId: string): Promise<AttemptView> {
  return apiRequest<AttemptView>('/api/assessments/placement/start', { method: 'POST', body: { learningIntentId } });
}

/** GET /api/assessments/attempts/:attemptId — pure read; NEVER advances on reload. */
export function getAttempt(attemptId: string): Promise<AttemptView> {
  return apiRequest<AttemptView>(`/api/assessments/attempts/${attemptId}`);
}

/** POST /api/assessments/attempts/:attemptId/responses — server scores + advances; returns the next AttemptView. */
export function submitResponse(attemptId: string, itemId: string, answer: PlacementAnswer): Promise<AttemptView> {
  return apiRequest<AttemptView>(`/api/assessments/attempts/${attemptId}/responses`, { method: 'POST', body: { itemId, answer } });
}
