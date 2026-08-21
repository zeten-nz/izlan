import { Injectable } from '@nestjs/common';
import { ClickProtocolPhaseState, ClickShopTransaction, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

export type ClickProtocolOutcome =
  | 'PREPARED' // Prepare accepted + bound this call
  | 'ALREADY_PREPARED' // idempotent Prepare replay — merchant_prepare_id preserved (never regenerated)
  | 'COMPLETED' // Complete accepted this call
  | 'ALREADY_COMPLETED' // idempotent Complete replay — merchant_confirm_id preserved
  | 'REJECTED' // Complete recorded as rejected
  | 'CONFLICT' // a different click_trans_id already bound to this attempt / the id belongs to another attempt
  | 'NOT_PREPARED' // Complete arrived without an accepted Prepare
  | 'NOT_BINDABLE'; // PaymentTransaction missing

export interface ClickProtocolResult {
  outcome: ClickProtocolOutcome;
  paymentTransactionId: string;
  clickTransId: string | null;
  merchantPrepareId: string | null;
  merchantConfirmId: string | null;
  prepareState: ClickProtocolPhaseState;
  completeState: ClickProtocolPhaseState;
  reason?: string;
}

/**
 * CLICK Shop API durable protocol persistence (Phase 2.1L-D, TD-233, §10/§11/§23) — PROVIDER-NEUTRAL SHELL under a
 * standing PROTOCOL VERIFICATION BLOCKER (§0). CLICK Shop API native constants (Prepare/Complete sign_string MD5
 * formula, native field types, amount format, error taxonomy, merchant_prepare_id required format) are UNVERIFIED from
 * an official current source, so this writer implements NONE of them: it does not parse a CLICK request, verify a
 * signature, compare a native amount, map a CLICK error, or generate a CLICK-format identifier. It only persists
 * caller-supplied identifiers and proves REPLAY STABILITY — the same Prepare returns the same merchant_prepare_id and
 * the same Complete returns the same merchant_confirm_id (never regenerated) across restart. The real Prepare/Complete
 * acceptance logic is Phase 2.1L-C, which MUST first verify the CLICK constants from docs.click.uz. Prepare is strictly
 * NON-terminal (§11): no PaymentTransaction status transition, no PaymentOrder/IZL/Subscription write, no provider call.
 * All operations run under the per-order pay advisory lock.
 */
@Injectable()
export class ClickProtocolRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Prepare (action=0) — bind click_trans_id + persist a replay-stable merchant_prepare_id. NON-terminal. */
  async recordPrepare(input: { paymentTransactionId: string; clickTransId: string; merchantPrepareId: string; now: Date }): Promise<ClickProtocolResult> {
    const lockKey = await this.resolveLockKey(input.paymentTransactionId);
    if (lockKey === null) return this.notBindable(input.paymentTransactionId);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'pay'}), hashtext(${lockKey}))`;
      const existing = await tx.clickShopTransaction.findUnique({ where: { paymentTransactionId: input.paymentTransactionId } });
      if (existing && existing.prepareState === ClickProtocolPhaseState.ACCEPTED) {
        if (existing.clickTransId !== input.clickTransId) return this.result('CONFLICT', existing, 'DIFFERENT_CLICK_TRANS_ID');
        return this.result('ALREADY_PREPARED', existing); // merchant_prepare_id preserved — never regenerated (§23)
      }
      try {
        const row = existing
          ? await tx.clickShopTransaction.update({ where: { paymentTransactionId: input.paymentTransactionId }, data: { prepareState: ClickProtocolPhaseState.ACCEPTED, clickTransId: input.clickTransId, merchantPrepareId: input.merchantPrepareId, preparedAt: input.now } })
          : await tx.clickShopTransaction.create({ data: { paymentTransactionId: input.paymentTransactionId, prepareState: ClickProtocolPhaseState.ACCEPTED, clickTransId: input.clickTransId, merchantPrepareId: input.merchantPrepareId, preparedAt: input.now } });
        return this.result('PREPARED', row);
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          return { outcome: 'CONFLICT' as const, paymentTransactionId: input.paymentTransactionId, clickTransId: input.clickTransId, merchantPrepareId: null, merchantConfirmId: null, prepareState: ClickProtocolPhaseState.PENDING, completeState: ClickProtocolPhaseState.PENDING, reason: 'CLICK_TRANS_ID_IN_USE' };
        }
        throw e;
      }
    });
  }

  /** Complete (action=1) — record a replay-stable acceptance/rejection. Requires an accepted Prepare first. */
  async recordComplete(input: { paymentTransactionId: string; merchantConfirmId: string; accepted: boolean; now: Date }): Promise<ClickProtocolResult> {
    const lockKey = await this.resolveLockKey(input.paymentTransactionId);
    if (lockKey === null) return this.notBindable(input.paymentTransactionId);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'pay'}), hashtext(${lockKey}))`;
      const existing = await tx.clickShopTransaction.findUnique({ where: { paymentTransactionId: input.paymentTransactionId } });
      if (!existing || existing.prepareState !== ClickProtocolPhaseState.ACCEPTED) {
        return { outcome: 'NOT_PREPARED' as const, paymentTransactionId: input.paymentTransactionId, clickTransId: existing?.clickTransId ?? null, merchantPrepareId: existing?.merchantPrepareId ?? null, merchantConfirmId: existing?.merchantConfirmId ?? null, prepareState: existing?.prepareState ?? ClickProtocolPhaseState.PENDING, completeState: existing?.completeState ?? ClickProtocolPhaseState.PENDING, reason: 'PREPARE_REQUIRED' };
      }
      if (existing.completeState === ClickProtocolPhaseState.ACCEPTED) return this.result('ALREADY_COMPLETED', existing); // merchant_confirm_id preserved (§23)
      if (existing.completeState === ClickProtocolPhaseState.REJECTED) return this.result('REJECTED', existing);
      const row = await tx.clickShopTransaction.update({
        where: { paymentTransactionId: input.paymentTransactionId },
        data: input.accepted
          ? { completeState: ClickProtocolPhaseState.ACCEPTED, merchantConfirmId: input.merchantConfirmId, completedAt: input.now }
          : { completeState: ClickProtocolPhaseState.REJECTED, completedAt: input.now },
      });
      return this.result(input.accepted ? 'COMPLETED' : 'REJECTED', row);
    });
  }

  /** Read-only reconstruction of the persisted protocol state (no lock, no mutation). */
  async getByPaymentTransaction(paymentTransactionId: string): Promise<ClickShopTransaction | null> {
    return this.prisma.clickShopTransaction.findUnique({ where: { paymentTransactionId } });
  }

  private async resolveLockKey(paymentTransactionId: string): Promise<string | null> {
    const pt = await this.prisma.paymentTransaction.findUnique({ where: { id: paymentTransactionId }, select: { paymentOrderId: true } });
    return pt?.paymentOrderId ?? null;
  }

  private notBindable(paymentTransactionId: string): ClickProtocolResult {
    return { outcome: 'NOT_BINDABLE', paymentTransactionId, clickTransId: null, merchantPrepareId: null, merchantConfirmId: null, prepareState: ClickProtocolPhaseState.PENDING, completeState: ClickProtocolPhaseState.PENDING, reason: 'TRANSACTION_NOT_FOUND' };
  }

  private result(outcome: ClickProtocolOutcome, row: ClickShopTransaction, reason?: string): ClickProtocolResult {
    return { outcome, paymentTransactionId: row.paymentTransactionId, clickTransId: row.clickTransId, merchantPrepareId: row.merchantPrepareId, merchantConfirmId: row.merchantConfirmId, prepareState: row.prepareState, completeState: row.completeState, reason };
  }
}
