import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { PaymentOrderStatus, PaymentProvider, PaymentTransactionStatus } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { SMS_PORT } from '../src/sms/sms.port';
import { PAYMENT_PROVIDER_PORT } from '../src/payments/provider/payment-provider.port';
import { PaymentOrderReopenService } from '../src/payments/payment-order-reopen.service';
import { PaymentOrderReopenRepository } from '../src/payments/payment-order-reopen.repository';
import { PaymentCallbackService } from '../src/payments/payment-callback.service';
import { PaymentsService } from '../src/payments/payments.service';
import { SubscriptionDiscountRedemptionService } from '../src/finance/redemption/subscription-discount-redemption.service';
import { PaymentOrderNotEligibleError, PaymentAttemptRequestConflictError } from '../src/common/errors';
import { cleanupAuthTables } from './test-db.helper';
import { TestSmsAdapter } from './test-sms.adapter';
import { TestPaymentProviderAdapter } from './test-payment-provider.adapter';

describe('Payment order reopen / retry (e2e, izlan_test)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let reopen: PaymentOrderReopenService;
  let reopenRepo: PaymentOrderReopenRepository;
  let callbackSvc: PaymentCallbackService;
  let payments: PaymentsService;
  let redemption: SubscriptionDiscountRedemptionService;
  const providerAdapter = new TestPaymentProviderAdapter();
  let n = 0;
  let so = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_PORT).useValue(new TestSmsAdapter())
      .overrideProvider(PAYMENT_PROVIDER_PORT).useValue(providerAdapter)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    prisma = moduleRef.get(PrismaService);
    reopen = moduleRef.get(PaymentOrderReopenService);
    reopenRepo = moduleRef.get(PaymentOrderReopenRepository);
    callbackSvc = moduleRef.get(PaymentCallbackService);
    payments = moduleRef.get(PaymentsService);
    redemption = moduleRef.get(SubscriptionDiscountRedemptionService);
    await reset();
  });
  afterAll(async () => { await reset(); await app.close(); });
  beforeEach(async () => { await reset(); jest.restoreAllMocks(); });

  async function reset() {
    await prisma.paymentCallbackEvent.deleteMany();
    await prisma.paymentTransaction.deleteMany();
    await prisma.iZLReservation.deleteMany();
    await prisma.iZLRedemption.deleteMany();
    await prisma.iZLLedgerEntry.deleteMany();
    await prisma.paymentOrder.deleteMany();
    await prisma.planPrice.deleteMany();
    await prisma.subscriptionPlan.deleteMany();
    await prisma.iZLWallet.deleteMany();
    await cleanupAuthTables(prisma);
  }
  const uid = () => `${Date.now()}-${n++}`;
  const seedUser = () => prisma.user.create({ data: { phone: `+99890${String(5000000 + n++).slice(-7)}` }, select: { id: true } }).then((u) => u.id);

  async function seedOrder(userId: string, opts: { discount?: number; orderStatus?: PaymentOrderStatus; expiresAt?: string } = {}) {
    const discount = opts.discount ?? 0;
    const plan = await prisma.subscriptionPlan.create({ data: { code: `P-${uid()}`, name: 'Pro', sortOrder: so++ }, select: { id: true } });
    const price = await prisma.planPrice.create({ data: { planId: plan.id, amount: 100000, billingPeriodMonths: 1, effectiveFrom: new Date('2026-08-01T00:00:00Z'), createdBy: userId }, select: { id: true } });
    let izlRedemptionId: string | null = null;
    if (discount > 0) {
      const red = await prisma.iZLRedemption.create({ data: { userId, type: 'SUBSCRIPTION_DISCOUNT', amountIzl: discount / 1000, izlRateSnapshot: 1000, valueUzs: discount, policyVersionCode: 'subscription-discount-redemption-v1', status: 'RESERVED' }, select: { id: true } });
      await prisma.iZLReservation.create({ data: { userId, amountIzl: discount / 1000, status: 'ACTIVE', idempotencyKey: `subscription-discount-redemption:${red.id}`, purposeCode: 'SUBSCRIPTION_DISCOUNT_REDEMPTION', redemptionId: red.id } });
      izlRedemptionId = red.id;
    }
    const order = await prisma.paymentOrder.create({ data: { userId, purpose: 'SUBSCRIPTION_PURCHASE', planId: plan.id, planPriceId: price.id, currency: 'UZS', grossAmount: 100000, izlDiscountAmount: discount, payableAmount: 100000 - discount, status: opts.orderStatus ?? PaymentOrderStatus.PENDING, izlRedemptionId, ...(opts.expiresAt ? { expiresAt: new Date(opts.expiresAt) } : {}) }, select: { id: true } });
    if (izlRedemptionId) await prisma.iZLRedemption.update({ where: { id: izlRedemptionId }, data: { paymentOrderId: order.id } });
    return { orderId: order.id, redemptionId: izlRedemptionId };
  }
  const seedTx = (orderId: string, status: PaymentTransactionStatus, o: { provider?: PaymentProvider; providerTransactionId?: string | null; clientRequestId?: string } = {}) =>
    prisma.paymentTransaction.create({ data: { paymentOrderId: orderId, provider: o.provider ?? 'CLICK', amount: 100000, status, providerTransactionId: o.providerTransactionId ?? (status === 'PENDING' ? null : `ext-${uid()}`), confirmedAt: status === 'SUCCEEDED' ? new Date('2026-08-20T07:00:00Z') : null, clientRequestId: o.clientRequestId ?? uid() }, select: { id: true } }).then((t) => t.id);
  const order = (id: string) => prisma.paymentOrder.findUnique({ where: { id } });
  const txn = (id: string) => prisma.paymentTransaction.findUnique({ where: { id } });
  const pendingCount = (orderId: string) => prisma.paymentTransaction.count({ where: { paymentOrderId: orderId, status: 'PENDING' } });
  const failCb = (provider: PaymentProvider, merchantTransactionId: string, providerTransactionId: string, eventId = `evt-${n++}`) =>
    callbackSvc.processProviderCallback(provider, { provider, payload: { eventId, merchantTransactionId, status: 'FAILED', providerTransactionId } });

  // ───────────────────────────────────────────────────────────────────────────

  it('§68/§69 FAILED / CANCELLED terminal attempt → order PENDING→CREATED; terminal PT untouched', async () => {
    const userId = await seedUser();
    for (const st of [PaymentTransactionStatus.FAILED, PaymentTransactionStatus.CANCELLED]) {
      const o = await seedOrder(userId);
      const txId = await seedTx(o.orderId, st, { providerTransactionId: `ext-t-${st}` });
      const res = await reopen.reopenAfterTerminalAttempt(txId);
      expect(res).toMatchObject({ outcome: 'REOPENED', paymentOrderId: o.orderId });
      expect((await order(o.orderId))!.status).toBe('CREATED');
      expect((await txn(txId))!.status).toBe(st); // terminal PT immutable (§36)
    }
  });

  it('§70 post-non-success callback bridge auto-reopens: PT PENDING→FAILED commits, then order→CREATED; no provider call', async () => {
    const userId = await seedUser();
    const o = await seedOrder(userId);
    const txId = await seedTx(o.orderId, PaymentTransactionStatus.PENDING, { providerTransactionId: null });
    const initSpy = jest.spyOn(providerAdapter, 'initiate');
    const out = await failCb('CLICK', txId, 'ext-b1');
    expect(out).toMatchObject({ outcome: 'ACCEPTED', transactionStatus: 'FAILED' });
    expect((await txn(txId))!.status).toBe('FAILED');
    expect((await order(o.orderId))!.status).toBe('CREATED'); // bridge reopened it
    expect(initSpy).not.toHaveBeenCalled(); // §41 no provider re-charge
  });

  it('§71/§72 bridge failure preserves evidence (order PENDING); matching replay recovers → CREATED', async () => {
    const userId = await seedUser();
    const o = await seedOrder(userId);
    const txId = await seedTx(o.orderId, PaymentTransactionStatus.PENDING, { providerTransactionId: null });
    const spy = jest.spyOn(reopenRepo, 'reopen').mockRejectedValueOnce(new Error('transient reopen failure'));
    const out = await failCb('CLICK', txId, 'ext-f1', 'evt-1');
    expect(out.outcome).toBe('ACCEPTED'); // evidence committed despite reopen failure (§25/§26)
    expect((await txn(txId))!.status).toBe('FAILED');
    expect((await order(o.orderId))!.status).toBe('PENDING'); // reopen deferred
    spy.mockRestore();
    // §72 matching distinct terminal callback → no second PT transition, bridge retries reopen
    const out2 = await failCb('CLICK', txId, 'ext-f1', 'evt-2');
    expect(out2.outcome).toBe('DUPLICATE');
    expect((await txn(txId))!.status).toBe('FAILED');
    expect((await order(o.orderId))!.status).toBe('CREATED'); // recovered
  });

  it('§73/§15 stale terminal reopen does not overwrite a newer PENDING retry', async () => {
    const userId = await seedUser();
    const o = await seedOrder(userId);
    const a = await seedTx(o.orderId, PaymentTransactionStatus.FAILED, { providerTransactionId: 'ext-a' });
    await reopen.reopenAfterTerminalAttempt(a); // order → CREATED
    await payments.initiate(userId, o.orderId, 'CLICK', 'k2'); // B PENDING, order → PENDING
    expect((await order(o.orderId))!.status).toBe('PENDING');
    const stale = await reopen.reopenAfterTerminalAttempt(a); // old A replay
    expect(stale.outcome).toBe('RETRY_ALREADY_IN_PROGRESS');
    expect((await order(o.orderId))!.status).toBe('PENDING'); // not reopened
    expect(await pendingCount(o.orderId)).toBe(1);
  });

  it('§74/§11 stale terminal reopen refused when a SUCCEEDED attempt exists (finalization territory)', async () => {
    const userId = await seedUser();
    const o = await seedOrder(userId);
    const a = await seedTx(o.orderId, PaymentTransactionStatus.FAILED, { providerTransactionId: 'ext-a' });
    await seedTx(o.orderId, PaymentTransactionStatus.SUCCEEDED, { providerTransactionId: 'ext-b' });
    const res = await reopen.reopenAfterTerminalAttempt(a);
    expect(res.outcome).toBe('PAYMENT_SUCCESS_PENDING_FINALIZATION');
    expect((await order(o.orderId))!.status).toBe('PENDING');
  });

  it('§75/§12 stale terminal reopen never reopens a PAID order', async () => {
    const userId = await seedUser();
    const o = await seedOrder(userId, { orderStatus: PaymentOrderStatus.PAID });
    const a = await seedTx(o.orderId, PaymentTransactionStatus.FAILED, { providerTransactionId: 'ext-a' });
    await seedTx(o.orderId, PaymentTransactionStatus.SUCCEEDED, { providerTransactionId: 'ext-b' });
    const res = await reopen.reopenAfterTerminalAttempt(a);
    expect(res.outcome).toBe('ALREADY_PAID');
    expect((await order(o.orderId))!.status).toBe('PAID');
  });

  it('§59/§60 PENDING and SUCCEEDED PTs are not reopen-eligible', async () => {
    const userId = await seedUser();
    const o1 = await seedOrder(userId);
    const pending = await seedTx(o1.orderId, PaymentTransactionStatus.PENDING, { providerTransactionId: null });
    expect((await reopen.reopenAfterTerminalAttempt(pending)).outcome).toBe('NOT_REOPENABLE');
    const o2 = await seedOrder(userId);
    const succeeded = await seedTx(o2.orderId, PaymentTransactionStatus.SUCCEEDED, { providerTransactionId: 'ext-s' });
    expect((await reopen.reopenAfterTerminalAttempt(succeeded)).outcome).toBe('NOT_REOPENABLE');
    expect((await order(o1.orderId))!.status).toBe('PENDING');
    expect((await order(o2.orderId))!.status).toBe('PENDING');
  });

  it('§13/§83 reopen is idempotent + concurrent-safe (one REOPENED, one ALREADY_REOPENED)', async () => {
    const userId = await seedUser();
    const o = await seedOrder(userId);
    const a = await seedTx(o.orderId, PaymentTransactionStatus.FAILED, { providerTransactionId: 'ext-a' });
    const [r1, r2] = await Promise.all([reopen.reopenAfterTerminalAttempt(a), reopen.reopenAfterTerminalAttempt(a)]);
    expect([r1.outcome, r2.outcome].sort()).toEqual(['ALREADY_REOPENED', 'REOPENED']);
    expect((await order(o.orderId))!.status).toBe('CREATED');
  });

  it('§76/§77/§31 retry: new clientRequestId → new PT; old key → old terminal attempt (no new PT)', async () => {
    const userId = await seedUser();
    const o = await seedOrder(userId);
    const a = await seedTx(o.orderId, PaymentTransactionStatus.FAILED, { providerTransactionId: 'ext-a', clientRequestId: 'k1' });
    await reopen.reopenAfterTerminalAttempt(a);
    // §77 old key replay → returns the old terminal attempt, no new PT, order stays CREATED
    const replay = await payments.initiate(userId, o.orderId, 'CLICK', 'k1');
    expect(replay.paymentTransaction.id).toBe(a);
    expect(await prisma.paymentTransaction.count({ where: { paymentOrderId: o.orderId } })).toBe(1);
    // §76 fresh key → new PENDING PT
    const fresh = await payments.initiate(userId, o.orderId, 'CLICK', 'k2');
    expect(fresh.paymentTransaction.id).not.toBe(a);
    expect(fresh.paymentTransaction.status).toBe('PENDING');
    expect(await pendingCount(o.orderId)).toBe(1); // exactly one live attempt (PT-DB-02)
  });

  it('§78/§33 retry may switch provider (CLICK failed → PAYME)', async () => {
    const userId = await seedUser();
    const o = await seedOrder(userId);
    const a = await seedTx(o.orderId, PaymentTransactionStatus.FAILED, { provider: 'CLICK', providerTransactionId: 'ext-a', clientRequestId: 'k1' });
    await reopen.reopenAfterTerminalAttempt(a);
    const b = await payments.initiate(userId, o.orderId, 'PAYME', 'k2');
    expect(b.paymentTransaction).toMatchObject({ provider: 'PAYME', status: 'PENDING' });
    expect((await txn(a))!.provider).toBe('CLICK'); // old attempt unchanged
    // §32 old key with a different provider is a conflict (bound to CLICK)
    await expect(payments.initiate(userId, o.orderId, 'PAYME', 'k1')).rejects.toBeInstanceOf(PaymentAttemptRequestConflictError);
  });

  it('§79 discounted reopen keeps pricing + RESERVED redemption + ACTIVE reservation + ledger unchanged', async () => {
    const userId = await seedUser();
    await prisma.iZLLedgerEntry.create({ data: { userId, entryNo: 1, entryType: 'EARN', amount: 10, balanceAfter: 10 } });
    const o = await seedOrder(userId, { discount: 4000 });
    const a = await seedTx(o.orderId, PaymentTransactionStatus.FAILED, { providerTransactionId: 'ext-a' });
    await reopen.reopenAfterTerminalAttempt(a);
    const reopened = (await order(o.orderId))!;
    expect(reopened).toMatchObject({ status: 'CREATED', grossAmount: 100000, izlDiscountAmount: 4000, payableAmount: 96000, izlRedemptionId: o.redemptionId });
    expect((await prisma.iZLRedemption.findUnique({ where: { id: o.redemptionId! } }))!.status).toBe('RESERVED');
    expect((await prisma.iZLReservation.findFirst({ where: { redemptionId: o.redemptionId } }))!.status).toBe('ACTIVE');
    expect((await prisma.iZLLedgerEntry.aggregate({ where: { userId }, _sum: { amount: true } }))._sum.amount).toBe(10);
  });

  it('§80/§55 existing 2.1D committed release works after reopen (order CREATED)', async () => {
    const userId = await seedUser();
    const o = await seedOrder(userId, { discount: 4000 });
    const a = await seedTx(o.orderId, PaymentTransactionStatus.FAILED, { providerTransactionId: 'ext-a' });
    await reopen.reopenAfterTerminalAttempt(a);
    await redemption.release(userId, o.redemptionId!); // 2.1D release — reused, not reimplemented
    const restored = (await order(o.orderId))!;
    expect(restored).toMatchObject({ izlDiscountAmount: 0, payableAmount: 100000, izlRedemptionId: null });
    expect((await prisma.iZLRedemption.findUnique({ where: { id: o.redemptionId! } }))!.status).toBe('RELEASED');
    expect((await prisma.iZLReservation.findFirst({ where: { redemptionId: o.redemptionId } }))!.status).toBe('RELEASED');
  });

  it('§81/§53/§18 expired order reopens (CREATED); a fresh initiate is then rejected by expiry', async () => {
    const userId = await seedUser();
    const o = await seedOrder(userId, { expiresAt: '2000-01-01T00:00:00Z' }); // long expired
    const a = await seedTx(o.orderId, PaymentTransactionStatus.FAILED, { providerTransactionId: 'ext-a' });
    expect((await reopen.reopenAfterTerminalAttempt(a)).outcome).toBe('REOPENED'); // expiry ignored by reopen
    expect((await order(o.orderId))!.status).toBe('CREATED');
    await expect(payments.initiate(userId, o.orderId, 'CLICK', 'k2')).rejects.toBeInstanceOf(PaymentOrderNotEligibleError); // existing expiry rule
  });

  it('§85/§37/§38 reopen writes only PaymentOrder.status (no PT/callback/subscription/IZL) — verified via counts', async () => {
    const userId = await seedUser();
    const o = await seedOrder(userId, { discount: 4000 });
    const a = await seedTx(o.orderId, PaymentTransactionStatus.FAILED, { providerTransactionId: 'ext-a' });
    const before = { tx: await prisma.paymentTransaction.count(), cb: await prisma.paymentCallbackEvent.count(), sub: await prisma.subscription.count(), ledger: await prisma.iZLLedgerEntry.count() };
    await reopen.reopenAfterTerminalAttempt(a);
    const after = { tx: await prisma.paymentTransaction.count(), cb: await prisma.paymentCallbackEvent.count(), sub: await prisma.subscription.count(), ledger: await prisma.iZLLedgerEntry.count() };
    expect(after).toEqual(before); // only PaymentOrder.status changed
  });
});
