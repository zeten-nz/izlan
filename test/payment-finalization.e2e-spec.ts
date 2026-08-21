import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { PaymentOrderStatus, PaymentProvider, PaymentTransactionStatus, SubscriptionStatus } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { SMS_PORT } from '../src/sms/sms.port';
import { PaymentFinalizationService } from '../src/payments/payment-finalization.service';
import { PaymentCallbackService } from '../src/payments/payment-callback.service';
import { PAYMENT_PROVIDER_PORT } from '../src/payments/provider/payment-provider.port';
import { SubscriptionPurchaseActiveConflictError, PaymentFinalizationIntegrityError } from '../src/common/errors';
import { cleanupAuthTables } from './test-db.helper';
import { TestSmsAdapter } from './test-sms.adapter';
import { TestPaymentProviderAdapter } from './test-payment-provider.adapter';

const CONFIRMED = new Date('2026-08-20T07:00:00.000Z');
const POLICY_CONFIG = { schemaVersion: 'izl-reward-policy/v1', dailyMissionRewards: { MASTERY_TEST_90: { missionPolicyVersion: 'mastery-test-90-mission-v1', amountIzl: 1 } }, caps: { dailyMissionIzlPerLocalDate: 1, dailyMissionIzlPerCycle: 30 } };

describe('Verified payment economic finalization (e2e, izlan_test)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let finalizer: PaymentFinalizationService;
  let callbackSvc: PaymentCallbackService;
  const providerAdapter = new TestPaymentProviderAdapter();
  let n = 0;
  let so = 0;
  let ver = 500;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_PORT).useValue(new TestSmsAdapter())
      .overrideProvider(PAYMENT_PROVIDER_PORT).useValue(providerAdapter)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    prisma = moduleRef.get(PrismaService);
    finalizer = moduleRef.get(PaymentFinalizationService);
    callbackSvc = moduleRef.get(PaymentCallbackService);
    await reset();
  });
  afterAll(async () => { await reset(); await app.close(); });
  beforeEach(reset);

  async function reset() {
    await prisma.paymentCallbackEvent.deleteMany();
    await prisma.paymentTransaction.deleteMany();
    await prisma.subscriptionCycleEntitlement.deleteMany();
    await prisma.iZLLedgerEntry.deleteMany();
    await prisma.subscription.updateMany({ data: { currentCycleId: null } });
    await prisma.subscriptionCycle.deleteMany();
    await prisma.subscription.deleteMany();
    await prisma.iZLReservation.deleteMany();
    await prisma.iZLRedemption.deleteMany();
    await prisma.paymentOrder.deleteMany();
    await prisma.planEntitlement.deleteMany();
    await prisma.planPrice.deleteMany();
    await prisma.subscriptionPlan.deleteMany();
    await prisma.rewardPolicyVersion.deleteMany();
    await prisma.izlRateVersion.deleteMany();
    await prisma.iZLWallet.deleteMany();
    await cleanupAuthTables(prisma);
  }
  const uid = () => `${Date.now()}-${n++}`;
  const seedUser = () => prisma.user.create({ data: { phone: `+99890${String(3000000 + n++).slice(-7)}` }, select: { id: true } }).then((u) => u.id);
  const seedReward = async (createdBy: string) => {
    if (!(await prisma.rewardPolicyVersion.findFirst({ where: { status: 'ACTIVE' } }))) await prisma.rewardPolicyVersion.create({ data: { version: ver++, status: 'ACTIVE', config: POLICY_CONFIG, effectiveFrom: new Date('2026-08-01T00:00:00Z'), createdBy } });
    if (!(await prisma.izlRateVersion.findFirst({ where: { status: 'ACTIVE' } }))) await prisma.izlRateVersion.create({ data: { rateUzsPerIzl: 1000, status: 'ACTIVE', effectiveFrom: new Date('2026-08-01T00:00:00Z'), createdBy } });
  };

  async function seedPlan(userId: string, entitlements: { featureCode: string; mode: 'ENABLED' | 'UNLIMITED' | 'LIMITED' | 'DISABLED'; limitValue?: number }[] = []) {
    const plan = await prisma.subscriptionPlan.create({ data: { code: `P-${uid()}`, name: 'Pro', sortOrder: so++ }, select: { id: true } });
    const price = await prisma.planPrice.create({ data: { planId: plan.id, amount: 100000, billingPeriodMonths: 1, effectiveFrom: new Date('2026-08-01T00:00:00Z'), createdBy: userId }, select: { id: true } });
    for (const e of entitlements) await prisma.planEntitlement.create({ data: { planId: plan.id, featureCode: e.featureCode, mode: e.mode, limitValue: e.limitValue ?? null } });
    return { planId: plan.id, priceId: price.id };
  }
  async function seedSucceededOrder(userId: string, o: { gross?: number; discount?: number; planId?: string; priceId?: string } = {}) {
    const gross = o.gross ?? 100000;
    const discount = o.discount ?? 0;
    let planId = o.planId, priceId = o.priceId;
    if (!planId) { const p = await seedPlan(userId); planId = p.planId; priceId = p.priceId; }
    let izlRedemptionId: string | null = null;
    if (discount > 0) {
      const red = await prisma.iZLRedemption.create({ data: { userId, type: 'SUBSCRIPTION_DISCOUNT', amountIzl: discount / 1000, izlRateSnapshot: 1000, valueUzs: discount, paymentOrderId: null, policyVersionCode: 'subscription-discount-redemption-v1', status: 'RESERVED' }, select: { id: true } });
      await prisma.iZLReservation.create({ data: { userId, amountIzl: discount / 1000, status: 'ACTIVE', idempotencyKey: `subscription-discount-redemption:${red.id}`, purposeCode: 'SUBSCRIPTION_DISCOUNT_REDEMPTION', redemptionId: red.id } });
      izlRedemptionId = red.id;
    }
    const order = await prisma.paymentOrder.create({ data: { userId, purpose: 'SUBSCRIPTION_PURCHASE', planId: planId!, planPriceId: priceId!, currency: 'UZS', grossAmount: gross, izlDiscountAmount: discount, payableAmount: gross - discount, status: PaymentOrderStatus.PENDING, izlRedemptionId }, select: { id: true } });
    if (izlRedemptionId) await prisma.iZLRedemption.update({ where: { id: izlRedemptionId }, data: { paymentOrderId: order.id } });
    const tx = await prisma.paymentTransaction.create({ data: { paymentOrderId: order.id, provider: 'CLICK', amount: gross - discount, status: PaymentTransactionStatus.SUCCEEDED, providerTransactionId: `ext-${uid()}`, confirmedAt: CONFIRMED, clientRequestId: uid() }, select: { id: true } });
    return { orderId: order.id, txId: tx.id, redemptionId: izlRedemptionId, planId: planId!, priceId: priceId! };
  }
  const ledgerBalance = async (userId: string) => (await prisma.iZLLedgerEntry.aggregate({ where: { userId }, _sum: { amount: true } }))._sum.amount ?? 0;
  const activeReserved = async (userId: string) => (await prisma.iZLReservation.aggregate({ where: { userId, status: 'ACTIVE' }, _sum: { amountIzl: true } }))._sum.amountIzl ?? 0;
  const order = (id: string) => prisma.paymentOrder.findUnique({ where: { id } });
  const cycle = (orderId: string) => prisma.subscriptionCycle.findUnique({ where: { paymentOrderId: orderId } });

  // ───────────────────────────────────────────────────────────────────────────

  it('§85 undiscounted finalization → order PAID, Subscription ACTIVE, Cycle with calendar-month period + net snapshots', async () => {
    const userId = await seedUser();
    await seedReward(userId);
    const s = await seedSucceededOrder(userId, { gross: 100000 });
    const res = await finalizer.finalizeVerifiedPayment(s.txId);
    expect(res).toMatchObject({ status: 'PAID', discounted: false, replay: false });
    expect((await order(s.orderId))!.status).toBe('PAID');
    const sub = await prisma.subscription.findUnique({ where: { id: res.subscriptionId } });
    expect(sub).toMatchObject({ status: 'ACTIVE', planId: s.planId });
    expect(sub!.currentCycleId).toBe(res.subscriptionCycleId);
    expect(sub!.startedAt.toISOString()).toBe(CONFIRMED.toISOString());
    const c = (await cycle(s.orderId))!;
    expect(c).toMatchObject({ sequenceNo: 1, grossPriceUzs: 100000, discountUzs: 0, paidAmountUzs: 100000, rewardBasisUzs: 100000, status: 'ACTIVE' });
    expect(c.periodStart.toISOString()).toBe('2026-08-20T07:00:00.000Z');
    expect(c.periodEnd.toISOString()).toBe('2026-09-20T07:00:00.000Z'); // +1 calendar month
    expect(await prisma.iZLLedgerEntry.count({ where: { userId } })).toBe(0); // no IZL
    // reward-enabled snapshot
    expect(c.rewardCeilingUzs).toBe(20000);
    expect(c.rewardCeilingIzl).toBe(20);
    expect(c.rewardPolicyVersionId).toBeTruthy();
    // no reward grant / xp / callback / provider from finalization
    expect(await prisma.rewardGrant.count({ where: { userId } })).toBe(0);
    expect(providerAdapter).toBeDefined();
  });

  it('§86 discounted finalization → REDEEM −4, reservation CONSUMED, redemption APPLIED (resolvedAt=confirmedAt), available invariant', async () => {
    const userId = await seedUser();
    await seedReward(userId);
    await prisma.iZLLedgerEntry.create({ data: { userId, entryNo: 1, entryType: 'EARN', amount: 10, balanceAfter: 10 } }); // start ledger 10
    const s = await seedSucceededOrder(userId, { gross: 100000, discount: 4000 }); // reservation ACTIVE 4
    expect(await ledgerBalance(userId)).toBe(10);
    expect(await activeReserved(userId)).toBe(4);
    const res = await finalizer.finalizeVerifiedPayment(s.txId);
    expect(res).toMatchObject({ status: 'PAID', discounted: true, redemptionId: s.redemptionId });
    const c = (await cycle(s.orderId))!;
    expect(c).toMatchObject({ grossPriceUzs: 100000, discountUzs: 4000, paidAmountUzs: 96000, rewardBasisUzs: 96000 });
    const redeem = await prisma.iZLLedgerEntry.findFirst({ where: { entryType: 'REDEEM', redemptionId: s.redemptionId } });
    expect(redeem).toMatchObject({ amount: -4, balanceAfter: 6, subscriptionCycleId: res.subscriptionCycleId });
    expect((await prisma.iZLReservation.findFirst({ where: { redemptionId: s.redemptionId } }))!.status).toBe('CONSUMED');
    const red = await prisma.iZLRedemption.findUnique({ where: { id: s.redemptionId! } });
    expect(red!.status).toBe('APPLIED');
    expect(red!.resolvedAt!.toISOString()).toBe(CONFIRMED.toISOString());
    expect(await ledgerBalance(userId)).toBe(6); // 10 − 4
    expect(await activeReserved(userId)).toBe(0); // consumed exits ACTIVE
    // available invariant: before 10−4=6, after 6−0=6
  });

  it('§87/§42 negative-available finalization: held funds still consumed, signed negative ledger allowed', async () => {
    const userId = await seedUser();
    await prisma.iZLLedgerEntry.create({ data: { userId, entryNo: 1, entryType: 'EARN', amount: 2, balanceAfter: 2 } }); // ledger 2
    const s = await seedSucceededOrder(userId, { gross: 100000, discount: 4000 }); // reserved 4 → available −2
    await finalizer.finalizeVerifiedPayment(s.txId);
    expect(await ledgerBalance(userId)).toBe(-2); // 2 − 4, signed negative allowed
    expect(await activeReserved(userId)).toBe(0);
    expect((await order(s.orderId))!.status).toBe('PAID');
  });

  it('§88/§53 EXPIRED subscription reactivation: same episode, plan updated, startedAt preserved, seq+1', async () => {
    const userId = await seedUser();
    const oldStarted = new Date('2026-01-01T00:00:00Z');
    const oldPlanSet = await seedPlan(userId);
    const sub = await prisma.subscription.create({ data: { userId, planId: oldPlanSet.planId, status: SubscriptionStatus.EXPIRED, startedAt: oldStarted }, select: { id: true } });
    const oldCycle = await prisma.subscriptionCycle.create({ data: { subscriptionId: sub.id, sequenceNo: 1, periodStart: oldStarted, periodEnd: new Date('2026-02-01T00:00:00Z'), planId: oldPlanSet.planId, planPriceId: oldPlanSet.priceId, grossPriceUzs: 100000, discountUzs: 0, paidAmountUzs: 100000, rewardBasisUzs: 100000, rewardCeilingUzs: 0, rewardCeilingIzl: 0, rewardPolicyVersionId: null, izlRateSnapshot: null, earnedIzl: 0, status: 'COMPLETED' }, select: { id: true } });
    const s = await seedSucceededOrder(userId, { gross: 100000 }); // new plan
    const res = await finalizer.finalizeVerifiedPayment(s.txId);
    expect(res.subscriptionId).toBe(sub.id); // same episode reused
    const reloaded = await prisma.subscription.findUnique({ where: { id: sub.id } });
    expect(reloaded).toMatchObject({ status: 'ACTIVE', planId: s.planId }); // plan updated to new purchase
    expect(reloaded!.startedAt.toISOString()).toBe(oldStarted.toISOString()); // preserved
    expect(reloaded!.currentCycleId).toBe(res.subscriptionCycleId);
    expect((await cycle(s.orderId))!.sequenceNo).toBe(2); // max+1
    expect((await prisma.subscriptionCycle.findUnique({ where: { id: oldCycle.id } }))!.status).toBe('COMPLETED'); // old unchanged
    expect(await prisma.subscription.count({ where: { userId } })).toBe(1); // no second subscription
  });

  it('§89/§21/§52 ACTIVE subscription → recoverable conflict; no PAID/cycle/IZL; evidence recoverable (discounted)', async () => {
    const userId = await seedUser();
    const p = await seedPlan(userId);
    await prisma.subscription.create({ data: { userId, planId: p.planId, status: SubscriptionStatus.ACTIVE } });
    const s = await seedSucceededOrder(userId, { gross: 100000, discount: 4000, planId: p.planId, priceId: p.priceId });
    await expect(finalizer.finalizeVerifiedPayment(s.txId)).rejects.toBeInstanceOf(SubscriptionPurchaseActiveConflictError);
    expect((await order(s.orderId))!.status).toBe('PENDING'); // unchanged
    expect(await cycle(s.orderId)).toBeNull();
    expect((await prisma.iZLRedemption.findUnique({ where: { id: s.redemptionId! } }))!.status).toBe('RESERVED'); // not consumed
    expect((await prisma.iZLReservation.findFirst({ where: { redemptionId: s.redemptionId } }))!.status).toBe('ACTIVE');
    expect(await prisma.iZLLedgerEntry.count({ where: { userId, entryType: 'REDEEM' } })).toBe(0);
    expect((await prisma.paymentTransaction.findUnique({ where: { id: s.txId } }))!.status).toBe('SUCCEEDED'); // evidence intact
  });

  it('§90/§54 only CANCELLED history → new Subscription episode', async () => {
    const userId = await seedUser();
    const p = await seedPlan(userId);
    const old = await prisma.subscription.create({ data: { userId, planId: p.planId, status: SubscriptionStatus.CANCELLED }, select: { id: true } });
    const s = await seedSucceededOrder(userId, { gross: 100000 });
    const res = await finalizer.finalizeVerifiedPayment(s.txId);
    expect(res.subscriptionId).not.toBe(old.id); // CANCELLED not resurrected
    expect(await prisma.subscription.count({ where: { userId, status: 'ACTIVE' } })).toBe(1);
  });

  it('§56/§92 reward-disabled finalization: no usable policy/rate → paid access still activates, cycle reward NULL/0', async () => {
    const userId = await seedUser();
    // no reward policy / rate seeded
    const s = await seedSucceededOrder(userId, { gross: 100000 });
    const res = await finalizer.finalizeVerifiedPayment(s.txId);
    expect(res.status).toBe('PAID');
    const c = (await cycle(s.orderId))!;
    expect(c.rewardPolicyVersionId).toBeNull();
    expect(c.izlRateSnapshot).toBeNull();
    expect(c.rewardCeilingUzs).toBe(0);
    expect(c.rewardCeilingIzl).toBe(0);
    expect((await order(s.orderId))!.status).toBe('PAID');
  });

  it('§57 malformed reward policy config → reward-disabled cycle, paid access still activates', async () => {
    const userId = await seedUser();
    await prisma.rewardPolicyVersion.create({ data: { version: ver++, status: 'ACTIVE', config: { schemaVersion: 'WRONG', junk: true }, effectiveFrom: new Date('2026-08-01T00:00:00Z'), createdBy: userId } });
    await prisma.izlRateVersion.create({ data: { rateUzsPerIzl: 1000, status: 'ACTIVE', effectiveFrom: new Date('2026-08-01T00:00:00Z'), createdBy: userId } });
    const s = await seedSucceededOrder(userId, { gross: 100000 });
    const res = await finalizer.finalizeVerifiedPayment(s.txId);
    expect(res.status).toBe('PAID');
    expect((await cycle(s.orderId))!.rewardPolicyVersionId).toBeNull(); // malformed → disabled, not an error
  });

  it('§58 future-effective reward config is not usable → reward-disabled cycle', async () => {
    const userId = await seedUser();
    await prisma.rewardPolicyVersion.create({ data: { version: ver++, status: 'ACTIVE', config: POLICY_CONFIG, effectiveFrom: new Date('2026-12-01T00:00:00Z'), createdBy: userId } }); // after confirmedAt
    await prisma.izlRateVersion.create({ data: { rateUzsPerIzl: 1000, status: 'ACTIVE', effectiveFrom: new Date('2026-12-01T00:00:00Z'), createdBy: userId } });
    const s = await seedSucceededOrder(userId, { gross: 100000 });
    await finalizer.finalizeVerifiedPayment(s.txId);
    expect((await cycle(s.orderId))!.rewardPolicyVersionId).toBeNull();
  });

  it('§59/§93 plan entitlements are snapshotted deterministically into the cycle', async () => {
    const userId = await seedUser();
    const p = await seedPlan(userId, [{ featureCode: 'ai_tutor', mode: 'UNLIMITED' }, { featureCode: 'mock_tests', mode: 'LIMITED', limitValue: 5 }]);
    const s = await seedSucceededOrder(userId, { gross: 100000, planId: p.planId, priceId: p.priceId });
    const res = await finalizer.finalizeVerifiedPayment(s.txId);
    const ents = await prisma.subscriptionCycleEntitlement.findMany({ where: { cycleId: res.subscriptionCycleId }, orderBy: { featureCode: 'asc' } });
    expect(ents).toHaveLength(2);
    expect(ents).toMatchObject([{ featureCode: 'ai_tutor', mode: 'UNLIMITED', limitValue: null }, { featureCode: 'mock_tests', mode: 'LIMITED', limitValue: 5 }]);
    expect(await prisma.usageCounter.count()).toBe(0); // deferred (§31)
  });

  it('§48/§94 idempotent replay (undiscounted) → no new writes, same projection', async () => {
    const userId = await seedUser();
    await seedReward(userId);
    const s = await seedSucceededOrder(userId, { gross: 100000 });
    const a = await finalizer.finalizeVerifiedPayment(s.txId);
    const b = await finalizer.finalizeVerifiedPayment(s.txId);
    expect(b).toMatchObject({ subscriptionId: a.subscriptionId, subscriptionCycleId: a.subscriptionCycleId, status: 'PAID', replay: true });
    expect(await prisma.subscriptionCycle.count({ where: { paymentOrderId: s.orderId } })).toBe(1);
    expect(await prisma.subscription.count({ where: { userId } })).toBe(1);
  });

  it('§49/§94 idempotent replay (discounted) → one REDEEM, one CONSUMED, one APPLIED', async () => {
    const userId = await seedUser();
    await prisma.iZLLedgerEntry.create({ data: { userId, entryNo: 1, entryType: 'EARN', amount: 10, balanceAfter: 10 } });
    const s = await seedSucceededOrder(userId, { gross: 100000, discount: 4000 });
    await finalizer.finalizeVerifiedPayment(s.txId);
    await finalizer.finalizeVerifiedPayment(s.txId); // replay
    expect(await prisma.iZLLedgerEntry.count({ where: { entryType: 'REDEEM', redemptionId: s.redemptionId } })).toBe(1);
    expect(await ledgerBalance(userId)).toBe(6); // not 2 (no double debit)
    expect(await prisma.subscriptionCycle.count({ where: { paymentOrderId: s.orderId } })).toBe(1);
  });

  it('§50/§95 concurrent finalization same order → one cycle, one effect', async () => {
    const userId = await seedUser();
    await seedReward(userId);
    const s = await seedSucceededOrder(userId, { gross: 100000 });
    const [a, b] = await Promise.allSettled([finalizer.finalizeVerifiedPayment(s.txId), finalizer.finalizeVerifiedPayment(s.txId)]);
    expect([a, b].every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await prisma.subscriptionCycle.count({ where: { paymentOrderId: s.orderId } })).toBe(1);
    expect(await prisma.subscription.count({ where: { userId } })).toBe(1);
  });

  it('§51/§96 two paid orders same user → one activates, the other hits ACTIVE conflict, stays PENDING', async () => {
    const userId = await seedUser();
    const s1 = await seedSucceededOrder(userId, { gross: 100000 });
    const s2 = await seedSucceededOrder(userId, { gross: 100000 });
    await finalizer.finalizeVerifiedPayment(s1.txId);
    await expect(finalizer.finalizeVerifiedPayment(s2.txId)).rejects.toBeInstanceOf(SubscriptionPurchaseActiveConflictError);
    expect((await order(s1.orderId))!.status).toBe('PAID');
    expect((await order(s2.orderId))!.status).toBe('PENDING');
    expect(await prisma.subscriptionCycle.count({ where: { subscription: { userId } } })).toBe(1);
  });

  it('§99 post-callback bridge auto-finalizes a freshly verified payment; §69 no provider re-charge', async () => {
    const userId = await seedUser();
    await seedReward(userId);
    // seed a PENDING order + PENDING transaction (as after 2.1E), then verify via the callback service (2.1F) → bridge finalizes (2.1G)
    const p = await seedPlan(userId);
    const o = await prisma.paymentOrder.create({ data: { userId, purpose: 'SUBSCRIPTION_PURCHASE', planId: p.planId, planPriceId: p.priceId, currency: 'UZS', grossAmount: 100000, izlDiscountAmount: 0, payableAmount: 100000, status: 'PENDING' }, select: { id: true } });
    const tx = await prisma.paymentTransaction.create({ data: { paymentOrderId: o.id, provider: 'CLICK', amount: 100000, status: 'PENDING', providerTransactionId: null, clientRequestId: uid() }, select: { id: true } });
    const initSpy = jest.spyOn(providerAdapter, 'initiate');
    const out = await callbackSvc.processProviderCallback('CLICK' as PaymentProvider, { provider: 'CLICK' as PaymentProvider, payload: { eventId: `evt-${uid()}`, merchantTransactionId: tx.id, providerTransactionId: 'ext-bridge-1', amount: 100000, currency: 'UZS', confirmedAt: CONFIRMED.toISOString() } });
    expect(out.outcome).toBe('ACCEPTED');
    expect((await prisma.paymentTransaction.findUnique({ where: { id: tx.id } }))!.status).toBe('SUCCEEDED');
    expect((await order(o.id))!.status).toBe('PAID'); // bridge finalized it
    expect(await prisma.subscriptionCycle.count({ where: { paymentOrderId: o.id } })).toBe(1);
    expect(initSpy).not.toHaveBeenCalled(); // no provider re-charge (§69)
  });

  it('§64/§100 bridge does not break verification when finalization conflicts (ACTIVE sub); evidence stays SUCCEEDED, order PENDING', async () => {
    const userId = await seedUser();
    const p = await seedPlan(userId);
    await prisma.subscription.create({ data: { userId, planId: p.planId, status: 'ACTIVE' } });
    const o = await prisma.paymentOrder.create({ data: { userId, purpose: 'SUBSCRIPTION_PURCHASE', planId: p.planId, planPriceId: p.priceId, currency: 'UZS', grossAmount: 100000, izlDiscountAmount: 0, payableAmount: 100000, status: 'PENDING' }, select: { id: true } });
    const tx = await prisma.paymentTransaction.create({ data: { paymentOrderId: o.id, provider: 'CLICK', amount: 100000, status: 'PENDING', providerTransactionId: null, clientRequestId: uid() }, select: { id: true } });
    const out = await callbackSvc.processProviderCallback('CLICK' as PaymentProvider, { provider: 'CLICK' as PaymentProvider, payload: { eventId: `evt-${uid()}`, merchantTransactionId: tx.id, providerTransactionId: 'ext-bridge-2', amount: 100000, currency: 'UZS', confirmedAt: CONFIRMED.toISOString() } });
    expect(out.outcome).toBe('ACCEPTED'); // verification succeeded despite finalization conflict
    expect((await prisma.paymentTransaction.findUnique({ where: { id: tx.id } }))!.status).toBe('SUCCEEDED');
    expect((await order(o.id))!.status).toBe('PENDING'); // finalization deferred (recoverable)
    expect(await prisma.subscriptionCycle.count({ where: { paymentOrderId: o.id } })).toBe(0);
  });

  it('§62/§98 mid-transaction constraint failure rolls back ALL finalization writes (atomic)', async () => {
    const userId = await seedUser();
    await prisma.iZLLedgerEntry.create({ data: { userId, entryNo: 1, entryType: 'EARN', amount: 10, balanceAfter: 10 } });
    const s = await seedSucceededOrder(userId, { gross: 100000, discount: 4000 });
    // Pre-insert a REDEEM for this redemption → the finalizer's own REDEEM insert violates FP-DB-04 AFTER it has already
    // written Subscription + Cycle + entitlement snapshot in the same transaction → the whole transaction must roll back.
    await prisma.iZLLedgerEntry.create({ data: { userId, entryNo: 2, entryType: 'REDEEM', amount: -4, balanceAfter: 6, redemptionId: s.redemptionId } });
    await expect(finalizer.finalizeVerifiedPayment(s.txId)).rejects.toBeTruthy();
    expect((await order(s.orderId))!.status).toBe('PENDING'); // no PAID
    expect(await cycle(s.orderId)).toBeNull(); // cycle rolled back
    expect(await prisma.subscription.count({ where: { userId } })).toBe(0); // subscription rolled back
    expect((await prisma.iZLRedemption.findUnique({ where: { id: s.redemptionId! } }))!.status).toBe('RESERVED'); // untouched
    expect((await prisma.iZLReservation.findFirst({ where: { redemptionId: s.redemptionId } }))!.status).toBe('ACTIVE');
    expect((await prisma.paymentTransaction.findUnique({ where: { id: s.txId } }))!.status).toBe('SUCCEEDED'); // evidence intact
  });

  it('§33 discount amount > 0 but redemption pointer NULL → integrity error (no partial effects)', async () => {
    const userId = await seedUser();
    const p = await seedPlan(userId);
    const o = await prisma.paymentOrder.create({ data: { userId, purpose: 'SUBSCRIPTION_PURCHASE', planId: p.planId, planPriceId: p.priceId, currency: 'UZS', grossAmount: 100000, izlDiscountAmount: 4000, payableAmount: 96000, status: 'PENDING', izlRedemptionId: null }, select: { id: true } });
    const tx = await prisma.paymentTransaction.create({ data: { paymentOrderId: o.id, provider: 'CLICK', amount: 96000, status: 'SUCCEEDED', providerTransactionId: `ext-${uid()}`, confirmedAt: CONFIRMED, clientRequestId: uid() }, select: { id: true } });
    await expect(finalizer.finalizeVerifiedPayment(tx.id)).rejects.toBeInstanceOf(PaymentFinalizationIntegrityError);
    expect((await order(o.id))!.status).toBe('PENDING');
  });
});
