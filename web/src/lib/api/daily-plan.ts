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
