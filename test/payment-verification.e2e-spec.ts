import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { PaymentOrderStatus, PaymentProvider, PaymentTransactionStatus } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { Clock } from '../src/common/clock';
import { SMS_PORT } from '../src/sms/sms.port';
import { PAYMENT_PROVIDER_PORT } from '../src/payments/provider/payment-provider.port';
import { PaymentCallbackService } from '../src/payments/payment-callback.service';
import { PaymentFinalizationService } from '../src/payments/payment-finalization.service';
import { PaymentsRepository } from '../src/payments/payments.repository';
import { PaymentCallbackVerificationError } from '../src/common/errors';
import { cleanupAuthTables } from './test-db.helper';
import { TestSmsAdapter } from './test-sms.adapter';
import { TestPaymentProviderAdapter } from './test-payment-provider.adapter';

describe('Verified payment evidence (e2e, izlan_test)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let service: PaymentCallbackService;
  let repo: PaymentsRepository;
  const providerAdapter = new TestPaymentProviderAdapter();
  const clock = { current: new Date('2026-08-20T06:00:00.000Z'), now() { return this.current; } };
  let n = 0;
  let so = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_PORT).useValue(new TestSmsAdapter())
      .overrideProvider(Clock).useValue(clock)
      .overrideProvider(PAYMENT_PROVIDER_PORT).useValue(providerAdapter)
      // Stub the Phase 2.1G finalization bridge — this suite tests the verification layer in isolation (order stays
      // PENDING). The real bridge (verified callback → PAID) is tested by payment-finalization.e2e (§99/§100).
      .overrideProvider(PaymentFinalizationService).useValue({ tryFinalizeAfterVerification: async () => undefined, finalizeVerifiedPayment: async () => { throw new Error('stub'); } })
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(PaymentCallbackService);
    repo = moduleRef.get(PaymentsRepository);
    await reset();
  });
  afterAll(async () => { await reset(); await app.close(); });
  beforeEach(async () => { await reset(); jest.restoreAllMocks(); });

  async function reset() {
    await prisma.paymentCallbackEvent.deleteMany();
    await prisma.paymentTransaction.deleteMany();
    await prisma.subscriptionCycle.deleteMany();
    await prisma.subscription.deleteMany();
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

  async function seedUser() {
    const u = await prisma.user.create({ data: { phone: `+99890${String(1000000 + n++).slice(-7)}` }, select: { id: true } });
    return u.id;
  }
  async function seedOrder(userId: string, opts: { gross: number; payable?: number; discount?: number; currency?: string; status?: PaymentOrderStatus; redemptionId?: string } = { gross: 96000 }) {
    const plan = await prisma.subscriptionPlan.create({ data: { code: `P-${uid()}`, name: 'Pro', sortOrder: so++ } });
    const price = await prisma.planPrice.create({ data: { planId: plan.id, amount: opts.gross, billingPeriodMonths: 1, effectiveFrom: new Date('2026-08-01T00:00:00Z'), createdBy: userId } });
    const discount = opts.discount ?? 0;
    const o = await prisma.paymentOrder.create({
      data: { userId, purpose: 'SUBSCRIPTION_PURCHASE', planId: plan.id, planPriceId: price.id, currency: opts.currency ?? 'UZS', grossAmount: opts.gross, izlDiscountAmount: discount, payableAmount: opts.payable ?? opts.gross - discount, status: opts.status ?? PaymentOrderStatus.PENDING, ...(opts.redemptionId ? { izlRedemptionId: opts.redemptionId } : {}) },
      select: { id: true },
    });
    return o.id;
  }
  async function seedTxn(orderId: string, opts: { provider?: PaymentProvider; amount: number; status?: PaymentTransactionStatus; providerTransactionId?: string | null } = { amount: 96000 }) {
    const t = await prisma.paymentTransaction.create({
      data: { paymentOrderId: orderId, provider: opts.provider ?? 'CLICK', amount: opts.amount, status: opts.status ?? PaymentTransactionStatus.PENDING, providerTransactionId: opts.providerTransactionId ?? null, clientRequestId: uid() },
      select: { id: true },
    });
    return t.id;
  }
  async function seedDiscounted(userId: string, gross: number, valueUzs: number, amountIzl: number) {
    const orderId = await seedOrder(userId, { gross, payable: gross - valueUzs, discount: valueUzs });
    const red = await prisma.iZLRedemption.create({ data: { userId, type: 'SUBSCRIPTION_DISCOUNT', amountIzl, izlRateSnapshot: 1000, valueUzs, paymentOrderId: orderId, policyVersionCode: 'subscription-discount-redemption-v1', status: 'RESERVED' }, select: { id: true } });
    await prisma.iZLReservation.create({ data: { userId, amountIzl, status: 'ACTIVE', idempotencyKey: `subscription-discount-redemption:${red.id}`, purposeCode: 'SUBSCRIPTION_DISCOUNT_REDEMPTION', redemptionId: red.id } });
    await prisma.paymentOrder.update({ where: { id: orderId }, data: { izlRedemptionId: red.id } });
    return { orderId, redemptionId: red.id };
  }

  interface Fixture { merchantTransactionId: string; providerTransactionId: string; amount: number; currency?: string; eventId?: string; status?: string; confirmedAt?: string; signatureValid?: boolean }
  const callback = (provider: PaymentProvider, f: Fixture) =>
    service.processProviderCallback(provider, { provider, payload: { eventId: f.eventId ?? `evt-${f.merchantTransactionId}`, currency: 'UZS', confirmedAt: '2026-08-20T07:00:00.000Z', ...f } });
  const txn = (id: string) => prisma.paymentTransaction.findUnique({ where: { id } });
  const order = (id: string) => prisma.paymentOrder.findUnique({ where: { id } });
  const events = () => prisma.paymentCallbackEvent.count();

  // ───────────────────────────────────────────────────────────────────────────

  it('§54/§56 verified success → PT SUCCEEDED + confirmedAt; order stays PENDING; no PAID/subscription/IZL', async () => {
    const userId = await seedUser();
    const orderId = await seedOrder(userId, { gross: 96000 });
    const txId = await seedTxn(orderId, { amount: 96000, providerTransactionId: 'ext-click-1' });
    const out = await callback('CLICK', { merchantTransactionId: txId, providerTransactionId: 'ext-click-1', amount: 96000 });
    expect(out.outcome).toBe('ACCEPTED');
    const t = await txn(txId);
    expect(t!.status).toBe('SUCCEEDED');
    expect(t!.confirmedAt?.toISOString()).toBe('2026-08-20T07:00:00.000Z'); // trusted provider confirmedAt (§20)
    expect((await order(orderId))!.status).toBe('PENDING'); // §31 — NOT PAID
    expect((await order(orderId))!.provider).toBeNull();
    expect(await events()).toBe(1);
    expect(await prisma.paymentCallbackEvent.count({ where: { result: 'ACCEPTED', paymentTransactionId: txId } })).toBe(1);
    expect(await prisma.subscription.count()).toBe(0);
    expect(await prisma.subscriptionCycle.count()).toBe(0);
    expect(await prisma.iZLLedgerEntry.count()).toBe(0);
    expect(await prisma.paymentOrder.count({ where: { status: 'PAID' } })).toBe(0);
  });

  it('§55 discounted success → redemption RESERVED + reservation ACTIVE + ledger unchanged; order PENDING', async () => {
    const userId = await seedUser();
    const { orderId, redemptionId } = await seedDiscounted(userId, 100000, 4000, 4); // payable 96000
    const txId = await seedTxn(orderId, { amount: 96000, provider: 'PAYME', providerTransactionId: 'ext-payme-1' });
    const out = await callback('PAYME', { merchantTransactionId: txId, providerTransactionId: 'ext-payme-1', amount: 96000 });
    expect(out.outcome).toBe('ACCEPTED');
    expect((await txn(txId))!.status).toBe('SUCCEEDED');
    expect((await order(orderId))!.status).toBe('PENDING');
    const red = await prisma.iZLRedemption.findUnique({ where: { id: redemptionId }, include: { reservation: true } });
    expect(red!.status).toBe('RESERVED'); // §33 — not APPLIED
    expect(red!.reservation!.status).toBe('ACTIVE'); // §33 — not CONSUMED
    expect(await prisma.iZLLedgerEntry.count({ where: { userId } })).toBe(0); // §35 — no debit
  });

  it('§63 external id attach: PT providerTransactionId NULL → attach + SUCCEEDED atomically', async () => {
    const userId = await seedUser();
    const orderId = await seedOrder(userId, { gross: 96000 });
    const txId = await seedTxn(orderId, { amount: 96000, providerTransactionId: null }); // ambiguous prior init
    await callback('CLICK', { merchantTransactionId: txId, providerTransactionId: 'ext-attached-9', amount: 96000 });
    const t = await txn(txId);
    expect(t!.status).toBe('SUCCEEDED');
    expect(t!.providerTransactionId).toBe('ext-attached-9');
  });

  it('§57 invalid verification (bad signature) → throws, zero writes, PT PENDING', async () => {
    const userId = await seedUser();
    const orderId = await seedOrder(userId, { gross: 96000 });
    const txId = await seedTxn(orderId, { amount: 96000, providerTransactionId: 'ext-1' });
    await expect(callback('CLICK', { merchantTransactionId: txId, providerTransactionId: 'ext-1', amount: 96000, signatureValid: false })).rejects.toBeInstanceOf(PaymentCallbackVerificationError);
    expect(await events()).toBe(0); // §57 — no callback event
    expect((await txn(txId))!.status).toBe('PENDING');
    expect((await order(orderId))!.status).toBe('PENDING');
  });

  it('§58/§59/§60/§62 business rejections (amount / order-corruption / currency / provider) → REJECTED, PT PENDING', async () => {
    const userId = await seedUser();
    // §58 amount mismatch
    const o1 = await seedOrder(userId, { gross: 96000 });
    const t1 = await seedTxn(o1, { amount: 96000, providerTransactionId: 'e1' });
    const r1 = await callback('CLICK', { merchantTransactionId: t1, providerTransactionId: 'e1', amount: 90000 });
    expect(r1).toMatchObject({ outcome: 'REJECTED', reason: 'AMOUNT_MISMATCH' });
    expect((await txn(t1))!.status).toBe('PENDING');
    // §59 order payable corruption (PT.amount === verified 96000, but order.payable = 90000)
    const o2 = await seedOrder(userId, { gross: 96000, discount: 6000 }); // payable = 90000 (valid chk_order_amounts)
    const t2 = await seedTxn(o2, { amount: 96000, providerTransactionId: 'e2' });
    expect((await callback('CLICK', { merchantTransactionId: t2, providerTransactionId: 'e2', amount: 96000 })).reason).toBe('ORDER_AMOUNT_MISMATCH');
    // §60 currency mismatch
    const o3 = await seedOrder(userId, { gross: 96000 });
    const t3 = await seedTxn(o3, { amount: 96000, providerTransactionId: 'e3' });
    expect((await callback('CLICK', { merchantTransactionId: t3, providerTransactionId: 'e3', amount: 96000, currency: 'USD' })).reason).toBe('CURRENCY_MISMATCH');
    // §62 provider mismatch (PT is CLICK, callback PAYME)
    const o4 = await seedOrder(userId, { gross: 96000 });
    const t4 = await seedTxn(o4, { provider: 'CLICK', amount: 96000, providerTransactionId: 'e4' });
    expect((await callback('PAYME', { merchantTransactionId: t4, providerTransactionId: 'e4', amount: 96000 })).reason).toBe('PROVIDER_MISMATCH');
    expect((await txn(t4))!.status).toBe('PENDING');
    expect(await prisma.paymentTransaction.count({ where: { status: 'SUCCEEDED' } })).toBe(0);
  });

  it('§61 wrong merchant transaction id → IDENTITY_MISMATCH (no unrelated PT transitions)', async () => {
    const userId = await seedUser();
    const orderId = await seedOrder(userId, { gross: 96000 });
    const txId = await seedTxn(orderId, { amount: 96000, providerTransactionId: 'ext-x' });
    const out = await callback('CLICK', { merchantTransactionId: '00000000-0000-7000-8000-000000000000', providerTransactionId: 'ext-y', amount: 96000 }); // well-formed UUID, resolves to no PT
    expect(out).toMatchObject({ outcome: 'REJECTED', reason: 'IDENTITY_MISMATCH', paymentTransactionId: null });
    expect((await txn(txId))!.status).toBe('PENDING');
  });

  it('§10 malformed (non-UUID) merchant id → verification rejection, zero writes', async () => {
    await expect(callback('CLICK', { merchantTransactionId: 'not-a-uuid', providerTransactionId: 'ext-z', amount: 96000 })).rejects.toBeInstanceOf(PaymentCallbackVerificationError);
    expect(await events()).toBe(0);
  });

  it('§64 external id conflict: PT already has a different provider id → EXTERNAL_ID_CONFLICT, no overwrite', async () => {
    const userId = await seedUser();
    const orderId = await seedOrder(userId, { gross: 96000 });
    const txId = await seedTxn(orderId, { amount: 96000, providerTransactionId: 'ext-A' });
    const out = await callback('CLICK', { merchantTransactionId: txId, providerTransactionId: 'ext-B', amount: 96000 });
    expect(out.reason).toBe('EXTERNAL_ID_CONFLICT');
    const t = await txn(txId);
    expect(t!.status).toBe('PENDING');
    expect(t!.providerTransactionId).toBe('ext-A'); // never overwritten
  });

  it('§65 exact event replay → one callback record, one transition, same state', async () => {
    const userId = await seedUser();
    const orderId = await seedOrder(userId, { gross: 96000 });
    const txId = await seedTxn(orderId, { amount: 96000, providerTransactionId: 'ext-1' });
    const f = { merchantTransactionId: txId, providerTransactionId: 'ext-1', amount: 96000, eventId: 'evt-fixed' };
    await callback('CLICK', f);
    await callback('CLICK', f); // exact replay
    expect(await events()).toBe(1);
    expect((await txn(txId))!.status).toBe('SUCCEEDED');
  });

  it('§66/§68 distinct success events for same PT → no-op DUPLICATE, confirmedAt immutable', async () => {
    const userId = await seedUser();
    const orderId = await seedOrder(userId, { gross: 96000 });
    const txId = await seedTxn(orderId, { amount: 96000, providerTransactionId: 'ext-1' });
    await callback('CLICK', { merchantTransactionId: txId, providerTransactionId: 'ext-1', amount: 96000, eventId: 'e-first', confirmedAt: '2026-08-20T07:00:00.000Z' });
    const out2 = await callback('CLICK', { merchantTransactionId: txId, providerTransactionId: 'ext-1', amount: 96000, eventId: 'e-second', confirmedAt: '2026-08-20T09:00:00.000Z' });
    expect(out2.outcome).toBe('DUPLICATE');
    expect(await events()).toBe(2); // both recorded (distinct event ids)
    const t = await txn(txId);
    expect(t!.status).toBe('SUCCEEDED');
    expect(t!.confirmedAt?.toISOString()).toBe('2026-08-20T07:00:00.000Z'); // §68 — first accepted wins
  });

  it('§30 different data after SUCCEEDED (distinct event) → SUCCESS_DATA_CONFLICT, history unchanged', async () => {
    const userId = await seedUser();
    const orderId = await seedOrder(userId, { gross: 96000 });
    const txId = await seedTxn(orderId, { amount: 96000, providerTransactionId: 'ext-1' });
    await callback('CLICK', { merchantTransactionId: txId, providerTransactionId: 'ext-1', amount: 96000, eventId: 'e1' });
    const out = await callback('CLICK', { merchantTransactionId: txId, providerTransactionId: 'ext-DIFFERENT', amount: 96000, eventId: 'e2' });
    expect(out.reason).toBe('SUCCESS_DATA_CONFLICT');
    expect((await txn(txId))!.providerTransactionId).toBe('ext-1'); // unchanged
  });

  it('§27/§67 second transaction success for an order that already has one → SUCCESS_CONFLICT; one SUCCEEDED only', async () => {
    const userId = await seedUser();
    const orderId = await seedOrder(userId, { gross: 96000 });
    const txA = await seedTxn(orderId, { amount: 96000, providerTransactionId: 'ext-A' });
    await callback('CLICK', { merchantTransactionId: txA, providerTransactionId: 'ext-A', amount: 96000, eventId: 'a' });
    // A now SUCCEEDED, order still PENDING; a second attempt B is seeded directly (one-PENDING allows it now)
    const txB = await seedTxn(orderId, { amount: 96000, providerTransactionId: 'ext-B' });
    const out = await callback('CLICK', { merchantTransactionId: txB, providerTransactionId: 'ext-B', amount: 96000, eventId: 'b' });
    expect(out.reason).toBe('SUCCESS_CONFLICT');
    expect((await txn(txB))!.status).toBe('PENDING');
    expect(await prisma.paymentTransaction.count({ where: { paymentOrderId: orderId, status: 'SUCCEEDED' } })).toBe(1);
    expect((await order(orderId))!.status).toBe('PENDING');
  });

  it('§25/§26/§51 PV-DB-01: DB rejects a second SUCCEEDED transaction for one order', async () => {
    const userId = await seedUser();
    const orderId = await seedOrder(userId, { gross: 96000 });
    const txA = await seedTxn(orderId, { amount: 96000, status: PaymentTransactionStatus.SUCCEEDED, providerTransactionId: 'ext-A' });
    const txB = await seedTxn(orderId, { amount: 96000, providerTransactionId: 'ext-B' });
    await expect(prisma.paymentTransaction.update({ where: { id: txB }, data: { status: PaymentTransactionStatus.SUCCEEDED } })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('§41 concurrent identical callbacks → exactly one transition + one record', async () => {
    const userId = await seedUser();
    const orderId = await seedOrder(userId, { gross: 96000 });
    const txId = await seedTxn(orderId, { amount: 96000, providerTransactionId: 'ext-1' });
    const f = { merchantTransactionId: txId, providerTransactionId: 'ext-1', amount: 96000, eventId: 'evt-conc' };
    const outs = await Promise.all([callback('CLICK', f), callback('CLICK', f)]);
    expect(outs.filter((o) => o.outcome === 'ACCEPTED' || o.outcome === 'DUPLICATE')).toHaveLength(2);
    expect(await events()).toBe(1);
    expect((await txn(txId))!.status).toBe('SUCCEEDED');
  });

  it('§39/§70 provider verification runs BEFORE the DB-processing transaction', async () => {
    const userId = await seedUser();
    const orderId = await seedOrder(userId, { gross: 96000 });
    const txId = await seedTxn(orderId, { amount: 96000, providerTransactionId: 'ext-1' });
    const seq: string[] = [];
    jest.spyOn(providerAdapter, 'verifyCallback').mockImplementation(async function (this: TestPaymentProviderAdapter, i) {
      seq.push('verify');
      return TestPaymentProviderAdapter.prototype.verifyCallback.call(this, i);
    });
    const realRecord = PaymentsRepository.prototype.recordVerifiedCallback;
    jest.spyOn(repo, 'recordVerifiedCallback').mockImplementation(function (this: PaymentsRepository, v, now) {
      seq.push('record');
      return realRecord.call(this, v, now);
    });
    await callback('CLICK', { merchantTransactionId: txId, providerTransactionId: 'ext-1', amount: 96000 });
    expect(seq).toEqual(['verify', 'record']); // verification precedes the DB transaction (§39/§70)
  });
});
