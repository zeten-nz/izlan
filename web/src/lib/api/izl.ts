import { apiRequest } from './client';
import type { IzlBalance } from './types';

/**
 * IZL API (Phase 05). IZL is the platform REWARD CURRENCY wallet — a DISTINCT system from XP (never combined, never
 * relabelled as "XP"). Backend grants IZL automatically via domain events (mission completions); Phase 05 is strictly
 * READ-ONLY: it exposes only the balance. The real buy/withdraw/transfer flows do not exist, and the redemption
 * (subscription-discount) mutations are deliberately NOT wired here — no Finance behaviour in this phase.
 */

/** GET /api/izl/me — the learner's IZL wallet (available / total / reserved, integer units; 0-state is {0,0,0}). */
export function getIzlBalance(): Promise<IzlBalance> {
  return apiRequest<IzlBalance>('/api/izl/me');
}
