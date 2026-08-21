import { Injectable } from '@nestjs/common';
import { PaymentOrderStatus, PaymentTransactionStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

export type PaymentReopenOutcome =
  | 'REOPENED' // PENDING → CREATED this call
  | 'ALREADY_REOPENED' // already CREATED, no live/success attempt — idempotent no-op
  | 'RETRY_ALREADY_IN_PROGRESS' // a PENDING attempt already exists (a retry is live)
  | 'PAYMENT_SUCCESS_PENDING_FINALIZATION' // a SUCCEEDED attempt exists — finalization territory (2.1G/2.1H)
  | 'ALREADY_PAID' // order already PAID
  | 'NOT_REOPENABLE'; // PT not terminal non-success / order not in a reopenable state / integrity

export interface PaymentReopenResult {
  outcome: PaymentReopenOutcome;
  paymentTransactionId: string;
  paymentOrderId: string | null;
  reason?: string;
}

/**
 * Payment order reopen (Phase 2.1J, payment-order-reopen-retry-v1). Given a DEFINITIVELY terminal (FAILED/CANCELLED)
 * PaymentTransaction, make its own PENDING PaymentOrder retryable again by transitioning **PENDING → CREATED** — the
 * ONLY field it writes (§3/§19/§91). It never mutates the terminal transaction, never touches IZL/Subscription, never
 * calls a provider. Reopen is refused whenever a live PENDING or SUCCEEDED attempt exists for the order (stale-terminal
 * protection, §10/§11/§48/§49) or the order is PAID (§12/§50). Order expiry does NOT block reopen (§18) — the existing
 * initiate flow rejects an expired attempt, and CREATED re-enables the 2.1D committed-discount release.
 */
@Injectable()
export class PaymentOrderReopenRepository {
  constructor(private readonly prisma: PrismaService) {}

  async reopen(paymentTransactionId: string): Promise<PaymentReopenResult> {
    const pt0 = await this.prisma.paymentTransaction.findUnique({ where: { id: paymentTransactionId }, select: { paymentOrderId: true } });
    if (!pt0) return { outcome: 'NOT_REOPENABLE', paymentTransactionId, paymentOrderId: null, reason: 'TRANSACTION_NOT_FOUND' };
    const lockKey = pt0.paymentOrderId;
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'pay'}), hashtext(${lockKey}))`; // §7 — pay lock only (no izl/sub)

      // 1. terminal-attempt authority (§5) — reload under lock; only FAILED/CANCELLED may authorize reopen
      const pt = await tx.paymentTransaction.findUnique({ where: { id: paymentTransactionId }, select: { status: true, paymentOrderId: true } });
      if (!pt) return { outcome: 'NOT_REOPENABLE' as const, paymentTransactionId, paymentOrderId: null, reason: 'TRANSACTION_NOT_FOUND' };
      if (pt.status !== PaymentTransactionStatus.FAILED && pt.status !== PaymentTransactionStatus.CANCELLED) {
        return { outcome: 'NOT_REOPENABLE', paymentTransactionId, paymentOrderId: pt.paymentOrderId, reason: 'TRANSACTION_NOT_TERMINAL' }; // §59/§60 PENDING/SUCCEEDED
      }

      // 2. exact order + order-wide live/success authority (§6/§8/§9)
      const order = await tx.paymentOrder.findUnique({ where: { id: pt.paymentOrderId }, select: { id: true, status: true } });
      if (!order) return { outcome: 'NOT_REOPENABLE', paymentTransactionId, paymentOrderId: pt.paymentOrderId, reason: 'ORDER_NOT_FOUND' };
      const [pendingCount, succeeded] = await Promise.all([
        tx.paymentTransaction.count({ where: { paymentOrderId: order.id, status: PaymentTransactionStatus.PENDING } }),
        tx.paymentTransaction.findFirst({ where: { paymentOrderId: order.id, status: PaymentTransactionStatus.SUCCEEDED }, select: { id: true } }),
      ]);

      // 3. decision — never compete with a live retry, a success, or a paid purchase
      if (order.status === PaymentOrderStatus.PAID) return { outcome: 'ALREADY_PAID', paymentTransactionId, paymentOrderId: order.id }; // §12/§50
      if (succeeded) return { outcome: 'PAYMENT_SUCCESS_PENDING_FINALIZATION', paymentTransactionId, paymentOrderId: order.id }; // §11/§16/§49 — finalization owns it
      if (pendingCount > 0) {
        if (order.status === PaymentOrderStatus.CREATED) return { outcome: 'NOT_REOPENABLE', paymentTransactionId, paymentOrderId: order.id, reason: 'INTEGRITY_CREATED_WITH_PENDING' }; // §14 — no silent repair
        return { outcome: 'RETRY_ALREADY_IN_PROGRESS', paymentTransactionId, paymentOrderId: order.id }; // §15/§48 — a live retry exists
      }
      // no PENDING, no SUCCEEDED
      if (order.status === PaymentOrderStatus.CREATED) return { outcome: 'ALREADY_REOPENED', paymentTransactionId, paymentOrderId: order.id }; // §13 idempotent
      if (order.status === PaymentOrderStatus.PENDING) {
        await tx.paymentOrder.update({ where: { id: order.id }, data: { status: PaymentOrderStatus.CREATED } }); // §9 — ONLY status; expiry not checked (§18)
        return { outcome: 'REOPENED', paymentTransactionId, paymentOrderId: order.id };
      }
      return { outcome: 'NOT_REOPENABLE', paymentTransactionId, paymentOrderId: order.id, reason: 'ORDER_STATE' }; // §17 FAILED/CANCELLED/EXPIRED order — no retry semantics
    });
  }
}
