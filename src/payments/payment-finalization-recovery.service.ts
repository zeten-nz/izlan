import { Injectable, Logger } from '@nestjs/common';
import { SubscriptionPurchaseActiveConflictError } from '../common/errors';
import { PaymentFinalizationService } from './payment-finalization.service';
import { BacklogItem, PaymentFinalizationRecoveryRepository } from './payment-finalization-recovery.repository';
import { RECONCILE_DEFAULT_LIMIT, RECONCILE_MAX_LIMIT } from './finalization-recovery.constants';

export type ReconcileOutcome = 'FINALIZED' | 'ALREADY_FINALIZED' | 'BLOCKED' | 'FAILED';

export interface ReconcileItemResult {
  paymentTransactionId: string;
  paymentOrderId: string | null;
  outcome: ReconcileOutcome;
  reasonCode?: string;
}

export interface ReconcileSummary {
  scanned: number;
  finalized: number;
  alreadyFinalized: number;
  blocked: number;
  failed: number;
  items: ReconcileItemResult[];
}

export interface BacklogView {
  total: number;
  limit: number;
  items: Array<{ paymentTransactionId: string; paymentOrderId: string; userId: string; confirmedAt: string | null; payableAmount: number; currency: string; discounted: boolean }>;
}

/**
 * Verified-payment finalization recovery (Phase 2.1H, verified-payment-finalization-recovery-v1). Operational retry for
 * the trusted-but-unfinalized backlog. It does NOT re-verify a payment or call a provider (§2/§20) and owns NO business
 * mutation — every item goes through the single existing `PaymentFinalizationService.finalizeVerifiedPayment` (§3/§39).
 * Items are processed serially (§7), each independently (§8); one item's failure never affects another (§30/§31). No
 * scheduler (§25). Outcomes are stable, safe operational classifications with no stack traces / secrets (§9/§37).
 */
@Injectable()
export class PaymentFinalizationRecoveryService {
  private readonly logger = new Logger('PaymentFinalizationRecovery');

  constructor(
    private readonly repo: PaymentFinalizationRecoveryRepository,
    private readonly finalization: PaymentFinalizationService,
  ) {}

  private clampLimit(limit?: number): number {
    if (limit === undefined || !Number.isInteger(limit) || limit <= 0) return RECONCILE_DEFAULT_LIMIT;
    return Math.min(limit, RECONCILE_MAX_LIMIT);
  }

  /** Read-only admin backlog view (§12/§13) — persisted facts only, no provider metadata / callback payload. */
  async listBacklog(limit?: number): Promise<BacklogView> {
    const clamped = this.clampLimit(limit);
    const [items, total] = await Promise.all([this.repo.backlogItems(clamped), this.repo.backlogCount()]);
    return {
      total,
      limit: clamped,
      items: items.map((i) => ({ paymentTransactionId: i.paymentTransactionId, paymentOrderId: i.paymentOrderId, userId: i.userId, confirmedAt: i.confirmedAt ? i.confirmedAt.toISOString() : null, payableAmount: i.payableAmount, currency: i.currency, discounted: i.discounted })),
    };
  }

  /** Bounded, deterministic, serial reconciliation of the oldest-verified backlog (§6/§7). No outer transaction (§8). */
  async reconcile(limit?: number): Promise<ReconcileSummary> {
    const clamped = this.clampLimit(limit);
    const items = await this.repo.backlogItems(clamped);
    const results: ReconcileItemResult[] = [];
    for (const item of items) results.push(await this.finalizeItem(item)); // serial (§7)
    return this.summarize(results);
  }

  /** Internal single-item retry (§15) — used by operations/tests. No public learner route. */
  async reconcileOne(paymentTransactionId: string): Promise<ReconcileItemResult> {
    return this.finalizeItem({ paymentTransactionId, paymentOrderId: null });
  }

  private async finalizeItem(item: { paymentTransactionId: string; paymentOrderId: string | null }): Promise<ReconcileItemResult> {
    try {
      const r = await this.finalization.finalizeVerifiedPayment(item.paymentTransactionId); // the ONE finalizer (§3)
      return { paymentTransactionId: item.paymentTransactionId, paymentOrderId: r.paymentOrderId, outcome: r.replay ? 'ALREADY_FINALIZED' : 'FINALIZED' }; // §9/§23
    } catch (e) {
      if (e instanceof SubscriptionPurchaseActiveConflictError) {
        return { paymentTransactionId: item.paymentTransactionId, paymentOrderId: item.paymentOrderId, outcome: 'BLOCKED', reasonCode: 'SUBSCRIPTION_PURCHASE_ACTIVE_CONFLICT' }; // §10/§29 — recoverable, not FAILED
      }
      this.logger.warn(`finalization reconcile failed for transaction ${item.paymentTransactionId}`); // no stack/secrets (§37)
      return { paymentTransactionId: item.paymentTransactionId, paymentOrderId: item.paymentOrderId, outcome: 'FAILED', reasonCode: 'INTERNAL_FINALIZATION_ERROR' }; // §11 — state preserved (2.1G rollback)
    }
  }

  private summarize(items: ReconcileItemResult[]): ReconcileSummary {
    return {
      scanned: items.length,
      finalized: items.filter((i) => i.outcome === 'FINALIZED').length,
      alreadyFinalized: items.filter((i) => i.outcome === 'ALREADY_FINALIZED').length,
      blocked: items.filter((i) => i.outcome === 'BLOCKED').length,
      failed: items.filter((i) => i.outcome === 'FAILED').length,
      items,
    };
  }
}
