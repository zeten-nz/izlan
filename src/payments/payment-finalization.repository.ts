import { Injectable } from '@nestjs/common';
import { IzlReservationStatus, LedgerEntryType, PaymentOrderPurpose, PaymentOrderStatus, PaymentTransactionStatus, PolicyVersionStatus, Prisma, RateVersionStatus, RedemptionStatus, SubscriptionCycleStatus, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { PaymentFinalizationIntegrityError, SubscriptionPurchaseActiveConflictError } from '../common/errors';
import { addCalendarMonths } from '../common/calendar-month';
import { rewardCeilingIzl, rewardCeilingUzs } from '../finance/reward/reward-ceiling';
import { parseIzlRewardPolicyConfig } from '../finance/reward/daily-mission-izl.policy';

export interface FinalizationResult {
  paymentOrderId: string;
  paymentTransactionId: string;
  userId: string;
  subscriptionId: string;
  subscriptionCycleId: string;
  status: 'PAID';
  discounted: boolean;
  redemptionId?: string;
  replay: boolean;
}

type RewardResolution = { enabled: true; policyVersionId: string; rateUzsPerIzl: number; ceilingUzs: number; ceilingIzl: number } | { enabled: false };

/**
 * Verified payment economic finalization (Phase 2.1G, verified-payment-finalization-v1). Converts a persisted trusted
 * `PaymentTransaction.SUCCEEDED` + PENDING `PaymentOrder` (+ optional committed discount) into a paid subscription in
 * ONE replay-safe transaction under the global lock order `sub(user) → pay(order) → izl(user)` (§9). Consumes only
 * persisted evidence — NO provider call (§69). The single finalization writer: PaymentOrder(PAID) + Subscription +
 * SubscriptionCycle + SubscriptionCycleEntitlement, and — discounted only — IZL REDEEM + reservation CONSUMED +
 * redemption APPLIED. Never mutates PaymentTransaction / PaymentCallbackEvent (§70/§71).
 */
@Injectable()
export class PaymentFinalizationRepository {
  constructor(private readonly prisma: PrismaService) {}

  isUniqueViolation(e: unknown): boolean {
    return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
  }

  async finalize(paymentTransactionId: string): Promise<FinalizationResult> {
    // Pre-read to choose lock keys (userId + immutable order id + whether discounted). izlRedemptionId is frozen once
    // the order is PENDING (2.1D release requires CREATED), so this is stable.
    const pre = await this.prisma.paymentTransaction.findUnique({
      where: { id: paymentTransactionId },
      select: { paymentOrder: { select: { id: true, userId: true, izlRedemptionId: true } } },
    });
    if (!pre) throw new PaymentFinalizationIntegrityError('payment transaction not found');
    const { id: orderId, userId, izlRedemptionId } = pre.paymentOrder;
    const discounted = izlRedemptionId !== null;

    return this.prisma.$transaction(async (tx) => {
      // §9 global lock order — sub → pay → izl (izl only when discounted). NEVER reversed.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'sub'}), hashtext(${userId}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'pay'}), hashtext(${orderId}))`;
      if (discounted) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'izl'}), hashtext(${userId}))`;

      // §11 reload authoritative rows under the locks
      const pt = await tx.paymentTransaction.findUnique({ where: { id: paymentTransactionId }, select: { id: true, status: true, confirmedAt: true, amount: true, paymentOrderId: true } });
      const order = await tx.paymentOrder.findUnique({ where: { id: orderId }, select: { id: true, userId: true, purpose: true, status: true, grossAmount: true, izlDiscountAmount: true, payableAmount: true, planId: true, planPriceId: true, currency: true, izlRedemptionId: true } });
      if (!pt || !order) throw new PaymentFinalizationIntegrityError('finalization rows missing');

      // §4/§12 trusted payment preconditions
      if (pt.status !== PaymentTransactionStatus.SUCCEEDED || pt.confirmedAt === null) throw new PaymentFinalizationIntegrityError('transaction not trusted-succeeded');
      if (pt.paymentOrderId !== order.id) throw new PaymentFinalizationIntegrityError('transaction/order mismatch');
      if (order.purpose !== PaymentOrderPurpose.SUBSCRIPTION_PURCHASE) throw new PaymentFinalizationIntegrityError('unsupported order purpose'); // §5 v1
      if (pt.amount !== order.payableAmount) throw new PaymentFinalizationIntegrityError('amount ≠ order payable'); // final re-check

      // §7 replay — order already PAID: validate + reconstruct, no writes
      if (order.status === PaymentOrderStatus.PAID) return this.reconstructFinalized(tx, order, discounted);
      if (order.status !== PaymentOrderStatus.PENDING) throw new PaymentFinalizationIntegrityError('order not PENDING'); // §6

      // §8 PENDING but a cycle already exists ⇒ impossible/atomic-broken
      const existingCycle = await tx.subscriptionCycle.findUnique({ where: { paymentOrderId: order.id }, select: { id: true } });
      if (existingCycle) throw new PaymentFinalizationIntegrityError('pending order already has a cycle');

      // §33/§34/§35 discount provenance
      let redemptionAmountIzl = 0;
      let reservationId: string | null = null;
      if (discounted) {
        const r = await tx.iZLRedemption.findUnique({ where: { id: order.izlRedemptionId! }, select: { userId: true, type: true, status: true, paymentOrderId: true, amountIzl: true, valueUzs: true, reservation: { select: { id: true, userId: true, status: true, amountIzl: true, redemptionId: true } } } });
        const ok = r && r.userId === order.userId && r.type === 'SUBSCRIPTION_DISCOUNT' && r.status === RedemptionStatus.RESERVED && r.paymentOrderId === order.id && r.amountIzl > 0 && r.valueUzs === order.izlDiscountAmount
          && r.reservation && r.reservation.userId === order.userId && r.reservation.status === IzlReservationStatus.ACTIVE && r.reservation.amountIzl === r.amountIzl && r.reservation.redemptionId === order.izlRedemptionId;
        if (!ok) throw new PaymentFinalizationIntegrityError('committed discount provenance invalid');
        redemptionAmountIzl = r!.amountIzl;
        reservationId = r!.reservation!.id;
      } else if (order.izlDiscountAmount !== 0 || order.payableAmount !== order.grossAmount) {
        throw new PaymentFinalizationIntegrityError('undiscounted order pricing inconsistent'); // §34
      }

      // §15 PlanPrice (frozen purchase authority; never re-priced)
      const price = await tx.planPrice.findUnique({ where: { id: order.planPriceId }, select: { planId: true, currency: true, billingPeriodMonths: true } });
      if (!price || price.planId !== order.planId || price.currency !== order.currency || price.billingPeriodMonths <= 0) throw new PaymentFinalizationIntegrityError('plan price inconsistent');

      const periodStart = pt.confirmedAt; // §16
      const periodEnd = addCalendarMonths(periodStart, price.billingPeriodMonths); // §17

      // §18/§19/§21 subscription resolution (F-14: at most one ACTIVE/EXPIRED per user)
      const nonterminal = await tx.subscription.findFirst({ where: { userId: order.userId, status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.EXPIRED] } }, select: { id: true, status: true } });
      if (nonterminal && nonterminal.status === SubscriptionStatus.ACTIVE) throw new SubscriptionPurchaseActiveConflictError('user already has an active subscription'); // §21 — rolls back, no partial effects

      let subscriptionId: string;
      let sequenceNo: number;
      if (!nonterminal) {
        const sub = await tx.subscription.create({ data: { userId: order.userId, planId: order.planId, status: SubscriptionStatus.ACTIVE, startedAt: periodStart }, select: { id: true } }); // §18
        subscriptionId = sub.id;
        sequenceNo = 1;
      } else {
        subscriptionId = nonterminal.id; // §19 EXPIRED reactivation — same episode
        const maxSeq = await tx.subscriptionCycle.aggregate({ where: { subscriptionId }, _max: { sequenceNo: true } });
        sequenceNo = (maxSeq._max.sequenceNo ?? 0) + 1; // §23
      }

      // §27–§30 reward config at periodStart
      const reward = await this.resolveRewardConfig(tx, periodStart, order.payableAmount);

      // §26 cycle commercial snapshot (frozen from the order — never re-priced)
      const cycle = await tx.subscriptionCycle.create({
        data: {
          subscriptionId, sequenceNo, periodStart, periodEnd,
          planId: order.planId, planPriceId: order.planPriceId,
          grossPriceUzs: order.grossAmount, discountUzs: order.izlDiscountAmount, paidAmountUzs: order.payableAmount, rewardBasisUzs: order.payableAmount,
          rewardPolicyVersionId: reward.enabled ? reward.policyVersionId : null,
          izlRateSnapshot: reward.enabled ? reward.rateUzsPerIzl : null,
          rewardCeilingUzs: reward.enabled ? reward.ceilingUzs : 0,
          rewardCeilingIzl: reward.enabled ? reward.ceilingIzl : 0,
          earnedIzl: 0,
          paymentOrderId: order.id, status: SubscriptionCycleStatus.ACTIVE,
        },
        select: { id: true },
      });

      // §31/§32 entitlement snapshot (deterministic; PlanEntitlement → immutable cycle snapshot). No UsageCounter (deferred).
      const planEnts = await tx.planEntitlement.findMany({ where: { planId: order.planId }, select: { featureCode: true, mode: true, limitValue: true } });
      if (planEnts.length > 0) await tx.subscriptionCycleEntitlement.createMany({ data: planEnts.map((e) => ({ cycleId: cycle.id, featureCode: e.featureCode, mode: e.mode, limitValue: e.limitValue })) });

      // §45 subscription current cycle + activation (plan updated on reactivation, §19/§20; startedAt preserved)
      await tx.subscription.update({ where: { id: subscriptionId }, data: { currentCycleId: cycle.id, status: SubscriptionStatus.ACTIVE, ...(nonterminal ? { planId: order.planId } : {}) } });

      // §37–§40 discounted IZL consumption (REDEEM + CONSUMED + APPLIED) — atomic economic effect
      if (discounted) {
        const agg = await tx.iZLLedgerEntry.aggregate({ where: { userId: order.userId }, _max: { entryNo: true }, _sum: { amount: true } });
        const entryNo = (agg._max.entryNo ?? 0) + 1;
        const balanceAfter = (agg._sum.amount ?? 0) - redemptionAmountIzl; // signed; may go negative (§36/§42)
        await tx.iZLLedgerEntry.create({ data: { userId: order.userId, entryNo, entryType: LedgerEntryType.REDEEM, amount: -redemptionAmountIzl, balanceAfter, redemptionId: order.izlRedemptionId!, subscriptionCycleId: cycle.id } }); // FP-DB-04 one-REDEEM
        await tx.iZLReservation.update({ where: { id: reservationId! }, data: { status: IzlReservationStatus.CONSUMED } }); // §39 (not RELEASED)
        await tx.iZLRedemption.update({ where: { id: order.izlRedemptionId! }, data: { status: RedemptionStatus.APPLIED, resolvedAt: pt.confirmedAt } }); // §40 resolvedAt = confirmedAt
      }

      // §43/§44 order PAID — committed last, atomically with the complete business state
      await tx.paymentOrder.update({ where: { id: order.id }, data: { status: PaymentOrderStatus.PAID } });

      return { paymentOrderId: order.id, paymentTransactionId: pt.id, userId: order.userId, subscriptionId, subscriptionCycleId: cycle.id, status: 'PAID' as const, discounted, redemptionId: order.izlRedemptionId ?? undefined, replay: false };
    });
  }

  /** §7/§48/§49 — order already PAID: validate the finalized state is complete + consistent, then return it (no writes). */
  private async reconstructFinalized(tx: Prisma.TransactionClient, order: { id: string; userId: string; izlRedemptionId: string | null }, discounted: boolean): Promise<FinalizationResult> {
    const cycle = await tx.subscriptionCycle.findUnique({ where: { paymentOrderId: order.id }, select: { id: true, subscriptionId: true, subscription: { select: { userId: true } } } });
    if (!cycle || cycle.subscription.userId !== order.userId) throw new PaymentFinalizationIntegrityError('paid order missing a consistent cycle'); // §7 no silent repair
    if (discounted) {
      const r = await tx.iZLRedemption.findUnique({ where: { id: order.izlRedemptionId! }, select: { status: true, reservation: { select: { status: true } } } });
      const redeem = await tx.iZLLedgerEntry.findFirst({ where: { redemptionId: order.izlRedemptionId!, entryType: LedgerEntryType.REDEEM }, select: { id: true } });
      if (!r || r.status !== RedemptionStatus.APPLIED || r.reservation?.status !== IzlReservationStatus.CONSUMED || !redeem) throw new PaymentFinalizationIntegrityError('paid discounted order missing REDEEM/CONSUMED/APPLIED provenance');
    }
    return { paymentOrderId: order.id, paymentTransactionId: '', userId: order.userId, subscriptionId: cycle.subscriptionId, subscriptionCycleId: cycle.id, status: 'PAID', discounted, redemptionId: order.izlRedemptionId ?? undefined, replay: true };
  }

  /** §27/§28 — reward config is usable only when an ACTIVE policy + ACTIVE rate are both effective ≤ periodStart and the
   *  policy config parses. Otherwise the cycle is reward-disabled (paid access is never blocked, §28/§57/§58). */
  private async resolveRewardConfig(tx: Prisma.TransactionClient, periodStart: Date, payableAmount: number): Promise<RewardResolution> {
    const policy = await tx.rewardPolicyVersion.findFirst({ where: { status: PolicyVersionStatus.ACTIVE, effectiveFrom: { lte: periodStart } }, select: { id: true, config: true } });
    const rate = await tx.izlRateVersion.findFirst({ where: { status: RateVersionStatus.ACTIVE, effectiveFrom: { lte: periodStart } }, select: { rateUzsPerIzl: true } });
    if (!policy || !rate || rate.rateUzsPerIzl <= 0) return { enabled: false };
    try {
      parseIzlRewardPolicyConfig(policy.config); // pure parser — a throw is a config failure (§28/§57), never a DB/system failure
    } catch {
      return { enabled: false };
    }
    const ceilingUzs = rewardCeilingUzs(payableAmount); // floor(net × 20%)
    return { enabled: true, policyVersionId: policy.id, rateUzsPerIzl: rate.rateUzsPerIzl, ceilingUzs, ceilingIzl: rewardCeilingIzl(ceilingUzs, rate.rateUzsPerIzl) };
  }
}
