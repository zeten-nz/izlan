import { Injectable } from '@nestjs/common';
import { PaymentOrderStatus, PaymentTransactionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

/**
 * Actionable stuck-reopen backlog (§5/RR-01): a PENDING PaymentOrder that has a terminal (FAILED/CANCELLED) attempt but
 * NO live (PENDING) and NO SUCCEEDED attempt — i.e. terminal provider evidence exists yet the order was never reopened.
 * Eligibility is still revalidated under the `pay(order)` lock inside PaymentOrderReopenService (§4 — no SELECT is
 * mutation authority).
 */
const BACKLOG_WHERE: Prisma.PaymentOrderWhereInput = {
  status: PaymentOrderStatus.PENDING,
  transactions: {
    some: { status: { in: [PaymentTransactionStatus.FAILED, PaymentTransactionStatus.CANCELLED] } },
    none: { status: { in: [PaymentTransactionStatus.PENDING, PaymentTransactionStatus.SUCCEEDED] } },
  },
};

export interface ReopenBacklogItem {
  paymentOrderId: string;
  userId: string;
  terminalPaymentTransactionId: string;
  terminalStatus: PaymentTransactionStatus;
  provider: string;
  terminalAt: Date;
  payableAmount: number;
  currency: string;
  discounted: boolean;
}

/**
 * Terminal-reopen recovery backlog reader (Phase 2.1K). READ-ONLY. Performs NO writes: recovery mutations go only
 * through the existing PaymentOrderReopenService (§41/§60). Each stuck order carries one deterministic terminal attempt
 * (its most recent FAILED/CANCELLED PT) as the reopen-service input — retry safety is order-wide (no PENDING / no
 * SUCCEEDED), not "which terminal attempt was last" (§6).
 */
@Injectable()
export class PaymentReopenRecoveryRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Oldest-stuck-first backlog page (§7 — order.createdAt ASC, id ASC). Bounded by `limit`. */
  async backlogItems(limit: number): Promise<ReopenBacklogItem[]> {
    const orders = await this.prisma.paymentOrder.findMany({
      where: BACKLOG_WHERE,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit,
      select: {
        id: true,
        userId: true,
        payableAmount: true,
        currency: true,
        izlRedemptionId: true,
        transactions: {
          where: { status: { in: [PaymentTransactionStatus.FAILED, PaymentTransactionStatus.CANCELLED] } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
          select: { id: true, status: true, provider: true, createdAt: true },
        },
      },
    });
    return orders.map((o) => ({
      paymentOrderId: o.id,
      userId: o.userId,
      terminalPaymentTransactionId: o.transactions[0].id,
      terminalStatus: o.transactions[0].status,
      provider: o.transactions[0].provider,
      terminalAt: o.transactions[0].createdAt,
      payableAmount: o.payableAmount,
      currency: o.currency,
      discounted: o.izlRedemptionId !== null,
    }));
  }

  /** Total actionable stuck-reopen backlog size. */
  backlogCount(): Promise<number> {
    return this.prisma.paymentOrder.count({ where: BACKLOG_WHERE });
  }
}
