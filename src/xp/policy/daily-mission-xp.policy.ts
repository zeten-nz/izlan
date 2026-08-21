import {
  LEARN_TODAY,
  LEARN_TODAY_VERSION,
  MASTERY_TEST_90,
  MASTERY_TEST_90_VERSION,
} from '../../daily-mission/mission/daily-mission.policy';

/**
 * Pure Daily Mission → XP reward policy (Phase 2.0C-2, TD-140). Immutable v1 mapping keyed by BOTH the mission
 * code AND the mission producer version — a future producer version (e.g. learn-today-mission-v2) must NOT
 * inherit the v1 amount (§16). No Prisma / HTTP / Clock / ActivityAttempt interpretation. XP only; never IZL.
 */
export const DAILY_MISSION_XP_REWARD_VERSION = 'daily-mission-xp-reward-v1';

/** XpGrant.reason_code source category for mission XP (registry string). */
export const DAILY_MISSION_XP_REASON_CODE = 'DAILY_MISSION';

export interface XpPolicyInput {
  missionCode: string;
  missionPolicyVersion: string;
}

export type XpPolicyResult =
  | { eligible: true; amount: number; reasonCode: string; policyVersionCode: string }
  | { eligible: false };

/** (missionCode, missionPolicyVersion) → immutable XP amount. Unknown pair → not eligible (no default). */
const XP_TABLE: ReadonlyArray<{ code: string; version: string; amount: number }> = [
  { code: LEARN_TODAY, version: LEARN_TODAY_VERSION, amount: 10 },
  { code: MASTERY_TEST_90, version: MASTERY_TEST_90_VERSION, amount: 20 },
];

/** Mission codes whose producer this reward policy recognizes (query pre-filter for reconcile, §37). */
export const XP_SUPPORTED_MISSION_CODES: readonly string[] = XP_TABLE.map((r) => r.code);

export function evaluateDailyMissionXp(input: XpPolicyInput): XpPolicyResult {
  const row = XP_TABLE.find((r) => r.code === input.missionCode && r.version === input.missionPolicyVersion);
  if (!row) return { eligible: false }; // unknown mission code or producer version → no grant (§15/16/53/54)
  return { eligible: true, amount: row.amount, reasonCode: DAILY_MISSION_XP_REASON_CODE, policyVersionCode: DAILY_MISSION_XP_REWARD_VERSION };
}
