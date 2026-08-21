import { Injectable } from '@nestjs/common';
import { IzlReservationStatus, PaymentOrderPurpose, PaymentOrderStatus, PaymentProvider, PaymentTransactionStatus, Prisma, RedemptionStatus, SubscriptionPlanStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { PaymentAttemptRequestConflictError, PaymentOrderNotEligibleError, PaymentOrderNotFoundError } from '../common/errors';
import { VerifiedPaymentProviderEvent } from './provider/payment-provider.port';

/** Result of processing one provider callback (Phase 2.1F). `reason` is set only for REJECTED (a business rejection). */
export interface PaymentCallbackOutcome {
  outcome: 'ACCEPTED' | 'DUPLICATE' | 'REJECTED';
  reason?: string;
  callbackEventId: string;
  paymentTransactionId: string | null;
  transactionStatus: PaymentTransactionStatus | null;
  paymentOrderStatus: PaymentOrderStatus | null;
}

/**
 * Subscription purchase-order persistence (Phase 2.1C-PO). READS Plan + PlanPrice (deterministic current price).
 * WRITES only PaymentOrder (CREATED, provider-agnostic). Never writes PaymentTransaction / Subscription / Cycle /
 * IZL / XP (§51). PaymentOrder is the internal purchase authority; PaymentTransaction is provider execution.
 */
@Injectable()
export class PaymentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** A purchasable (ACTIVE) plan, else null (not found / archived). */
  purchasablePlan(planId: string) {
    return this.prisma.subscriptionPlan.findFirst({ where: { id: planId, status: SubscriptionPlanStatus.ACTIVE }, select: { id: true, code: true, name: true } });
  }

  /** Deterministic current UZS PlanPrice: latest effectiveFrom ≤ now (id DESC tie-break). TD-85 immutable. */
  currentPlanPrice(planId: string, now: Date) {
    return this.prisma.planPrice.findFirst({
      where: { planId, currency: 'UZS', effectiveFrom: { lte: now } },
      orderBy: [{ effectiveFrom: 'desc' }, { id: 'desc' }],
      select: { id: true, amount: true },
    });
  }

  /** Existing order for a (user, clientRequestId) — durable network idempotency (PO-DB-01). */
  orderByClientRequest(userId: string, clientRequestId: string) {
    return this.prisma.paymentOrder.findFirst({ where: { userId, clientRequestId } });
  }

  /** Own order (404-safe IDOR), learner-safe projection. */
  orderForUser(userId: string, orderId: string) {
    return this.prisma.paymentOrder.findFirst({
      where: { id: orderId, userId },
      select: { id: true, purpose: true, status: true, currency: true, grossAmount: true, izlDiscountAmount: true, payableAmount: true, createdAt: true, expiresAt: true, plan: { select: { id: true, code: true, name: true } } },
    });
  }

  /** Create a CREATED, provider-agnostic subscription purchase order. Throws P2002 on idempotency race (caught by caller). */
  createOrder(data: { userId: string; planId: string; planPriceId: string; grossAmount: number; clientRequestId: string }) {
    return this.prisma.paymentOrder.create({
      data: {
        userId: data.userId,
        purpose: PaymentOrderPurpose.SUBSCRIPTION_PURCHASE, // server-fixed (§26)
        planId: data.planId,
        planPriceId: data.planPriceId,
        currency: 'UZS',
        grossAmount: data.grossAmount,
        izlDiscountAmount: 0, // initial: no discount (§7/§17)
        payableAmount: data.grossAmount, // payable = gross - 0 (CHECK chk_order_amounts)
        provider: null, // provider-agnostic purchase intent (§8, TD-168)
        status: PaymentOrderStatus.CREATED, // §14 — no execution
        clientRequestId: data.clientRequestId,
      },
    });
  }

  isUniqueViolation(e: unknown): boolean {
    return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
  }

  // ── Phase 2.1E — payment execution attempt ──

  /**
   * Resolve (idempotent replay) or create a PENDING PaymentTransaction attempt for an own CREATED order, and move the
   * order CREATED → PENDING. Runs under the standardized per-user IZL economic advisory lock (§25 — reused so payment
   * initiation serializes with redemption commit/release, avoiding an order-state race). No external provider call
   * here (§24). Returns the stable attempt id + whether provider init still needs to run + the frozen amount/currency.
   */
  async resolveOrCreateAttempt(input: { userId: string; orderId: string; provider: PaymentProvider; clientRequestId: string; now: Date }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'izl'}), hashtext(${input.userId}))`;
      const order = await tx.paymentOrder.findFirst({
        where: { id: input.orderId, userId: input.userId }, // own (§5)
        select: { id: true, purpose: true, status: true, grossAmount: true, izlDiscountAmount: true, payableAmount: true, currency: true, expiresAt: true, izlRedemptionId: true },
      });
      if (!order) throw new PaymentOrderNotFoundError('payment order not found');

      const prior = await tx.paymentTransaction.findFirst({ where: { paymentOrderId: input.orderId, clientRequestId: input.clientRequestId } }); // durable idempotency (PT-DB-01)
      if (prior) return this.replayAttempt(prior, input.provider, order.payableAmount, order.currency);

      if (order.purpose !== PaymentOrderPurpose.SUBSCRIPTION_PURCHASE) throw new PaymentOrderNotEligibleError('order purpose'); // §6
      if (order.status !== PaymentOrderStatus.CREATED) throw new PaymentOrderNotEligibleError('order not CREATED'); // §7/§54/§55
      if (order.expiresAt && input.now >= order.expiresAt) throw new PaymentOrderNotEligibleError('order expired'); // §8/§75
      if (order.payableAmount <= 0) throw new PaymentOrderNotEligibleError('non-positive payable'); // §11/§77
      await this.assertCommittedDiscountIntegrity(tx, order, input.userId); // §44

      try {
        const t = await tx.paymentTransaction.create({ data: { paymentOrderId: input.orderId, provider: input.provider, providerTransactionId: null, amount: order.payableAmount, status: PaymentTransactionStatus.PENDING, clientRequestId: input.clientRequestId } }); // §9/§24
        await tx.paymentOrder.update({ where: { id: input.orderId }, data: { status: PaymentOrderStatus.PENDING } }); // CREATED → PENDING (§33)
        return { txId: t.id, needsProviderInit: true, amount: order.payableAmount, currency: order.currency };
      } catch (e) {
        if (this.isUniqueViolation(e)) {
          const raced = await tx.paymentTransaction.findFirst({ where: { paymentOrderId: input.orderId, clientRequestId: input.clientRequestId } });
          if (raced) return this.replayAttempt(raced, input.provider, order.payableAmount, order.currency); // concurrent same request (§50)
          throw new PaymentOrderNotEligibleError('a pending attempt already exists for this order'); // one-PENDING race (§51)
        }
        throw e;
      }
    });
  }

  /** Attach the external provider transaction id + sanitized metadata to a PENDING attempt (idempotent; §27). Own-user
   *  lock. A duplicate provider id (PT-DB-03) leaves the attempt PENDING without an id (defensive, §74). */
  async attachProviderInit(userId: string, txId: string, providerTransactionId: string, metadata: Record<string, unknown> | null): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'izl'}), hashtext(${userId}))`;
      const t = await tx.paymentTransaction.findUnique({ where: { id: txId }, select: { status: true, providerTransactionId: true } });
      if (!t || t.status !== PaymentTransactionStatus.PENDING || t.providerTransactionId !== null) return; // no-op / already attached (§27/§29)
      try {
        await tx.paymentTransaction.update({ where: { id: txId }, data: { providerTransactionId, ...(metadata ? { providerMetadata: metadata as Prisma.InputJsonValue } : {}) } });
      } catch (e) {
        if (!this.isUniqueViolation(e)) throw e; // duplicate external identity → leave PENDING (§74)
      }
    });
  }

  /** Own attempt + its order pricing (learner-safe initiation view). */
  attemptWithOrder(userId: string, txId: string) {
    return this.prisma.paymentTransaction.findFirst({
      where: { id: txId, paymentOrder: { userId } },
      select: { id: true, provider: true, status: true, paymentOrder: { select: { id: true, status: true, payableAmount: true, currency: true } } },
    });
  }

  private replayAttempt(prior: { id: string; provider: PaymentProvider; providerTransactionId: string | null }, provider: PaymentProvider, amount: number, currency: string) {
    if (prior.provider !== provider) throw new PaymentAttemptRequestConflictError('client request id already used with a different provider'); // §14/§53
    return { txId: prior.id, needsProviderInit: prior.providerTransactionId === null, amount, currency }; // §13/§29 — never reprice
  }

  /** §44 — a committed IZL discount pointer must be backed by a RESERVED redemption + ACTIVE hold consistent with the order pricing. */
  private async assertCommittedDiscountIntegrity(tx: Prisma.TransactionClient, order: { id: string; grossAmount: number; izlDiscountAmount: number; payableAmount: number; izlRedemptionId: string | null }, userId: string): Promise<void> {
    if (!order.izlRedemptionId) return;
    const r = await tx.iZLRedemption.findFirst({ where: { id: order.izlRedemptionId }, select: { userId: true, status: true, paymentOrderId: true, amountIzl: true, valueUzs: true, reservation: { select: { status: true, amountIzl: true } } } });
    const ok = r && r.userId === userId && r.status === RedemptionStatus.RESERVED && r.paymentOrderId === order.id && r.valueUzs === order.izlDiscountAmount && order.payableAmount === order.grossAmount - order.izlDiscountAmount && r.reservation?.status === IzlReservationStatus.ACTIVE && r.reservation.amountIzl === r.amountIzl;
    if (!ok) throw new PaymentOrderNotEligibleError('committed discount integrity');
  }

  // ── Phase 2.1F — verified payment evidence (trusted SUCCESS only) ──

  /**
   * Process a TRUSTED, already-adapter-verified provider event (Phase 2.1F, payment-verified-evidence-v1). Runs under a
   * payment-scoped advisory lock (§40 — NOT the IZL user lock; no IZL mutation exists here). Deduplicates on
   * (provider, providerEventId) (F-19/§12), resolves the exact PaymentTransaction by our stable merchant id (§7/§15),
   * validates provider/amount/order-payable/currency/one-success (§22/§23/§25), attaches the external id if missing
   * (§16/§17) and atomically transitions PENDING → SUCCEEDED + records the accepted callback (§11/§14). PaymentOrder
   * stays PENDING; no IZL / Subscription writes (§31/§32). Provider-authenticated but business-rejected events are
   * recorded as REJECTED callback evidence with zero transaction mutation (§13).
   */
  async recordVerifiedCallback(v: VerifiedPaymentProviderEvent, now: Date): Promise<PaymentCallbackOutcome> {
    // Lock key = the immutable PaymentOrder of the merchant transaction (so all events + attempts of one order serialize).
    const pt0 = await this.prisma.paymentTransaction.findUnique({ where: { id: v.merchantPaymentTransactionId }, select: { paymentOrderId: true } });
    const lockKey = pt0?.paymentOrderId ?? v.merchantPaymentTransactionId;
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'pay'}), hashtext(${lockKey}))`; // §40

        // 1. callback dedup (F-19) — exact provider-event replay returns the stored outcome (§12/§29/§65)
        const dup = await tx.paymentCallbackEvent.findUnique({ where: { provider_providerEventId: { provider: v.provider, providerEventId: v.providerEventId } }, select: { id: true, result: true, paymentTransactionId: true } });
        if (dup) return this.reconstructOutcome(tx, dup);

        // 2. resolve the exact PaymentTransaction by our stable merchant identity (§7/§15/§61)
        const pt = await tx.paymentTransaction.findUnique({
          where: { id: v.merchantPaymentTransactionId },
          select: { id: true, provider: true, status: true, providerTransactionId: true, amount: true, paymentOrder: { select: { id: true, status: true, payableAmount: true, currency: true } } },
        });
        if (!pt) return this.rejectCallback(tx, v, null, 'IDENTITY_MISMATCH', now); // no unrelated PT may transition (§61)

        // 3. provider identity (§15/§62)
        if (pt.provider !== v.provider) return this.rejectCallback(tx, v, pt.id, 'PROVIDER_MISMATCH', now);
        // 4. amount authority: verified == PT.amount == order.payableAmount (§22/§59)
        if (v.amount !== pt.amount) return this.rejectCallback(tx, v, pt.id, 'AMOUNT_MISMATCH', now);
        if (pt.amount !== pt.paymentOrder.payableAmount) return this.rejectCallback(tx, v, pt.id, 'ORDER_AMOUNT_MISMATCH', now);
        // 5. currency authority: verified == order.currency (§23)
        if (v.currency !== pt.paymentOrder.currency) return this.rejectCallback(tx, v, pt.id, 'CURRENCY_MISMATCH', now);

        // 6. already-SUCCEEDED — a distinct event id for the same success (§28/§30/§66); never mutate accepted history
        if (pt.status === PaymentTransactionStatus.SUCCEEDED) {
          if (pt.providerTransactionId !== v.providerTransactionId) return this.rejectCallback(tx, v, pt.id, 'SUCCESS_DATA_CONFLICT', now); // §30
          const ev = await tx.paymentCallbackEvent.create({ data: { provider: v.provider, providerEventId: v.providerEventId, paymentTransactionId: pt.id, result: 'DUPLICATE', processedAt: now } });
          return { outcome: 'DUPLICATE', callbackEventId: ev.id, paymentTransactionId: pt.id, transactionStatus: pt.status, paymentOrderStatus: pt.paymentOrder.status }; // §28/§66 no-op
        }

        // 7. only PENDING transitions to SUCCEEDED; a terminal non-success (FAILED/CANCELLED) → conflict evidence, never
        //    rewritten to SUCCEEDED (§19/§21 — late success after FAILED/CANCELLED). 8. order must still be PENDING (§9)
        if (pt.status !== PaymentTransactionStatus.PENDING) return this.rejectCallback(tx, v, pt.id, 'TERMINAL_STATUS_CONFLICT', now);
        if (pt.paymentOrder.status !== PaymentOrderStatus.PENDING) return this.rejectCallback(tx, v, pt.id, 'ORDER_STATE', now);

        // 9. one SUCCEEDED transaction per order — proactive (PV-DB-01 is the DB backstop) (§25/§27)
        const otherSucceeded = await tx.paymentTransaction.findFirst({ where: { paymentOrderId: pt.paymentOrder.id, status: PaymentTransactionStatus.SUCCEEDED, id: { not: pt.id } }, select: { id: true } });
        if (otherSucceeded) return this.rejectCallback(tx, v, pt.id, 'SUCCESS_CONFLICT', now);

        // 10. external provider id — require non-empty, attach if NULL, equality else conflict, never overwrite (§16/§17/§64)
        if (!v.providerTransactionId || v.providerTransactionId.trim() === '') return this.rejectCallback(tx, v, pt.id, 'IDENTITY_MISMATCH', now);
        if (pt.providerTransactionId !== null && pt.providerTransactionId !== v.providerTransactionId) return this.rejectCallback(tx, v, pt.id, 'EXTERNAL_ID_CONFLICT', now);
        const idOwner = await tx.paymentTransaction.findFirst({ where: { provider: v.provider, providerTransactionId: v.providerTransactionId, id: { not: pt.id } }, select: { id: true } });
        if (idOwner) return this.rejectCallback(tx, v, pt.id, 'EXTERNAL_ID_CONFLICT', now); // §17 owned by another PT

        // 11. atomic: accepted callback (idempotency gate) + PENDING → SUCCEEDED + confirmedAt + external-id attach (§11/§14/§20)
        const ev = await tx.paymentCallbackEvent.create({ data: { provider: v.provider, providerEventId: v.providerEventId, paymentTransactionId: pt.id, result: 'ACCEPTED', processedAt: now } });
        await tx.paymentTransaction.update({ where: { id: pt.id }, data: { status: PaymentTransactionStatus.SUCCEEDED, confirmedAt: v.confirmedAt, ...(pt.providerTransactionId === null ? { providerTransactionId: v.providerTransactionId } : {}) } });
        return { outcome: 'ACCEPTED', callbackEventId: ev.id, paymentTransactionId: pt.id, transactionStatus: PaymentTransactionStatus.SUCCEEDED, paymentOrderStatus: pt.paymentOrder.status }; // order stays PENDING (§31)
      });
    } catch (e) {
      if (this.isUniqueViolation(e)) {
        // Rare cross-order external-id / one-success race — the tx rolled back atomically (no partial writes). If a
        // concurrent winner committed the same event, reconstruct it; otherwise record a fresh integrity rejection.
        const raced = await this.prisma.paymentCallbackEvent.findUnique({ where: { provider_providerEventId: { provider: v.provider, providerEventId: v.providerEventId } }, select: { id: true, result: true, paymentTransactionId: true } });
        if (raced) return this.reconstructOutcome(this.prisma, raced);
        return this.recordRejectionStandalone(v, 'EXTERNAL_ID_CONFLICT', now);
      }
      throw e;
    }
  }

  /** Record a provider-authenticated but business-rejected callback (§13) — REJECTED evidence, zero transaction mutation. */
  private async rejectCallback(tx: Prisma.TransactionClient, v: VerifiedPaymentProviderEvent, paymentTransactionId: string | null, reason: string, now: Date): Promise<PaymentCallbackOutcome> {
    const ev = await tx.paymentCallbackEvent.create({ data: { provider: v.provider, providerEventId: v.providerEventId, paymentTransactionId, result: reason, processedAt: now } });
    let transactionStatus: PaymentTransactionStatus | null = null;
    let paymentOrderStatus: PaymentOrderStatus | null = null;
    if (paymentTransactionId) {
      const pt = await tx.paymentTransaction.findUnique({ where: { id: paymentTransactionId }, select: { status: true, paymentOrder: { select: { status: true } } } });
      transactionStatus = pt?.status ?? null;
      paymentOrderStatus = pt?.paymentOrder.status ?? null;
    }
    return { outcome: 'REJECTED', reason, callbackEventId: ev.id, paymentTransactionId, transactionStatus, paymentOrderStatus };
  }

  /** Reconstruct the outcome of a previously-processed callback event (dedup / concurrent winner). */
  private async reconstructOutcome(client: Prisma.TransactionClient, ev: { id: string; result: string | null; paymentTransactionId: string | null }): Promise<PaymentCallbackOutcome> {
    const code = ev.result ?? '';
    const outcome = code.startsWith('ACCEPTED') ? 'ACCEPTED' : code === 'DUPLICATE' ? 'DUPLICATE' : 'REJECTED'; // ACCEPTED / ACCEPTED_FAILED / ACCEPTED_CANCELLED all accepted (2.1I)
    let transactionStatus: PaymentTransactionStatus | null = null;
    let paymentOrderStatus: PaymentOrderStatus | null = null;
    if (ev.paymentTransactionId) {
      const pt = await client.paymentTransaction.findUnique({ where: { id: ev.paymentTransactionId }, select: { status: true, paymentOrder: { select: { status: true } } } });
      transactionStatus = pt?.status ?? null;
      paymentOrderStatus = pt?.paymentOrder.status ?? null;
    }
    return { outcome, reason: outcome === 'REJECTED' ? code : undefined, callbackEventId: ev.id, paymentTransactionId: ev.paymentTransactionId, transactionStatus, paymentOrderStatus };
  }

  /** Defensive: record a rejection in a fresh short transaction after a rare escaped unique-violation race. */
  private recordRejectionStandalone(v: VerifiedPaymentProviderEvent, reason: string, now: Date): Promise<PaymentCallbackOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const dup = await tx.paymentCallbackEvent.findUnique({ where: { provider_providerEventId: { provider: v.provider, providerEventId: v.providerEventId } }, select: { id: true, result: true, paymentTransactionId: true } });
      if (dup) return this.reconstructOutcome(tx, dup);
      const ptId = (await tx.paymentTransaction.findUnique({ where: { id: v.merchantPaymentTransactionId }, select: { id: true } }))?.id ?? null;
      return this.rejectCallback(tx, v, ptId, reason, now);
    });
  }

  // ── Phase 2.1I — verified terminal NON-SUCCESS evidence (FAILED / CANCELLED) ──

  /**
   * Process a TRUSTED, adapter-verified DEFINITIVE non-success provider event (Phase 2.1I, payment-verified-non-success-v1).
   * Under the payment-scoped lock (§18): dedup on (provider, providerEventId) (F-19/§15), resolve the exact PaymentTransaction
   * by merchant id (§11), validate provider identity (§12) + amount/currency ONLY when the event supplies them (§14), then
   * atomically transition PENDING → FAILED/CANCELLED + record the accepted callback (§17). PaymentOrder stays PENDING; NO
   * confirmedAt, NO IZL, NO Subscription, NO finalizer (§27/§28/§31). Terminal states are immutable: a distinct event
   * matching the same terminal is a no-op (§20); any contradictory terminal (SUCCEEDED, or FAILED↔CANCELLED, or a
   * different external id) is TERMINAL_STATUS_CONFLICT evidence with zero mutation (§19/§21/§22).
   */
  async recordTerminalNonSuccess(v: VerifiedPaymentProviderEvent, target: 'FAILED' | 'CANCELLED', now: Date): Promise<PaymentCallbackOutcome> {
    const targetStatus = target === 'FAILED' ? PaymentTransactionStatus.FAILED : PaymentTransactionStatus.CANCELLED;
    const externalId = v.providerTransactionId && v.providerTransactionId.trim() !== '' ? v.providerTransactionId : null;
    const pt0 = await this.prisma.paymentTransaction.findUnique({ where: { id: v.merchantPaymentTransactionId }, select: { paymentOrderId: true } });
    const lockKey = pt0?.paymentOrderId ?? v.merchantPaymentTransactionId;
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'pay'}), hashtext(${lockKey}))`; // §18 — pay lock only (no izl/sub)

        // 1. callback dedup (F-19) — exact provider-event replay returns the stored outcome (§15/§33)
        const dup = await tx.paymentCallbackEvent.findUnique({ where: { provider_providerEventId: { provider: v.provider, providerEventId: v.providerEventId } }, select: { id: true, result: true, paymentTransactionId: true } });
        if (dup) return this.reconstructOutcome(tx, dup);

        // 2. resolve the exact PaymentTransaction by our stable merchant identity (§11)
        const pt = await tx.paymentTransaction.findUnique({ where: { id: v.merchantPaymentTransactionId }, select: { id: true, provider: true, status: true, providerTransactionId: true, amount: true, paymentOrder: { select: { status: true, currency: true } } } });
        if (!pt) return this.rejectCallback(tx, v, null, 'IDENTITY_MISMATCH', now);
        if (pt.provider !== v.provider) return this.rejectCallback(tx, v, pt.id, 'PROVIDER_MISMATCH', now); // §12

        // 3. amount/currency — validated ONLY when the non-success event supplies them (§14 asymmetry with SUCCESS)
        if (v.amount !== undefined && v.amount !== pt.amount) return this.rejectCallback(tx, v, pt.id, 'AMOUNT_MISMATCH', now);
        if (v.currency !== undefined && v.currency !== pt.paymentOrder.currency) return this.rejectCallback(tx, v, pt.id, 'CURRENCY_MISMATCH', now);

        // 4. terminal immutability (§19/§20/§21/§22) — never rewrite an accepted terminal truth
        if (pt.status !== PaymentTransactionStatus.PENDING) {
          const matchesSameTerminal = pt.status === targetStatus && (externalId === null || pt.providerTransactionId === null || pt.providerTransactionId === externalId);
          if (matchesSameTerminal) {
            const ev = await tx.paymentCallbackEvent.create({ data: { provider: v.provider, providerEventId: v.providerEventId, paymentTransactionId: pt.id, result: 'DUPLICATE', processedAt: now } });
            return { outcome: 'DUPLICATE', callbackEventId: ev.id, paymentTransactionId: pt.id, transactionStatus: pt.status, paymentOrderStatus: pt.paymentOrder.status }; // §20 matching no-op
          }
          return this.rejectCallback(tx, v, pt.id, 'TERMINAL_STATUS_CONFLICT', now); // §19/§21/§22 — different terminal, conflict evidence
        }

        // 5. external provider id — attach if NULL / equality else conflict / never owned by another PT (§13/§54)
        if (externalId !== null) {
          if (pt.providerTransactionId !== null && pt.providerTransactionId !== externalId) return this.rejectCallback(tx, v, pt.id, 'EXTERNAL_ID_CONFLICT', now);
          const idOwner = await tx.paymentTransaction.findFirst({ where: { provider: v.provider, providerTransactionId: externalId, id: { not: pt.id } }, select: { id: true } });
          if (idOwner) return this.rejectCallback(tx, v, pt.id, 'EXTERNAL_ID_CONFLICT', now);
        }

        // 6. atomic: accepted callback (idempotency gate) + PENDING → FAILED/CANCELLED + external-id attach. NO confirmedAt (§25).
        const acceptedCode = v.reasonCode ? `ACCEPTED_${target}:${v.reasonCode}` : `ACCEPTED_${target}`; // e.g. ACCEPTED_FAILED:PROVIDER_EXPIRED (§16/§42)
        const ev = await tx.paymentCallbackEvent.create({ data: { provider: v.provider, providerEventId: v.providerEventId, paymentTransactionId: pt.id, result: acceptedCode, processedAt: now } });
        await tx.paymentTransaction.update({ where: { id: pt.id }, data: { status: targetStatus, ...(pt.providerTransactionId === null && externalId !== null ? { providerTransactionId: externalId } : {}) } }); // order NOT touched (§27)
        return { outcome: 'ACCEPTED', callbackEventId: ev.id, paymentTransactionId: pt.id, transactionStatus: targetStatus, paymentOrderStatus: pt.paymentOrder.status };
      });
    } catch (e) {
      if (this.isUniqueViolation(e)) {
        const raced = await this.prisma.paymentCallbackEvent.findUnique({ where: { provider_providerEventId: { provider: v.provider, providerEventId: v.providerEventId } }, select: { id: true, result: true, paymentTransactionId: true } });
        if (raced) return this.reconstructOutcome(this.prisma, raced);
        return this.recordRejectionStandalone(v, 'EXTERNAL_ID_CONFLICT', now);
      }
      throw e;
    }
  }
}
