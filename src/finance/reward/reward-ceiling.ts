/**
 * Pure subscription-cycle earning-ceiling arithmetic (Phase 2.1G-D, TD-197). No Prisma / Clock. The earning ceiling
 * is 20% of the NET (actually-paid) amount, converted to IZL by flooring against the frozen rate. These are the
 * future authorities for a reward-ENABLED `SubscriptionCycle` snapshot (§7/§8/§38); no cycle is created here and no
 * runtime path calls these yet. IZL-discounted value that was not paid in fiat never inflates earning capacity.
 */
export const REWARD_CEILING_BP = 2000; // 20% in basis points (of 10000)

/** rewardCeilingUzs = floor(rewardBasisUzs × 20%). rewardBasisUzs = PaymentOrder.payableAmount (net, TD-197). */
export function rewardCeilingUzs(rewardBasisUzs: number): number {
  return Math.floor((rewardBasisUzs * REWARD_CEILING_BP) / 10000); // integer-safe: basis ≤ 2^31, ×2000 ≤ 2^53
}

/** rewardCeilingIzl = floor(rewardCeilingUzs / rateUzsPerIzl). Below one IZL's worth ⇒ 0. No rounding-up (§8). */
export function rewardCeilingIzl(ceilingUzs: number, rateUzsPerIzl: number): number {
  if (rateUzsPerIzl <= 0) return 0; // reward-disabled / invalid rate ⇒ no earning capacity
  return Math.floor(ceilingUzs / rateUzsPerIzl);
}
