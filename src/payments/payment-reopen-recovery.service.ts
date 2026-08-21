import { Injectable, Logger } from '@nestjs/common';
import { PaymentOrderReopenService } from './payment-order-reopen.service';
import { ReopenBacklogItem, PaymentReopenRecoveryRepository } from './payment-reopen-recovery.repository';
import { RECONCILE_DEFAULT_LIMIT, RECONCILE_MAX_LIMIT } from './finalization-recovery.constants';

export interface ReopenReconcileItemResult {
  paymentTransactionId: string;
  paymentOrderId: string | null;
  outcome: string;
  reasonCode?: string;
}

export interface ReopenReconcileSummary {
  scanned: number;
  reopened: number;
  alreadyReopened: number;
  retryInProgress: number;
  successPendingFinalization: number;
  alreadyPaid: number;
  notReopenable: number;
  failed: number;
  items: ReopenReconcileItemResult[];
}

export interface ReopenBacklogView {
  total: number;
  limit: number;
  items: Array<{ paymentTransactionId: string; paymentOrderId: string; userId: string; terminalStatus: string; provider: string; terminalAt: string; payableAmount: number; currency: string; discounted: boolean }>;
}

/**
 * Terminal-reopen recovery (Phase 2.1K, payment-order-reopen-recovery-v1). Operational retry for the stuck state
 * "terminal FAILED/CANCELLED attempt + still-PENDING order" (the post-callback reopen bridge failed and no callback
 * replay arrived). It re-verifies NO payment and calls NO provider (§17/§18), and owns NO reopen mutation — every item
 * goes through the single existing `PaymentOrderReopenService.reopenAfterTerminalAttempt` (§2/§41), which revalidates
 * eligibility under the `pay(order)` lock (stale/PENDING/SUCCEEDED/PAID protection). Items are processed serially (§9),
 * each independently (§10); one item's failure never affects another (§55). No scheduler (§13). This recovery domain is
 * strictly separate from 2.1H finalization recovery (SUCCEEDED+PENDING) — the two never call each other (§34/TD-232).
 */
@Injectable()
export class PaymentReopenRecoveryService {
  private readonly logger = new Logger('PaymentReopenRecovery');

  constructor(
    private readonly repo: PaymentReopenRecoveryRepository,
    private readonly reopen: PaymentOrderReopenService,
  ) {}

  private clampLimit(limit?: number): number {
    if (limit === undefined || !Number.isInteger(limit) || limit <= 0) return RECONCILE_DEFAULT_LIMIT;
    return Math.min(limit, RECONCILE_MAX_LIMIT);
  }

  /** Read-only admin backlog view (§23) — persisted facts only, no provider metadata / callback payload / auth data. */
  async listBacklog(limit?: number): Promise<ReopenBacklogView> {
    const clamped = this.clampLimit(limit);
    const [items, total] = await Promise.all([this.repo.backlogItems(clamped), this.repo.backlogCount()]);
    return {
      total,
      limit: clamped,
      items: items.map((i) => ({ paymentTransactionId: i.terminalPaymentTransactionId, paymentOrderId: i.paymentOrderId, userId: i.userId, terminalStatus: i.terminalStatus, provider: i.provider, terminalAt: i.terminalAt.toISOString(), payableAmount: i.payableAmount, currency: i.currency, discounted: i.discounted })),
    };
  }

  /** Bounded, deterministic, serial reconciliation of the oldest stuck-reopen backlog (§8/§9). No outer transaction. */
  async reconcile(limit?: number): Promise<ReopenReconcileSummary> {
    const clamped = this.clampLimit(limit);
    const items = await this.repo.backlogItems(clamped);
    const results: ReopenReconcileItemResult[] = [];
    for (const item of items) results.push(await this.reopenItem(item)); // serial (§9)
    return this.summarize(results);
  }

  private async reopenItem(item: ReopenBacklogItem): Promise<ReopenReconcileItemResult> {
    try {
      const r = await this.reopen.reopenAfterTerminalAttempt(item.terminalPaymentTransactionId); // the ONE reopen writer (§3)
      return { paymentTransactionId: item.terminalPaymentTransactionId, paymentOrderId: r.paymentOrderId, outcome: r.outcome, reasonCode: r.reason };
    } catch {
      this.logger.warn(`reopen reconcile failed for transaction ${item.terminalPaymentTransactionId}`); // no stack/secrets (§16)
      return { paymentTransactionId: item.terminalPaymentTransactionId, paymentOrderId: item.paymentOrderId, outcome: 'FAILED', reasonCode: 'INTERNAL_REOPEN_ERROR' };
    }
  }

  private summarize(items: ReopenReconcileItemResult[]): ReopenReconcileSummary {
    const c = (o: string) => items.filter((i) => i.outcome === o).length;
    return {
      scanned: items.length,
      reopened: c('REOPENED'),
      alreadyReopened: c('ALREADY_REOPENED'),
      retryInProgress: c('RETRY_ALREADY_IN_PROGRESS'),
      successPendingFinalization: c('PAYMENT_SUCCESS_PENDING_FINALIZATION'),
      alreadyPaid: c('ALREADY_PAID'),
      notReopenable: c('NOT_REOPENABLE'),
      failed: c('FAILED'),
      items,
    };
  }
}
