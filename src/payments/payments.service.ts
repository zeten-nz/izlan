import { Inject, Injectable, Logger } from '@nestjs/common';
import { PaymentProvider } from '@prisma/client';
import { Clock } from '../common/clock';
import { PaymentOrderNotFoundError, PaymentOrderRequestConflictError, PaymentPlanNotAvailableError, PaymentPlanPriceNotAvailableError } from '../common/errors';
import { PaymentsRepository } from './payments.repository';
import { PAYMENT_PROVIDER_PORT, PaymentProviderPort } from './provider/payment-provider.port';

type OrderRow = NonNullable<Awaited<ReturnType<PaymentsRepository['orderByClientRequest']>>>;
type OrderView = NonNullable<Awaited<ReturnType<PaymentsRepository['orderForUser']>>>;

export interface PaymentInitiationView {
  paymentOrder: { id: string; status: string; payableAmount: number; currency: string };
  paymentTransaction: { id: string; provider: string; status: string };
  checkoutUrl?: string;
}

/**
 * Subscription purchase-order intent (Phase 2.1C-PO, subscription-purchase-order-v1). Creates a concrete,
 * provider-agnostic PaymentOrder that freezes an immutable pricing snapshot (deterministic current PlanPrice) —
 * the future authority for Phase 2.1C-2 subscription-discount redemption. Creates NO PaymentTransaction /
 * Subscription / Cycle / IZL / XP. Purpose is server-fixed SUBSCRIPTION_PURCHASE; all economics are server-derived.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger('Payments');

  constructor(
    private readonly repo: PaymentsRepository,
    private readonly clock: Clock,
    @Inject(PAYMENT_PROVIDER_PORT) private readonly provider: PaymentProviderPort,
  ) {}

  /**
   * Initiate a provider payment execution attempt for an own CREATED order (Phase 2.1E). Persists a PENDING
   * PaymentTransaction + moves the order CREATED → PENDING (DB), THEN calls the provider port OUTSIDE the transaction
   * and attaches the returned provider id (DB). This creates payment execution INTENT, not success — no PAID, no IZL
   * spend, no subscription. An ambiguous/failed provider init leaves the attempt PENDING for retry (§30/§31).
   */
  async initiate(userId: string, orderId: string, provider: PaymentProvider, clientRequestId: string): Promise<PaymentInitiationView> {
    const attempt = await this.repo.resolveOrCreateAttempt({ userId, orderId, provider, clientRequestId, now: this.clock.now() });
    let checkoutUrl: string | undefined;
    if (attempt.needsProviderInit) {
      try {
        const result = await this.provider.initiate({ provider, paymentTransactionId: attempt.txId, paymentOrderId: orderId, amount: attempt.amount, currency: attempt.currency }); // external — OUTSIDE the DB transaction (§26)
        await this.repo.attachProviderInit(userId, attempt.txId, result.providerTransactionId, result.metadata ?? null);
        checkoutUrl = result.checkoutUrl ?? undefined;
      } catch {
        this.logger.warn(`payment provider init deferred for transaction ${attempt.txId}`); // ambiguous/unavailable → attempt stays PENDING (§30)
      }
    }
    return this.getInitiationView(userId, attempt.txId, checkoutUrl);
  }

  private async getInitiationView(userId: string, txId: string, checkoutUrl?: string): Promise<PaymentInitiationView> {
    const v = await this.repo.attemptWithOrder(userId, txId);
    if (!v) throw new PaymentOrderNotFoundError('payment attempt not found');
    return {
      paymentOrder: { id: v.paymentOrder.id, status: v.paymentOrder.status, payableAmount: v.paymentOrder.payableAmount, currency: v.paymentOrder.currency },
      paymentTransaction: { id: v.id, provider: v.provider, status: v.status },
      ...(checkoutUrl ? { checkoutUrl } : {}),
    };
  }

  /** Create (or idempotently return) a subscription purchase order. Server resolves plan/price; client supplies
   *  only planId + clientRequestId. Replay of the same request returns the original (never repriced, §11/§30). */
  async createSubscriptionOrder(userId: string, planId: string, clientRequestId: string): Promise<OrderView> {
    const orderId = await this.resolveOrCreate(userId, planId, clientRequestId);
    return this.getOrder(userId, orderId);
  }

  /** Own order projection (404-safe IDOR). Read-only — no reselection/transition/expiration (§24). */
  async getOrder(userId: string, orderId: string): Promise<OrderView> {
    const order = await this.repo.orderForUser(userId, orderId);
    if (!order) throw new PaymentOrderNotFoundError('payment order not found');
    return order;
  }

  private async resolveOrCreate(userId: string, planId: string, clientRequestId: string): Promise<string> {
    const prior = await this.repo.orderByClientRequest(userId, clientRequestId); // durable idempotency (PO-DB-01)
    if (prior) return this.replayId(prior, planId);

    const plan = await this.repo.purchasablePlan(planId);
    if (!plan) throw new PaymentPlanNotAvailableError('plan not available for purchase'); // not found / archived (§5)
    const price = await this.repo.currentPlanPrice(planId, this.clock.now()); // deterministic effectiveFrom ≤ now (§6)
    if (!price) throw new PaymentPlanPriceNotAvailableError('no effective price'); // §32

    try {
      const order = await this.repo.createOrder({ userId, planId, planPriceId: price.id, grossAmount: price.amount, clientRequestId });
      return order.id;
    } catch (e) {
      if (this.repo.isUniqueViolation(e)) {
        const raced = await this.repo.orderByClientRequest(userId, clientRequestId); // concurrent same request (§13/§39)
        if (raced) return this.replayId(raced, planId);
      }
      throw e;
    }
  }

  /** Idempotent replay iff the same purchase identity; otherwise a conflict (never reprice / never a 2nd order, §12). */
  private replayId(order: OrderRow, planId: string): string {
    if (order.planId === planId && order.purpose === 'SUBSCRIPTION_PURCHASE') return order.id;
    throw new PaymentOrderRequestConflictError('client request id already used with a different purchase');
  }
}
