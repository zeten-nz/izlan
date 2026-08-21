import { Injectable } from '@nestjs/common';
import { IzlReservationStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { IZL_WALLET_PROJECTION_VERSION } from './izl-balance.engine';

/**
 * IZL wallet projection persistence (Phase 2.1B). READS the two canonical sources (ledger + ACTIVE reservations).
 * WRITES only the `izl_wallet` projection (rebuildable cache, never authority). Repair direction is always
 * ledger + reservations → wallet (§9). Never writes ledger / reservations / reward / XP.
 */
@Injectable()
export class IzlWalletRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Canonical signed IZL balance = SUM over the append-only ledger (TD-150 authority). Null → 0. */
  async ledgerBalance(userId: string): Promise<number> {
    const agg = await this.prisma.iZLLedgerEntry.aggregate({ where: { userId }, _sum: { amount: true } });
    return agg._sum.amount ?? 0;
  }

  /** Canonical reserved IZL = SUM of ACTIVE reservation amounts (>= 0). Null → 0. */
  async activeReservedTotal(userId: string): Promise<number> {
    const agg = await this.prisma.iZLReservation.aggregate({ where: { userId, status: IzlReservationStatus.ACTIVE }, _sum: { amountIzl: true } });
    return agg._sum.amountIzl ?? 0;
  }

  /**
   * Rebuild the wallet projection from the COMPLETE canonical sources (§11/§12). Per-user IZL advisory lock (same
   * namespace as reward posting + reservation, §50) — full recompute, never incremental. Mirrors signed balance /
   * reserved (the non-negative wallet CHECKs were dropped in migration 14). Never touches ledger/reservations.
   */
  async recomputeWallet(userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'izl'}), hashtext(${userId}))`;
      const [ledgerAgg, reservedAgg] = await Promise.all([
        tx.iZLLedgerEntry.aggregate({ where: { userId }, _sum: { amount: true }, _max: { entryNo: true } }),
        tx.iZLReservation.aggregate({ where: { userId, status: IzlReservationStatus.ACTIVE }, _sum: { amountIzl: true } }),
      ]);
      const balance = ledgerAgg._sum.amount ?? 0;
      const reserved = reservedAgg._sum.amountIzl ?? 0;
      const lastEntryNo = ledgerAgg._max.entryNo ?? 0;
      await tx.iZLWallet.upsert({
        where: { userId },
        create: { userId, balance, reservedAmount: reserved, lastEntryNo, projectionVersionCode: IZL_WALLET_PROJECTION_VERSION },
        update: { balance, reservedAmount: reserved, lastEntryNo, projectionVersionCode: IZL_WALLET_PROJECTION_VERSION },
      });
    });
  }
}
