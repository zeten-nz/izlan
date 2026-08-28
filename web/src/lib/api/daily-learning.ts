import { apiRequest } from './client';
import { isNotFound } from './errors';

/**
 * V2 Daily Learning API — "what should I do today". The server is the sole authority for the day's plan (one main
 * new point per local day, reproducible), the prioritized next action (repair > review > learn > done), attention,
 * and progress. The client only renders backend-authoritative state and routes into the real Teaching/Review flows;
 * it never derives scoring/mastery/roadmap and never fabricates progress. answerKey/correctness are never received.
 */

export type DailyActionType = 'LEARN' | 'REPAIR' | 'REVIEW' | 'DONE';
export type DailyAttentionReason = 'REPEATED_MISTAKE' | 'PERSISTENT_WEAKNESS' | 'RETENTION_DUE' | null;

export interface DailyGoal {
  roadmapPointId: string;
  pointKey: string;
  title: string;
  estimatedEffortMin: number | null;
  canDo: string[];
  acquired: boolean;
  availability: 'LOCKED' | 'AVAILABLE' | 'IN_PROGRESS' | 'CONTENT_UNAVAILABLE';
  activeSessionId: string | null;
}

export interface DailyAction {
  type: DailyActionType;
  point: { roadmapPointId: string; pointKey: string; title: string } | null;
  skill: { id: string; name: string } | null; // the skill to review (REVIEW)
  reason: DailyAttentionReason;
}

export interface DailyAttention {
  roadmapPointId: string;
  pointKey: string;
  title: string;
  attention: 'REVIEW_DUE' | 'REPAIR_REQUIRED';
  attentionReason: DailyAttentionReason;
  attentionSkill: { id: string; name: string } | null;
}

export interface DailyView {
  localDate: string; // YYYY-MM-DD in the learner's timezone
  timezone: string;
  generationNo: number;
  status: string;
  policyVersion: string;
  engineVersion: string;
  subject: { id: string; title: string };
  mainGoal: DailyGoal | null;
  action: DailyAction;
  attention: DailyAttention[];
  progress: { mainGoalDone: boolean; roadmapAcquired: number; roadmapTotal: number };
  done: boolean;
}

/** GET today's plan for the learner's primary subject — READ ONLY. `null` when no plan has been generated yet (404). */
export async function fetchMyToday(): Promise<DailyView | null> {
  try {
    return await apiRequest<DailyView>('/api/v2/daily/me/today');
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

/**
 * POST today's plan — generate-or-return (idempotent per local day; one main new point per day). Called ONLY from an
 * explicit learner action, never on page load. May throw ApiError DAILY_LEARNING_UNAVAILABLE (409) — a truthful
 * "nothing to plan yet" state (no subject/roadmap/timezone), not a failure.
 */
export function generateMyToday(): Promise<DailyView> {
  return apiRequest<DailyView>('/api/v2/daily/me/today', { method: 'POST' });
}
