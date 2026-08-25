import { apiRequest } from './client';
import type { DailyMissionsView } from './types';

/**
 * Daily missions / rewards status API (Phase 05). The backend owns a fixed catalog of exactly two missions
 * (LEARN_TODAY, MASTERY_TEST_90); the read model reports only per-mission completion status and carries NO reward /
 * XP / IZL amount fields. Rewards are granted automatically by backend domain events — there is NO learner "claim"
 * command, so this surface is strictly read-only. Human-readable mission labels are a frontend mapping of the codes.
 */

/** GET /api/daily-missions/me/today — today's missions with completion status (own user; local-day scoped by the token). */
export function fetchTodayMissions(): Promise<DailyMissionsView> {
  return apiRequest<DailyMissionsView>('/api/daily-missions/me/today');
}
