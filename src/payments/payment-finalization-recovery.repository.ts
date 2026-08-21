import { Injectable } from '@nestjs/common';
import { PaymentOrderStatus, PaymentTransactionStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

/** Backlog authority (§4/FR-01): a SUCCEEDED PaymentTransaction whose PaymentOrder is still PENDING. */
const BACKLOG_WHERE = { status: PaymentTransactionStatus.SUCCEEDED, paymentOrder: { is: { status: PaymentOrderStatus.PENDING } } } as const;

export interface BacklogItem {
  paymentTransactionId: string;
  paymentOrderId: string;
  userId: string;
  confirmedAt: Date | null;
  payableAmount: number;
  currency: string;
  discounted: boolean;
}

/**
 * Verified-payment finalization backlog reader (Phase 2.1H). READ-ONLY — selects the trusted-but-unfinalized backlog
 * (SUCCEEDED transaction + PENDING order). It performs NO writes: recovery mutations go only through the existing
 * PaymentFinalizationService (§46/§63). PV-DB-01 guarantees one SUCCEEDED transaction per order, so each PENDING order
 * resolves to exactly one trusted transaction.
 */
@Injectable()
export class PaymentFinalizationRecoveryRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Oldest-verified-first backlog page (§5 — confirmedAt ASC, id ASC). Bounded by `limit`. */
  async backlogItems(limit: number): Promise<BacklogItem[]> {
    const rows = await this.prisma.paymentTransaction.findMany({
      where: BACKLOG_WHERE,
      orderBy: [{ confirmedAt: 'asc' }, { id: 'asc' }],
      take: limit,
      select: { id: true, confirmedAt: true, paymentOrder: { select: { id: true, userId: true, payableAmount: true, currency: true, izlRedemptionId: true } } },
    });
    return rows.map((r) => ({
      paymentTransactionId: r.id,
      paymentOrderId: r.paymentOrder.id,
      userId: r.paymentOrder.userId,
      confirmedAt: r.confirmedAt,
      payableAmount: r.paymentOrder.payableAmount,
      currency: r.paymentOrder.currency,
      discounted: r.paymentOrder.izlRedemptionId !== null,
    }));
  }

  /** Total backlog size (SUCCEEDED + PENDING). */
  backlogCount(): Promise<number> {
    return this.prisma.paymentTransaction.count({ where: BACKLOG_WHERE });
  }
}
