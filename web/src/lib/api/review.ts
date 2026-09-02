import { apiRequest } from './client';
import type { ActivityAnswer, ActivityAttemptView, ReviewCandidateResult, ReviewSessionView, StructuredAnswer } from './types';

/**
 * Review API (Phase 04). Backend decides candidacy, scoring, mastery and completion. The learner UI only presents the
 * candidate read-model and drives a real review session; it never creates/resolves signals or mutates mastery.
 */

/**
 * GET /api/review-candidates/me/subjects/:subjectId — the review candidate read-model. Always 200: no candidates is an
 * ordinary product state ({ groups: [], uncoveredSkillIds: [] }), not an error.
 */
export function fetchReviewCandidates(subjectId: string): Promise<ReviewCandidateResult> {
  return apiRequest<ReviewCandidateResult>(`/api/review-candidates/me/subjects/${subjectId}`);
}

/**
 * POST /api/review-sessions/me/subjects/:subjectId/skills/:skillId/lessons/:lessonId/start — start OR resume the review
 * session for a candidate (skill+lesson pair). No body; returns the full session view (all activities up front).
 */
export function startReviewSession(subjectId: string, skillId: string, lessonId: string): Promise<ReviewSessionView> {
  return apiRequest<ReviewSessionView>(`/api/review-sessions/me/subjects/${subjectId}/skills/${skillId}/lessons/${lessonId}/start`, { method: 'POST' });
}

/** GET /api/review-sessions/:sessionId — resume a session (pinned revision, per-activity attempt state). */
export function getReviewSession(sessionId: string): Promise<ReviewSessionView> {
  return apiRequest<ReviewSessionView>(`/api/review-sessions/${sessionId}`);
}

/** POST /api/review-sessions/:sessionId/activities/:activityId/attempts — submit an answer; server scores (isCorrect). */
export function submitReviewActivity(sessionId: string, activityId: string, answer: ActivityAnswer | StructuredAnswer): Promise<ActivityAttemptView> {
  return apiRequest<ActivityAttemptView>(`/api/review-sessions/${sessionId}/activities/${activityId}/attempts`, {
    method: 'POST',
    body: { clientRequestId: crypto.randomUUID(), answer },
  });
}

/** POST /api/review-sessions/:sessionId/complete — finalize (server requires every activity attempted). Idempotent. */
export function completeReviewSession(sessionId: string): Promise<ReviewSessionView> {
  return apiRequest<ReviewSessionView>(`/api/review-sessions/${sessionId}/complete`, { method: 'POST' });
}
