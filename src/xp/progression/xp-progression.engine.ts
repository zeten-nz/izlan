/**
 * Pure XP progression engine (Phase 2.0D, xp-progression-v1, TD-145). Deterministic integer level curve derived
 * from signed total XP. No Prisma / HTTP / Clock. XpGrant remains the XP source of truth; this only projects a
 * total into a level + progress. No max level, no level rewards.
 */
export const XP_PROGRESSION_VERSION = 'xp-progression-v1';

/**
 * Cumulative XP required to BE level L (L >= 1): threshold(L) = 100·(L-1)·L/2 = 50·(L-1)·L. Integer-exact.
 * L1→0, L2→100, L3→300, L4→600, L5→1000, L6→1500, L10→4500.
 */
export function levelThreshold(level: number): number {
  return 50 * (level - 1) * level;
}

/** Max integer level L >= 1 with threshold(L) <= progressionXp. Integer binary search — no float boundary error. */
export function levelForXp(progressionXp: number): number {
  if (progressionXp <= 0) return 1; // threshold(1) = 0
  let lo = 1;
  let hi = 2;
  while (levelThreshold(hi) <= progressionXp) {
    lo = hi;
    hi *= 2;
  } // threshold(lo) <= P < threshold(hi)
  while (lo < hi - 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (levelThreshold(mid) <= progressionXp) lo = mid;
    else hi = mid;
  }
  return lo;
}

export interface XpProgression {
  totalXp: number; // signed authoritative total (SUM of XpGrant.amount)
  progressionXp: number; // max(totalXp, 0) — the value the level curve consumes
  currentLevel: number; // >= 1
  currentLevelStartXp: number;
  nextLevelXp: number;
  xpIntoLevel: number;
  xpToNextLevel: number;
  progressBp: number; // 0..9999
  progressionVersion: string;
}

/** Project a signed total XP into the xp-progression-v1 contract. */
export function computeXpProgression(totalXp: number): XpProgression {
  const progressionXp = Math.max(totalXp, 0); // negative accounting total never lowers below level 1 (§7)
  const currentLevel = levelForXp(progressionXp);
  const currentLevelStartXp = levelThreshold(currentLevel);
  const nextLevelXp = levelThreshold(currentLevel + 1);
  const range = nextLevelXp - currentLevelStartXp; // = 100 · currentLevel (> 0)
  const xpIntoLevel = progressionXp - currentLevelStartXp;
  const xpToNextLevel = nextLevelXp - progressionXp;
  const progressBp = Math.min(9999, Math.max(0, Math.floor((xpIntoLevel * 10000) / range))); // exact threshold → next level, so cap at 9999
  return { totalXp, progressionXp, currentLevel, currentLevelStartXp, nextLevelXp, xpIntoLevel, xpToNextLevel, progressBp, progressionVersion: XP_PROGRESSION_VERSION };
}
