import { divRoundHalfUp } from '../../learning-progress/merge/merge-core';

/** IMMUTABLE review-mastery contract identifier (TD-129). A math change ships as review-mastery-v2. */
export const REVIEW_MASTERY_DERIVATION_VERSION = 'review-mastery-v1';

export interface ReviewMasteryResult {
  scoreBp: number;
  confidenceBp: number;
  evidenceCount: number;
}

/**
 * review-mastery-v1 (TD-129). Pure/deterministic. Input = the best deterministic score per selected
 * ReviewSessionActivity (already target-Skill-scoped at session creation). score = round(arithmetic mean),
 * clamped 0..10000; confidenceBp = 10000 (complete coverage of the configured snapshot, §12); evidenceCount =
 * number of DISTINCT selected activities (§13). No source re-attribution.
 */
export function deriveReviewMastery(bestScoresPerActivity: number[]): ReviewMasteryResult {
  const n = bestScoresPerActivity.length;
  if (n === 0) throw new Error('review mastery requires at least one selected activity'); // guarded by caller (§17)
  const sum = bestScoresPerActivity.reduce<bigint>((acc, s) => acc + BigInt(s), 0n);
  const scoreBp = Math.min(10000, Math.max(0, Number(divRoundHalfUp(sum, BigInt(n)))));
  return { scoreBp, confidenceBp: 10000, evidenceCount: n };
}
