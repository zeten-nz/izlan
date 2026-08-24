import { apiRequest } from './client';
import type { ActivityAnswer, ActivityAttemptView, LessonCompletionView, LessonExecutionView } from './types';

/**
 * Lesson Execution API (Phase 04). Backend is authoritative for the pinned revision, progression, scoring and
 * completion — the client never scores, never advances an authoritative index, and never fabricates completion.
 * The ONLY entry point is start-or-resume from a CURRENT daily-plan item (§8): there is no arbitrary lesson start.
 */

/** POST /api/lesson-executions/daily-plan-items/:dailyPlanItemId/start — start OR resume (idempotent; never duplicates). */
export function startLesson(dailyPlanItemId: string): Promise<LessonExecutionView> {
  return apiRequest<LessonExecutionView>(`/api/lesson-executions/daily-plan-items/${dailyPlanItemId}/start`, { method: 'POST' });
}

/** GET /api/lesson-executions/:lessonId — resume the current execution (pinned revision + all activities). */
export function getLessonExecution(lessonId: string): Promise<LessonExecutionView> {
  return apiRequest<LessonExecutionView>(`/api/lesson-executions/${lessonId}`);
}

/**
 * POST /api/lesson-executions/:lessonId/activities/:activityId/attempts — submit an objective answer; the server scores
 * and returns correctness (never an explanation or answerKey). A fresh clientRequestId per submit; the disabled-while-
 * pending button guards double submits, and a genuine retry is a new attempt (append-only evidence).
 */
export function submitLessonActivity(lessonId: string, activityId: string, answer: ActivityAnswer): Promise<ActivityAttemptView> {
  return apiRequest<ActivityAttemptView>(`/api/lesson-executions/${lessonId}/activities/${activityId}/attempts`, {
    method: 'POST',
    body: { clientRequestId: crypto.randomUUID(), answer },
  });
}

/** POST /api/lesson-executions/:lessonId/activities/:activityId/complete — acknowledge a view-only step (markdown/media). */
export function completeViewStep(lessonId: string, activityId: string): Promise<{ lessonId: string; activityId: string; recorded: boolean }> {
  return apiRequest(`/api/lesson-executions/${lessonId}/activities/${activityId}/complete`, { method: 'POST' });
}

/** POST /api/lesson-executions/:lessonId/complete — finalize (server verifies every activity was performed). Idempotent. */
export function completeLesson(lessonId: string): Promise<LessonCompletionView> {
  return apiRequest<LessonCompletionView>(`/api/lesson-executions/${lessonId}/complete`, { method: 'POST' });
}
