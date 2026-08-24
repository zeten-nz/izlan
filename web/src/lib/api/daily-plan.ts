import { apiRequest } from './client';
import { isNotFound } from './errors';
import type { DailyPlan } from './types';

/**
 * GET /api/daily-plans/today — READ ONLY. Returns `null` when there is no plan yet (404 DAILY_PLAN_NOT_FOUND is an
 * ordinary no-plan state). The learner dashboard NEVER calls the POST generator — page loads must not mutate state.
 */
export async function fetchTodayPlan(): Promise<DailyPlan | null> {
  try {
    return await apiRequest<DailyPlan>('/api/daily-plans/today');
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

/**
 * POST /api/daily-plans/today — generate-or-return today's plan (idempotent per local day, one Topic per day). NO body:
 * the backend derives the date/timezone/topic/items. Called ONLY from an explicit learner action, never on page load.
 * May throw ApiError DAILY_PLAN_NO_EXECUTABLE_CONTENT (409) — a truthful "nothing to do yet" state, not a failure.
 */
export function generateTodayPlan(): Promise<DailyPlan> {
  return apiRequest<DailyPlan>('/api/daily-plans/today', { method: 'POST' });
}
