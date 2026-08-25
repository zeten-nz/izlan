import { apiRequest } from './client';
import type { XpProgression } from './types';

/**
 * XP API (Phase 05). XP is a LEARNING-PROGRESS score with a real backend level curve (xp-progression-v1). It is a
 * DISTINCT system from IZL (the platform reward currency) and must never be combined with it. Backend is the sole
 * authority: XP is granted only by backend domain side effects (daily-mission completions), so the client only reads —
 * it never grants, increments, or infers XP, and there is no history/ledger endpoint to expose.
 */

/** GET /api/xp/me — the learner's current XP total + level progression (not subject-scoped; own user only). */
export function getXpProgression(): Promise<XpProgression> {
  return apiRequest<XpProgression>('/api/xp/me');
}
