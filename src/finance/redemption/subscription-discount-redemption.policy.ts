/**
 * Pure subscription-discount redemption policy (Phase 2.1C-2, subscription-discount-redemption-v1, TD-173).
 * Deterministic integer economics — no Prisma / HTTP / Clock. The spending ceiling base is the concrete
 * PaymentOrder gross price (NEVER the SubscriptionCycle earning ceiling). Value = amountIzl × rate (exact, no
 * rounding). BigInt intermediate guards against Int overflow before the ceiling comparison.
 */
export const SUBSCRIPTION_DISCOUNT_REDEMPTION_VERSION = 'subscription-discount-redemption-v1';
export const SUBSCRIPTION_DISCOUNT_CEILING_BP = 2000; // 20%
export const REDEMPTION_RESERVATION_PURPOSE = 'SUBSCRIPTION_DISCOUNT_REDEMPTION';

/** maxDiscountUzs = floor(grossAmount × 2000 / 10000) — integer-safe (gross ≤ 2^31 so no overflow in Number). */
export function maxDiscountUzs(grossAmount: number): number {
  return Math.floor((grossAmount * SUBSCRIPTION_DISCOUNT_CEILING_BP) / 10000);
}

export type RedemptionEvaluation =
  | { ok: true; valueUzs: number }
  | { ok: false; reason: 'non_positive_amount' | 'exceeds_ceiling' | 'insufficient_available' };

/**
 * Validate a redemption request against the frozen order gross, the resolved rate, and the canonical available IZL.
 * `valueUzs` (exact integer) is returned only when eligible; it is guaranteed ≤ ceiling ≤ gross ≤ Int max.
 */
export function evaluateRedemption(input: { grossAmount: number; amountIzl: number; rateUzsPerIzl: number; availableIzl: number }): RedemptionEvaluation {
  if (!Number.isInteger(input.amountIzl) || input.amountIzl <= 0) return { ok: false, reason: 'non_positive_amount' };

  const value = BigInt(input.amountIzl) * BigInt(input.rateUzsPerIzl); // exact; may exceed Int range
  const ceiling = BigInt(maxDiscountUzs(input.grossAmount));
  if (value > ceiling || value > BigInt(input.grossAmount)) return { ok: false, reason: 'exceeds_ceiling' }; // also catches overflow (value > ceiling ≤ gross)

  if (input.amountIzl > Math.max(input.availableIzl, 0)) return { ok: false, reason: 'insufficient_available' };
  return { ok: true, valueUzs: Number(value) }; // safe: value ≤ gross ≤ 2^31
}
