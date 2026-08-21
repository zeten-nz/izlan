import { Injectable } from '@nestjs/common';
import { IzlReservationStatus, PaymentOrderPurpose, PaymentOrderStatus, Prisma, RedemptionStatus, RedemptionType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import {
  IzlInsufficientAvailableError,
  PaymentOrderNotFoundError,
  RedemptionCeilingExceededError,
  RedemptionCommitConflictError,
  RedemptionNotFoundError,
  RedemptionOpenIntentConflictError,
  RedemptionOrderNotEligibleError,
  RedemptionRateNotAvailableError,
  RedemptionRequestConflictError,
} from '../../common/errors';
import { evaluateRedemption, maxDiscountUzs, REDEMPTION_RESERVATION_PURPOSE, SUBSCRIPTION_DISCOUNT_REDEMPTION_VERSION } from './subscription-discount-redemption.policy';

const OPEN_STATUSES = [RedemptionStatus.REQUESTED, RedemptionStatus.RESERVED];

/**
 * Subscription-discount redemption persistence (Phase 2.1C-2). All authoritative work runs in ONE transaction under
 * the per-user IZL advisory lock (§28/§29 — same namespace as 2.1A/2.1B). Creates an atomic RESERVED IZLRedemption +
 * ACTIVE typed IZLReservation; writes NO ledger, NO RewardGrant, and does NOT mutate the PaymentOrder (§34/§35).
 */
@Injectable()
export class RedemptionRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Own redemption, learner-safe projection (404-safe IDOR). */
  redemptionForUser(userId: string, id: string) {
    return this.prisma.iZLRedemption.findFirst({
      where: { id, userId },
      select: { id: true, paymentOrderId: true, type: true, status: true, amountIzl: true, valueUzs: true, policyVersionCode: true, createdAt: true, resolvedAt: true },
    });
  }

  /** Own redemption + its committed PaymentOrder pricing (Phase 2.1D commit/release view). */
  redemptionWithOrder(userId: string, id: string) {
    return this.prisma.iZLRedemption.findFirst({
      where: { id, userId },
      select: { id: true, status: true, amountIzl: true, valueUzs: true, paymentOrder: { select: { id: true, grossAmount: true, izlDiscountAmount: true, payableAmount: true, status: true } } },
    });
  }

  /**
   * Commit a RESERVED redemption's frozen discount onto its own CREATED PaymentOrder (Phase 2.1D, §14). Under the
   * per-user IZL lock: validate redemption/reservation/order state, revalidate the FROZEN quote against the order
   * gross ceiling (no repricing), then update the order pricing (discount = valueUzs, payable = gross − value,
   * pointer = redemption). The redemption stays RESERVED, the reservation stays ACTIVE, and NO ledger entry is
   * written (§4/§5/§6). Idempotent. Returns the redemption id.
   */
  async commitDiscount(userId: string, redemptionId: string, now: Date): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'izl'}), hashtext(${userId}))`;
      const r = await tx.iZLRedemption.findFirst({
        where: { id: redemptionId, userId },
        select: { id: true, userId: true, type: true, status: true, amountIzl: true, valueUzs: true, policyVersionCode: true, paymentOrderId: true, reservation: { select: { id: true, status: true, amountIzl: true, userId: true, redemptionId: true } } },
      });
      if (!r) throw new RedemptionNotFoundError('redemption not found');
      if (!r.paymentOrderId) throw new RedemptionCommitConflictError('redemption not bound to an order'); // integrity (2.1C-2 always binds)

      const order = await tx.paymentOrder.findFirst({ where: { id: r.paymentOrderId, userId }, select: { id: true, purpose: true, status: true, grossAmount: true, izlDiscountAmount: true, payableAmount: true, izlRedemptionId: true, expiresAt: true } });
      if (!order) throw new PaymentOrderNotFoundError('payment order not found');

      // Idempotent already-committed to THIS redemption (§16).
      if (order.izlRedemptionId === r.id) {
        const consistent = order.izlDiscountAmount === r.valueUzs && order.payableAmount === order.grossAmount - r.valueUzs && r.status === RedemptionStatus.RESERVED && r.reservation?.status === IzlReservationStatus.ACTIVE;
        if (consistent) return r.id;
        throw new RedemptionCommitConflictError('committed order pricing inconsistent with redemption'); // partial corruption (§18)
      }
      if (order.izlRedemptionId) throw new RedemptionCommitConflictError('order already committed to another redemption'); // §17

      if (r.type !== RedemptionType.SUBSCRIPTION_DISCOUNT || r.status !== RedemptionStatus.RESERVED || r.policyVersionCode !== SUBSCRIPTION_DISCOUNT_REDEMPTION_VERSION) throw new RedemptionOrderNotEligibleError('redemption not committable'); // §9
      if (!r.reservation || r.reservation.status !== IzlReservationStatus.ACTIVE || r.reservation.redemptionId !== r.id || r.reservation.userId !== r.userId || r.reservation.amountIzl !== r.amountIzl) throw new RedemptionCommitConflictError('reservation integrity'); // §9
      if (order.purpose !== PaymentOrderPurpose.SUBSCRIPTION_PURCHASE || order.status !== PaymentOrderStatus.CREATED) throw new RedemptionOrderNotEligibleError('order purpose/status'); // §10
      if (order.expiresAt && now >= order.expiresAt) throw new RedemptionOrderNotEligibleError('order expired'); // §10/§57
      if (order.izlDiscountAmount !== 0 || order.payableAmount !== order.grossAmount) throw new RedemptionCommitConflictError('order already discounted'); // §11

      // Revalidate the FROZEN quote against the order gross ceiling — no repricing (§12).
      if (r.valueUzs <= 0 || BigInt(r.valueUzs) > BigInt(maxDiscountUzs(order.grossAmount)) || r.valueUzs > order.grossAmount) throw new RedemptionCeilingExceededError('committed value exceeds order ceiling'); // §56

      await tx.paymentOrder.update({ where: { id: order.id }, data: { izlDiscountAmount: r.valueUzs, payableAmount: order.grossAmount - r.valueUzs, izlRedemptionId: r.id } }); // §14 — order pricing only
      return r.id;
    });
  }

  /**
   * Atomically create a RESERVED redemption + ACTIVE hold for one own PaymentOrder, if eligible. Returns the
   * redemption id (existing on idempotent replay). Throws typed domain errors for ineligible order / rate / ceiling /
   * availability / conflict. Server-derives rate/value/policy — never the client.
   */
  async createRedemption(input: { userId: string; paymentOrderId: string; amountIzl: number; clientRequestId: string; now: Date }): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'izl'}), hashtext(${input.userId}))`;

      const prior = await tx.iZLRedemption.findFirst({ where: { userId: input.userId, clientRequestId: input.clientRequestId } });
      if (prior) return this.replayId(prior, input.paymentOrderId, input.amountIzl); // idempotent replay / conflict (§36/§37)

      const order = await tx.paymentOrder.findFirst({
        where: { id: input.paymentOrderId, userId: input.userId }, // own (§13)
        select: { id: true, purpose: true, status: true, grossAmount: true, izlDiscountAmount: true, payableAmount: true, expiresAt: true },
      });
      if (!order) throw new PaymentOrderNotFoundError('payment order not found');
      if (order.purpose !== PaymentOrderPurpose.SUBSCRIPTION_PURCHASE || order.status !== PaymentOrderStatus.CREATED) throw new RedemptionOrderNotEligibleError('order purpose/status'); // §14/§15
      if (order.izlDiscountAmount !== 0 || order.payableAmount !== order.grossAmount) throw new RedemptionOrderNotEligibleError('order already discounted'); // §16/§73
      if (order.expiresAt && input.now >= order.expiresAt) throw new RedemptionOrderNotEligibleError('order expired'); // §17/§69

      const open = await tx.iZLRedemption.findFirst({ where: { paymentOrderId: input.paymentOrderId, type: RedemptionType.SUBSCRIPTION_DISCOUNT, status: { in: OPEN_STATUSES } } });
      if (open) throw new RedemptionOpenIntentConflictError('open redemption exists for order'); // §9 (partial unique is the backstop)

      const rate = await tx.izlRateVersion.findFirst({ where: { status: 'ACTIVE', effectiveFrom: { lte: input.now } }, orderBy: { effectiveFrom: 'desc' }, select: { rateUzsPerIzl: true } }); // §19
      if (!rate) throw new RedemptionRateNotAvailableError('no usable izl rate');

      const [ledgerAgg, reservedAgg] = await Promise.all([
        tx.iZLLedgerEntry.aggregate({ where: { userId: input.userId }, _sum: { amount: true } }),
        tx.iZLReservation.aggregate({ where: { userId: input.userId, status: IzlReservationStatus.ACTIVE }, _sum: { amountIzl: true } }),
      ]);
      const available = (ledgerAgg._sum.amount ?? 0) - (reservedAgg._sum.amountIzl ?? 0); // canonical, under lock (§26)

      const ev = evaluateRedemption({ grossAmount: order.grossAmount, amountIzl: input.amountIzl, rateUzsPerIzl: rate.rateUzsPerIzl, availableIzl: available });
      if (!ev.ok) {
        if (ev.reason === 'insufficient_available') throw new IzlInsufficientAvailableError('requested amount exceeds available izl'); // §27/§66
        throw new RedemptionCeilingExceededError('discount value exceeds the order ceiling'); // exceeds_ceiling / non_positive (§24/§42)
      }

      try {
        const redemption = await tx.iZLRedemption.create({
          data: { userId: input.userId, type: RedemptionType.SUBSCRIPTION_DISCOUNT, amountIzl: input.amountIzl, izlRateSnapshot: rate.rateUzsPerIzl, valueUzs: ev.valueUzs, paymentOrderId: input.paymentOrderId, clientRequestId: input.clientRequestId, policyVersionCode: SUBSCRIPTION_DISCOUNT_REDEMPTION_VERSION, status: RedemptionStatus.RESERVED },
          select: { id: true },
        });
        await tx.iZLReservation.create({ data: { userId: input.userId, amountIzl: input.amountIzl, status: IzlReservationStatus.ACTIVE, idempotencyKey: `subscription-discount-redemption:${redemption.id}`, purposeCode: REDEMPTION_RESERVATION_PURPOSE, redemptionId: redemption.id } }); // typed 1:1 (§7/§30)
        return redemption.id;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          const raced = await tx.iZLRedemption.findFirst({ where: { userId: input.userId, clientRequestId: input.clientRequestId } });
          if (raced) return this.replayId(raced, input.paymentOrderId, input.amountIzl); // concurrent same request (§38)
          throw new RedemptionOpenIntentConflictError('open redemption exists for order'); // concurrent different keys, same order (§39)
        }
        throw e;
      }
    });
  }

  /**
   * Release a RESERVED redemption + its ACTIVE reservation atomically (idempotent, no ledger movement). Phase 2.1D:
   * if the redemption is COMMITTED to its PaymentOrder (order pointer = redemption), the order pricing is restored
   * (discount 0, payable = gross, pointer NULL) in the same transaction — allowed only while the order is still
   * CREATED (§24/§25/§29). Uncommitted release is independent of order status (§24).
   */
  async releaseRedemption(userId: string, redemptionId: string, now: Date): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'izl'}), hashtext(${userId}))`;
      const r = await tx.iZLRedemption.findFirst({ where: { id: redemptionId, userId }, select: { id: true, paymentOrderId: true, status: true, reservation: { select: { id: true, status: true } } } });
      if (!r) throw new RedemptionNotFoundError('redemption not found');
      if (r.status === RedemptionStatus.RELEASED) return r.id; // idempotent (§28/§47)
      if (r.status !== RedemptionStatus.RESERVED) throw new RedemptionOrderNotEligibleError('redemption not releasable'); // APPLIED/other (defensive)

      if (r.paymentOrderId) {
        const order = await tx.paymentOrder.findFirst({ where: { id: r.paymentOrderId, userId }, select: { id: true, status: true, grossAmount: true, izlRedemptionId: true } });
        if (order && order.izlRedemptionId === r.id) {
          // Committed release — allowed only while the order is still pre-payment CREATED (§25/§26).
          if (order.status !== PaymentOrderStatus.CREATED) throw new RedemptionCommitConflictError('committed order is no longer CREATED');
          await tx.paymentOrder.update({ where: { id: order.id }, data: { izlDiscountAmount: 0, payableAmount: order.grossAmount, izlRedemptionId: null } }); // restore (§25)
        }
      }

      if (r.reservation && r.reservation.status === IzlReservationStatus.ACTIVE) {
        await tx.iZLReservation.update({ where: { id: r.reservation.id }, data: { status: IzlReservationStatus.RELEASED, releasedAt: now } });
      }
      await tx.iZLRedemption.update({ where: { id: r.id }, data: { status: RedemptionStatus.RELEASED, resolvedAt: now } });
      return r.id;
    });
  }

  private replayId(prior: { id: string; paymentOrderId: string | null; amountIzl: number; type: RedemptionType }, paymentOrderId: string, amountIzl: number): string {
    if (prior.type === RedemptionType.SUBSCRIPTION_DISCOUNT && prior.paymentOrderId === paymentOrderId && prior.amountIzl === amountIzl) return prior.id; // same quote (§36)
    throw new RedemptionRequestConflictError('client request id already used with a different redemption'); // §37
  }
}
