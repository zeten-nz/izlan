import { Injectable } from '@nestjs/common';
import { IzlReservationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { IzlInsufficientAvailableError, IzlReservationConflictError } from '../../common/errors';
import { canReserve } from './izl-reservation.policy';

export interface ReservationInput {
  userId: string;
  amountIzl: number;
  idempotencyKey: string;
  purposeCode: string;
}

/**
 * IZL reservation persistence (Phase 2.1B). Creates/releases spendability holds under the per-user IZL advisory
 * lock (same namespace as reward posting + wallet recompute, §50). A reservation NEVER writes the ledger or a
 * RewardGrant (§35/§36). Availability is authorized from the canonical ledger + ACTIVE reservations under the lock
 * — never from the wallet cache (§23). Append/history-safe: no runtime DELETE; only ACTIVE → RELEASED (§33/§34).
 */
@Injectable()
export class IzlReservationRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create an ACTIVE hold, idempotent by (userId, idempotencyKey). Replay of the same logical request returns the
   * existing reservation (§19); a reused key with a different amount/purpose is a conflict (§20). Rejects if the
   * amount does not fit the current non-negative available balance (§7/§22).
   */
  async createReservation(input: ReservationInput) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'izl'}), hashtext(${input.userId}))`;

      const existing = await tx.iZLReservation.findUnique({ where: { userId_idempotencyKey: { userId: input.userId, idempotencyKey: input.idempotencyKey } } });
      if (existing) {
        if (existing.amountIzl !== input.amountIzl || existing.purposeCode !== input.purposeCode) throw new IzlReservationConflictError('idempotency key reused with different amount/purpose');
        return existing; // idempotent replay
      }

      const [ledgerAgg, reservedAgg] = await Promise.all([
        tx.iZLLedgerEntry.aggregate({ where: { userId: input.userId }, _sum: { amount: true } }),
        tx.iZLReservation.aggregate({ where: { userId: input.userId, status: IzlReservationStatus.ACTIVE }, _sum: { amountIzl: true } }),
      ]);
      const available = (ledgerAgg._sum.amount ?? 0) - (reservedAgg._sum.amountIzl ?? 0); // canonical, under lock (§23)
      if (!canReserve({ availableIzl: available, requestedIzl: input.amountIzl }).ok) throw new IzlInsufficientAvailableError('requested amount exceeds available izl');

      try {
        return await tx.iZLReservation.create({ data: { userId: input.userId, amountIzl: input.amountIzl, idempotencyKey: input.idempotencyKey, purposeCode: input.purposeCode, status: IzlReservationStatus.ACTIVE } });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          const raced = await tx.iZLReservation.findUnique({ where: { userId_idempotencyKey: { userId: input.userId, idempotencyKey: input.idempotencyKey } } });
          if (raced) return raced; // concurrent same-key create
        }
        throw e;
      }
    });
  }

  /** Transition ACTIVE → RELEASED (idempotent: an already-terminal reservation is returned unchanged, §27). Own-user. */
  async release(userId: string, reservationId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'izl'}), hashtext(${userId}))`;
      const res = await tx.iZLReservation.findFirst({ where: { id: reservationId, userId } });
      if (!res) return null; // not own / not found
      if (res.status !== IzlReservationStatus.ACTIVE) return res; // already terminal — idempotent
      return tx.iZLReservation.update({ where: { id: res.id }, data: { status: IzlReservationStatus.RELEASED, releasedAt: new Date() } });
    });
  }
}
