/**
 * Pure IZL reservation policy (Phase 2.1B, TD-158, §67). Decides whether a hold may be created from a canonical
 * available balance. No Prisma / HTTP / Clock / wallet reads. A new hold requires a positive amount that fits the
 * currently spendable (non-negative) availability — a hold never deepens an already-negative availability (§7).
 */
export const IZL_RESERVATION_VERSION = 'izl-reservation-v1';

export type CanReserveResult = { ok: true } | { ok: false; reason: 'non_positive_amount' | 'insufficient_available' };

export function canReserve(input: { availableIzl: number; requestedIzl: number }): CanReserveResult {
  if (!Number.isInteger(input.requestedIzl) || input.requestedIzl <= 0) return { ok: false, reason: 'non_positive_amount' };
  if (input.requestedIzl > Math.max(input.availableIzl, 0)) return { ok: false, reason: 'insufficient_available' };
  return { ok: true };
}
