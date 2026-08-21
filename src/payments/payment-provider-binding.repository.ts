import { Injectable } from '@nestjs/common';
import { PaymentProvider, PaymentTransactionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

export type ProviderBindingOutcome =
  | 'BOUND' // external id was NULL → attached this call
  | 'ALREADY_BOUND' // same external id already attached — idempotent replay
  | 'CONFLICT' // provider mismatch, a different external id already attached, or the id belongs to another attempt
  | 'NOT_BINDABLE'; // transaction missing / not PENDING — a terminal attempt is never re-bound

export interface ProviderBindingResult {
  outcome: ProviderBindingOutcome;
  paymentTransactionId: string;
  provider: PaymentProvider;
  providerTransactionId: string;
  reason?: string;
}

/**
 * Non-terminal provider-transaction binding (Phase 2.1L-D, TD-234, §17). A narrow, provider-neutral primitive that
 * attaches a provider-native transaction id to an EXISTING PENDING PaymentTransaction during a provider-native
 * NON-terminal step (CLICK Prepare / Payme CreateTransaction). It writes ONLY `payment_transaction.provider_transaction_id`
 * (the single field), under the per-order pay advisory lock, and performs NO status transition, NO PaymentOrder
 * mutation, NO IZL/Subscription write, and NO provider call. External-identity uniqueness is enforced by PT-DB-03
 * (`@@unique([provider, providerTransactionId])`). This deliberately does NOT reuse the 2.1F terminal-evidence writer
 * (which additionally transitions status + records a callback event) — binding is strictly pre-terminal.
 */
@Injectable()
export class PaymentProviderBindingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async bind(paymentTransactionId: string, provider: PaymentProvider, providerTransactionId: string): Promise<ProviderBindingResult> {
    const base = { paymentTransactionId, provider, providerTransactionId };
    if (typeof providerTransactionId !== 'string' || providerTransactionId.trim().length === 0) {
      return { ...base, outcome: 'NOT_BINDABLE', reason: 'EXTERNAL_ID_REQUIRED' };
    }
    const pt0 = await this.prisma.paymentTransaction.findUnique({ where: { id: paymentTransactionId }, select: { paymentOrderId: true } });
    if (!pt0) return { ...base, outcome: 'NOT_BINDABLE', reason: 'TRANSACTION_NOT_FOUND' };
    const lockKey = pt0.paymentOrderId;

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'pay'}), hashtext(${lockKey}))`; // §17 — pay lock only (no izl/sub)

      const pt = await tx.paymentTransaction.findUnique({ where: { id: paymentTransactionId }, select: { provider: true, status: true, providerTransactionId: true } });
      if (!pt) return { ...base, outcome: 'NOT_BINDABLE' as const, reason: 'TRANSACTION_NOT_FOUND' };
      if (pt.provider !== provider) return { ...base, outcome: 'CONFLICT' as const, reason: 'PROVIDER_MISMATCH' }; // §17 — PT provider must match
      if (pt.status !== PaymentTransactionStatus.PENDING) return { ...base, outcome: 'NOT_BINDABLE' as const, reason: 'TRANSACTION_NOT_PENDING' }; // §17 — no bind onto terminal/succeeded

      if (pt.providerTransactionId === providerTransactionId) return { ...base, outcome: 'ALREADY_BOUND' as const }; // idempotent replay
      if (pt.providerTransactionId !== null) return { ...base, outcome: 'CONFLICT' as const, reason: 'EXTERNAL_ID_ALREADY_ATTACHED' }; // a different id is bound

      try {
        await tx.paymentTransaction.update({ where: { id: paymentTransactionId }, data: { providerTransactionId } }); // ONLY field written
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          return { ...base, outcome: 'CONFLICT' as const, reason: 'EXTERNAL_ID_IN_USE' }; // PT-DB-03 — id owned by another attempt
        }
        throw e;
      }
      return { ...base, outcome: 'BOUND' as const };
    });
  }
}
