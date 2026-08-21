/**
 * Pure Daily Mission → IZL reward policy (Phase 2.1A, izl-reward-policy/v1, TD-151). Strict parser for the
 * RewardPolicyVersion.config economic contract + eligibility evaluation keyed by mission code AND producer version.
 * No Prisma / HTTP / Clock. IZL is a real-value asset — malformed economic config is rejected, never loosely read.
 */
export const IZL_REWARD_POLICY_SCHEMA_VERSION = 'izl-reward-policy/v1';

/** Mission codes this producer can ever reward (query pre-filter for reconcile; per-cycle policy decides amount). */
export const IZL_SUPPORTED_MISSION_CODES: readonly string[] = ['MASTERY_TEST_90'];

export interface IzlRewardPolicy {
  schemaVersion: string;
  dailyMissionRewards: Record<string, { missionPolicyVersion: string; amountIzl: number }>;
  caps: { dailyMissionIzlPerLocalDate: number; dailyMissionIzlPerCycle: number };
}

export class IzlRewardConfigError extends Error {}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isPosInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;
const isNonNegInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** Strict TD-92 validation of a RewardPolicyVersion.config into a typed IZL policy. Throws on anything malformed. */
export function parseIzlRewardPolicyConfig(config: unknown): IzlRewardPolicy {
  if (!isRecord(config)) throw new IzlRewardConfigError('config not an object');
  if (config.schemaVersion !== IZL_REWARD_POLICY_SCHEMA_VERSION) throw new IzlRewardConfigError('unknown schemaVersion');
  const rewards = config.dailyMissionRewards;
  const caps = config.caps;
  if (!isRecord(rewards)) throw new IzlRewardConfigError('dailyMissionRewards missing');
  if (!isRecord(caps)) throw new IzlRewardConfigError('caps missing');
  if (!isNonNegInt(caps.dailyMissionIzlPerLocalDate)) throw new IzlRewardConfigError('daily cap invalid');
  if (!isNonNegInt(caps.dailyMissionIzlPerCycle)) throw new IzlRewardConfigError('cycle cap invalid');

  const dailyMissionRewards: IzlRewardPolicy['dailyMissionRewards'] = {};
  for (const [code, raw] of Object.entries(rewards)) {
    if (!isRecord(raw)) throw new IzlRewardConfigError(`reward ${code} not an object`);
    if (typeof raw.missionPolicyVersion !== 'string' || raw.missionPolicyVersion.trim() === '') throw new IzlRewardConfigError(`reward ${code} missionPolicyVersion invalid`);
    if (!isPosInt(raw.amountIzl)) throw new IzlRewardConfigError(`reward ${code} amountIzl must be a positive integer`);
    if (raw.amountIzl > (caps.dailyMissionIzlPerLocalDate as number)) throw new IzlRewardConfigError(`reward ${code} amount exceeds daily cap`);
    dailyMissionRewards[code] = { missionPolicyVersion: raw.missionPolicyVersion, amountIzl: raw.amountIzl };
  }
  return { schemaVersion: IZL_REWARD_POLICY_SCHEMA_VERSION, dailyMissionRewards, caps: { dailyMissionIzlPerLocalDate: caps.dailyMissionIzlPerLocalDate, dailyMissionIzlPerCycle: caps.dailyMissionIzlPerCycle } };
}

export type IzlPolicyResult =
  | { eligible: true; amountIzl: number; dailyCapIzl: number; cycleCapIzl: number }
  | { eligible: false };

/** Evaluate a mission completion against a parsed cycle policy. Unknown mission code / producer version → not eligible. */
export function evaluateDailyMissionIzl(missionCode: string, missionPolicyVersion: string, policy: IzlRewardPolicy): IzlPolicyResult {
  const entry = policy.dailyMissionRewards[missionCode];
  if (!entry || entry.missionPolicyVersion !== missionPolicyVersion) return { eligible: false }; // §4/§60 exact pair required
  return { eligible: true, amountIzl: entry.amountIzl, dailyCapIzl: policy.caps.dailyMissionIzlPerLocalDate, cycleCapIzl: policy.caps.dailyMissionIzlPerCycle };
}
