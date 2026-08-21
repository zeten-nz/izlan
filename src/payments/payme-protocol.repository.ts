import { Injectable } from '@nestjs/common';
import { PaymeMerchantTransaction, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

export type PaymeProtocolOutcome =
  | 'CREATED' // CreateTransaction bound a new Payme transaction (state 1) this call
  | 'ALREADY_CREATED' // idempotent CreateTransaction replay — create_time/state preserved
  | 'PERFORMED' // PerformTransaction moved 1 → 2 this call
  | 'ALREADY_PERFORMED' // idempotent PerformTransaction replay — perform_time preserved
  | 'NOT_PERFORMABLE' // cannot perform from a cancelled state (Payme -31008 semantics)
  | 'CANCELLED' // pre-success CancelTransaction moved 1 → -1 this call
  | 'ALREADY_CANCELLED' // idempotent CancelTransaction replay — cancel_time/reason preserved
  | 'REFUND_DOMAIN_UNSUPPORTED' // cancel of a PERFORMED transaction — future refund domain, refused (§7/§26; Payme -31007)
  | 'CONFLICT' // a different Payme id already bound to this attempt, or the Payme id belongs to another attempt
  | 'NOT_FOUND'; // no Payme protocol row / no PaymentTransaction

/** Faithful reconstruction of the native Merchant API view (CheckTransaction / GetStatement rows, §8/§23). */
export interface PaymeReconstructed {
  paymeTransactionId: string; // Payme params.id
  paymentTransactionId: string; // merchant `transaction`
  state: number;
  reason: number | null;
  amountTiyin: bigint;
  account: Prisma.JsonValue;
  providerCreatedTimeMs: bigint; // Payme `time` (GetStatement range key)
  createTimeMs: bigint; // merchant create_time
  performTimeMs: bigint | null;
  cancelTimeMs: bigint | null;
}

export interface PaymeProtocolResult {
  outcome: PaymeProtocolOutcome;
  paymeTransactionId: string;
  paymentTransactionId: string | null;
  state: number | null;
  reason?: string; // internal diagnostic only (never a provider secret)
  record?: PaymeReconstructed;
}

export interface RecordCreateInput {
  paymentTransactionId: string;
  paymeTransactionId: string;
  providerCreatedTimeMs: bigint;
  amountTiyin: bigint;
  accountSnapshot: Prisma.InputJsonValue;
  nowMs: bigint;
}

/**
 * Payme Merchant API durable protocol persistence (Phase 2.1L-D, TD-233/235/236, §3/§5/§8/§9/§23). The single writer of
 * `payme_merchant_transaction` — the adapter's protocol state, NOT economic authority (core money truth stays in
 * PaymentTransaction/PaymentOrder/IZL, §25). It records the native Merchant API state machine (1 created → 2 performed;
 * 1 → -1 cancelled) so repeated CreateTransaction/PerformTransaction/CancelTransaction/CheckTransaction reconstruct the
 * SAME persisted result across process restart, and so GetStatement can be answered over the Payme creation time (§8).
 * It performs NO core PaymentTransaction status transition (that is the future adapter's job via the 2.1F/2.1I evidence
 * services), NO PaymentOrder/Subscription/IZL write, and NO HTTP/provider call. All operations run under the per-order
 * pay advisory lock. Post-success cancellation (state 2 → -2) is REFUSED — it is the future refund domain (§7/§26).
 */
@Injectable()
export class PaymeProtocolRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** CreateTransaction — bind a Payme transaction to a PaymentTransaction as native state 1. Idempotent by Payme id. */
  async recordCreate(input: RecordCreateInput): Promise<PaymeProtocolResult> {
    const pt0 = await this.prisma.paymentTransaction.findUnique({ where: { id: input.paymentTransactionId }, select: { paymentOrderId: true } });
    if (!pt0) return { outcome: 'NOT_FOUND', paymeTransactionId: input.paymeTransactionId, paymentTransactionId: null, state: null, reason: 'TRANSACTION_NOT_FOUND' };
    const lockKey = pt0.paymentOrderId;
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'pay'}), hashtext(${lockKey}))`;
      const existing = await tx.paymeMerchantTransaction.findUnique({ where: { paymentTransactionId: input.paymentTransactionId } });
      if (existing) {
        if (existing.paymeTransactionId !== input.paymeTransactionId) {
          return { outcome: 'CONFLICT' as const, paymeTransactionId: input.paymeTransactionId, paymentTransactionId: input.paymentTransactionId, state: existing.state, reason: 'DIFFERENT_PAYME_ID_FOR_TRANSACTION' };
        }
        return this.ok('ALREADY_CREATED', existing); // create_time + state preserved (§5)
      }
      try {
        const row = await tx.paymeMerchantTransaction.create({
          data: {
            paymentTransactionId: input.paymentTransactionId,
            paymeTransactionId: input.paymeTransactionId,
            amountTiyin: input.amountTiyin,
            accountSnapshot: input.accountSnapshot,
            providerCreatedTimeMs: input.providerCreatedTimeMs, // Payme `time` — never local createdAt (§8)
            createTimeMs: input.nowMs, // merchant create_time = Clock.now() (§5)
            state: 1,
          },
        });
        return this.ok('CREATED', row);
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          return { outcome: 'CONFLICT' as const, paymeTransactionId: input.paymeTransactionId, paymentTransactionId: input.paymentTransactionId, state: null, reason: 'PAYME_ID_IN_USE' };
        }
        throw e;
      }
    });
  }

  /** PerformTransaction — native state 1 → 2. perform_time is set once; replay preserves the original instant (§5/§35). */
  async recordPerform(paymeTransactionId: string, nowMs: bigint): Promise<PaymeProtocolResult> {
    const lockKey = await this.resolveLockKey(paymeTransactionId);
    if (lockKey === null) return this.notFound(paymeTransactionId);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'pay'}), hashtext(${lockKey}))`;
      const row = await tx.paymeMerchantTransaction.findUnique({ where: { paymeTransactionId } });
      if (!row) return this.notFound(paymeTransactionId);
      if (row.state === 2) return this.ok('ALREADY_PERFORMED', row); // perform_time preserved
      if (row.state === 1) {
        const updated = await tx.paymeMerchantTransaction.update({ where: { paymeTransactionId }, data: { state: 2, performTimeMs: nowMs } });
        return this.ok('PERFORMED', updated);
      }
      return { outcome: 'NOT_PERFORMABLE' as const, paymeTransactionId, paymentTransactionId: row.paymentTransactionId, state: row.state, reason: 'CANCELLED_STATE' };
    });
  }

  /** CancelTransaction — native state 1 → -1 (pre-success). A PERFORMED transaction (state 2) is REFUSED (§7/§26). */
  async recordCancel(paymeTransactionId: string, reason: number, nowMs: bigint): Promise<PaymeProtocolResult> {
    const lockKey = await this.resolveLockKey(paymeTransactionId);
    if (lockKey === null) return this.notFound(paymeTransactionId);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'pay'}), hashtext(${lockKey}))`;
      const row = await tx.paymeMerchantTransaction.findUnique({ where: { paymeTransactionId } });
      if (!row) return this.notFound(paymeTransactionId);
      if (row.state === -1) return this.ok('ALREADY_CANCELLED', row); // cancel_time + reason preserved
      if (row.state === 1) {
        const updated = await tx.paymeMerchantTransaction.update({ where: { paymeTransactionId }, data: { state: -1, cancelTimeMs: nowMs, reason } });
        return this.ok('CANCELLED', updated);
      }
      // state 2 or -2 → performed: reversal of a completed order is the FUTURE refund domain — never a core CANCELLED (§7/§26).
      return { outcome: 'REFUND_DOMAIN_UNSUPPORTED' as const, paymeTransactionId, paymentTransactionId: row.paymentTransactionId, state: row.state, reason: 'ORDER_COMPLETED_REFUND_REQUIRED' };
    });
  }

  /** CheckTransaction — read-only reconstruction of the native state (no lock, no mutation). */
  async checkTransaction(paymeTransactionId: string): Promise<PaymeReconstructed | null> {
    const row = await this.prisma.paymeMerchantTransaction.findUnique({ where: { paymeTransactionId } });
    return row ? this.reconstruct(row) : null;
  }

  /** GetStatement — reconstruct all transactions whose Payme creation time is within [fromMs, toMs], deterministically ordered (§8). */
  async getStatement(fromMs: bigint, toMs: bigint): Promise<PaymeReconstructed[]> {
    const rows = await this.prisma.paymeMerchantTransaction.findMany({
      where: { providerCreatedTimeMs: { gte: fromMs, lte: toMs } },
      orderBy: [{ providerCreatedTimeMs: 'asc' }, { id: 'asc' }],
    });
    return rows.map((r) => this.reconstruct(r));
  }

  private async resolveLockKey(paymeTransactionId: string): Promise<string | null> {
    const row = await this.prisma.paymeMerchantTransaction.findUnique({ where: { paymeTransactionId }, select: { paymentTransaction: { select: { paymentOrderId: true } } } });
    return row?.paymentTransaction.paymentOrderId ?? null;
  }

  private notFound(paymeTransactionId: string): PaymeProtocolResult {
    return { outcome: 'NOT_FOUND', paymeTransactionId, paymentTransactionId: null, state: null, reason: 'PROTOCOL_ROW_NOT_FOUND' };
  }

  private ok(outcome: PaymeProtocolOutcome, row: PaymeMerchantTransaction): PaymeProtocolResult {
    return { outcome, paymeTransactionId: row.paymeTransactionId, paymentTransactionId: row.paymentTransactionId, state: row.state, record: this.reconstruct(row) };
  }

  private reconstruct(row: PaymeMerchantTransaction): PaymeReconstructed {
    return {
      paymeTransactionId: row.paymeTransactionId,
      paymentTransactionId: row.paymentTransactionId,
      state: row.state,
      reason: row.reason,
      amountTiyin: row.amountTiyin,
      account: row.accountSnapshot,
      providerCreatedTimeMs: row.providerCreatedTimeMs,
      createTimeMs: row.createTimeMs,
      performTimeMs: row.performTimeMs,
      cancelTimeMs: row.cancelTimeMs,
    };
  }
}
