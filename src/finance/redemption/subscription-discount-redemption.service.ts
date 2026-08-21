import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock';
import { RedemptionNotFoundError } from '../../common/errors';
import { RedemptionRepository } from './redemption.repository';
import { IzlWalletService } from '../wallet/izl-wallet.service';

export interface RedemptionView {
  id: string;
  paymentOrderId: string | null;
  type: string;
  status: string;
  amountIzl: number;
  discountValueUzs: number;
  policyVersion: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
}
export interface DiscountCommitView {
  redemption: { id: string; status: string; amountIzl: number; discountValueUzs: number };
  paymentOrder: { id: string; grossAmount: number; izlDiscountAmount: number; payableAmount: number; status: string };
}

/**
 * Subscription-discount redemption intent (Phase 2.1C-2, TD-172..177). Reserve-only: binds IZL to a concrete own
 * PaymentOrder as a RESERVED redemption + ACTIVE typed IZLReservation, under the 20% gross ceiling. Never debits the
 * ledger, never applies (APPLIED) or consumes, never mutates the PaymentOrder. The wallet projection is refreshed
 * downstream (best-effort) — a cache failure never rolls back the intent/hold (§33, TD-177/2.1B).
 */
@Injectable()
export class SubscriptionDiscountRedemptionService {
  constructor(
    private readonly repo: RedemptionRepository,
    private readonly wallet: IzlWalletService,
    private readonly clock: Clock,
  ) {}

  /** Create (or idempotently return) a RESERVED subscription-discount redemption for an own CREATED PaymentOrder. */
  async createSubscriptionDiscount(userId: string, paymentOrderId: string, amountIzl: number, clientRequestId: string): Promise<RedemptionView> {
    const id = await this.repo.createRedemption({ userId, paymentOrderId, amountIzl, clientRequestId, now: this.clock.now() });
    await this.wallet.tryRecompute(userId); // §33 downstream projection refresh
    return this.getRedemption(userId, id);
  }

  /**
   * Commit a RESERVED redemption's frozen discount onto its own CREATED PaymentOrder (Phase 2.1D). The redemption
   * stays RESERVED, the reservation stays ACTIVE, and the ledger is unchanged — only the order pricing binds. No
   * wallet recompute (commit never alters ledger/reservation, §62). Idempotent.
   */
  async commitDiscount(userId: string, redemptionId: string): Promise<DiscountCommitView> {
    const id = await this.repo.commitDiscount(userId, redemptionId, this.clock.now());
    return this.getCommitView(userId, id);
  }

  /** Release an own RESERVED redemption (RESERVED→RELEASED + reservation ACTIVE→RELEASED, atomic, idempotent). If it
   *  was committed to its order, the order pricing is restored in the same transaction (only while CREATED). */
  async release(userId: string, redemptionId: string): Promise<RedemptionView> {
    const id = await this.repo.releaseRedemption(userId, redemptionId, this.clock.now());
    await this.wallet.tryRecompute(userId); // reservation changed → refresh projection
    return this.getRedemption(userId, id);
  }

  private async getCommitView(userId: string, id: string): Promise<DiscountCommitView> {
    const v = await this.repo.redemptionWithOrder(userId, id);
    if (!v || !v.paymentOrder) throw new RedemptionNotFoundError('redemption not found');
    return {
      redemption: { id: v.id, status: v.status, amountIzl: v.amountIzl, discountValueUzs: v.valueUzs },
      paymentOrder: { id: v.paymentOrder.id, grossAmount: v.paymentOrder.grossAmount, izlDiscountAmount: v.paymentOrder.izlDiscountAmount, payableAmount: v.paymentOrder.payableAmount, status: v.paymentOrder.status },
    };
  }

  /** Own redemption snapshot (404-safe). Read-only — no rate refresh / reservation / order mutation (§51). */
  async getRedemption(userId: string, id: string): Promise<RedemptionView> {
    const r = await this.repo.redemptionForUser(userId, id);
    if (!r) throw new RedemptionNotFoundError('redemption not found');
    return { id: r.id, paymentOrderId: r.paymentOrderId, type: r.type, status: r.status, amountIzl: r.amountIzl, discountValueUzs: r.valueUzs, policyVersion: r.policyVersionCode, createdAt: r.createdAt, resolvedAt: r.resolvedAt };
  }
}
