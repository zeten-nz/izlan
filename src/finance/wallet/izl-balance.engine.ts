/**
 * Pure IZL balance engine (Phase 2.1B, TD-157). Derives the canonical balance triple from the two authoritative
 * sources. No Prisma / HTTP / Clock. This does NOT authorize reservations by itself (§66). Signed integer math —
 * `available` may be negative after an accounting correction (never clamped, §6/§43).
 */
export const IZL_WALLET_PROJECTION_VERSION = 'izl-wallet-projection-v1';

export interface IzlBalance {
  balanceIzl: number; // = SUM(IZLLedgerEntry.amount), signed (accounting authority)
  reservedIzl: number; // = SUM(ACTIVE IZLReservation.amount), >= 0
  availableIzl: number; // = balance - reserved (signed; may be negative)
}

export function computeIzlBalance(ledgerBalanceIzl: number, activeReservedIzl: number): IzlBalance {
  return { balanceIzl: ledgerBalanceIzl, reservedIzl: activeReservedIzl, availableIzl: ledgerBalanceIzl - activeReservedIzl };
}
