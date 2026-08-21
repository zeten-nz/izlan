import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { PaymentOrderStatus, PaymentProvider, PaymentTransactionStatus } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { SMS_PORT } from '../src/sms/sms.port';
import { PAYMENT_PROVIDER_PORT } from '../src/payments/provider/payment-provider.port';
import { PaymentCallbackService } from '../src/payments/payment-callback.service';
import { PaymentFinalizationService } from '../src/payments/payment-finalization.service';
import { PaymentOrderReopenService } from '../src/payments/payment-order-reopen.service';
import { PaymentFinalizationRecoveryService } from '../src/payments/payment-finalization-recovery.service';
import { PaymentsService } from '../src/payments/payments.service';
import { PaymentCallbackVerificationError, PaymentOrderNotEligibleError } from '../src/common/errors';
import { cleanupAuthTables } from './test-db.helper';
import { TestSmsAdapter } from './test-sms.adapter';
import { TestPaymentProviderAdapter } from './test-payment-provider.adapter';

describe('Verified non-success payment evidence (e2e, izlan_test)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let service: PaymentCallbackService;
  let recovery: PaymentFinalizationRecoveryService;
  let payments: PaymentsService;
  const providerAdapter = new TestPaymentProviderAdapter();
  let n = 0;
  let so = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_PORT).useValue(new TestSmsAdapter())
      .overrideProvider(PAYMENT_PROVIDER_PORT).useValue(providerAdapter)
      // Stub the 2.1G finalization + 2.1J reopen bridges — this suite tests provider evidence only (order stays PENDING).
      .overrideProvider(PaymentFinalizationService).useValue({ tryFinalizeAfterVerification: async () => undefined, finalizeVerifiedPayment: async () => { throw new Error('stub'); } })
      .overrideProvider(PaymentOrderReopenService).useValue({ tryReopenAfterTerminal: async () => undefined, reopenAfterTerminalAttempt: async () => { throw new Error('stub'); } })
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(PaymentCallbackService);
    recovery = moduleRef.get(PaymentFinalizationRecoveryService);
    payments = moduleRef.get(PaymentsService);
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
  const seedUser = () => prisma.user.create({ data: { phone: `+99890${String(4000000 + n++).slice(-7)}` }, select: { id: true } }).then((u) => u.id);

  async function seedTxn(userId: string, opts: { discount?: number; txStatus?: PaymentTransactionStatus; providerTransactionId?: string | null } = {}) {
    const discount = opts.discount ?? 0;
    const plan = await prisma.subscriptionPlan.create({ data: { code: `P-${uid()}`, name: 'Pro', sortOrder: so++ }, select: { id: true } });
    const price = await prisma.planPrice.create({ data: { planId: plan.id, amount: 100000, billingPeriodMonths: 1, effectiveFrom: new Date('2026-08-01T00:00:00Z'), createdBy: userId }, select: { id: true } });
    let izlRedemptionId: string | null = null;
    if (discount > 0) {
      const red = await prisma.iZLRedemption.create({ data: { userId, type: 'SUBSCRIPTION_DISCOUNT', amountIzl: discount / 1000, izlRateSnapshot: 1000, valueUzs: discount, policyVersionCode: 'subscription-discount-redemption-v1', status: 'RESERVED' }, select: { id: true } });
      await prisma.iZLReservation.create({ data: { userId, amountIzl: discount / 1000, status: 'ACTIVE', idempotencyKey: `subscription-discount-redemption:${red.id}`, purposeCode: 'SUBSCRIPTION_DISCOUNT_REDEMPTION', redemptionId: red.id } });
      izlRedemptionId = red.id;
    }
    const order = await prisma.paymentOrder.create({ data: { userId, purpose: 'SUBSCRIPTION_PURCHASE', planId: plan.id, planPriceId: price.id, currency: 'UZS', grossAmount: 100000, izlDiscountAmount: discount, payableAmount: 100000 - discount, status: PaymentOrderStatus.PENDING, izlRedemptionId }, select: { id: true } });
    if (izlRedemptionId) await prisma.iZLRedemption.update({ where: { id: izlRedemptionId }, data: { paymentOrderId: order.id } });
    const status = opts.txStatus ?? PaymentTransactionStatus.PENDING;
    const tx = await prisma.paymentTransaction.create({ data: { paymentOrderId: order.id, provider: 'CLICK', amount: 100000 - discount, status, providerTransactionId: opts.providerTransactionId === undefined ? (status === 'PENDING' ? null : `ext-${uid()}`) : opts.providerTransactionId, confirmedAt: status === 'SUCCEEDED' ? new Date('2026-08-20T07:00:00Z') : null, clientRequestId: uid() }, select: { id: true } });
    return { orderId: order.id, txId: tx.id, redemptionId: izlRedemptionId };
  }
  interface Payload { merchantTransactionId: string; status?: string; providerTransactionId?: string; amount?: number; currency?: string; terminal?: boolean; reasonCode?: string; eventId?: string; signatureValid?: boolean }
  const cb = (provider: PaymentProvider, p: Payload) => service.processProviderCallback(provider, { provider, payload: { eventId: p.eventId ?? `evt-${p.merchantTransactionId}-${n++}`, ...p } });
  const txn = (id: string) => prisma.paymentTransaction.findUnique({ where: { id } });
  const order = (id: string) => prisma.paymentOrder.findUnique({ where: { id } });
  const events = () => prisma.paymentCallbackEvent.count();

  // ───────────────────────────────────────────────────────────────────────────

  it('§40 basic FAILED → PT PENDING→FAILED, order PENDING, ACCEPTED_FAILED evidence; no confirmedAt', async () => {
    const userId = await seedUser();
    const s = await seedTxn(userId);
    const out = await cb('CLICK', { merchantTransactionId: s.txId, status: 'FAILED', providerTransactionId: 'ext-f1', amount: 100000, currency: 'UZS' });
    expect(out).toMatchObject({ outcome: 'ACCEPTED', transactionStatus: 'FAILED' });
    const t = await txn(s.txId);
    expect(t!.status).toBe('FAILED');
    expect(t!.confirmedAt).toBeNull(); // §25 — success-only timestamp
    expect(t!.providerTransactionId).toBe('ext-f1'); // attached
    expect((await order(s.orderId))!.status).toBe('PENDING'); // §27
    expect(await prisma.paymentCallbackEvent.count({ where: { result: 'ACCEPTED_FAILED', paymentTransactionId: s.txId } })).toBe(1);
  });

  it('§41 basic CANCELLED → PT PENDING→CANCELLED, order PENDING', async () => {
    const userId = await seedUser();
    const s = await seedTxn(userId, { providerTransactionId: 'ext-c1' });
    const out = await cb('CLICK', { merchantTransactionId: s.txId, status: 'CANCELLED', providerTransactionId: 'ext-c1' });
    expect(out).toMatchObject({ outcome: 'ACCEPTED', transactionStatus: 'CANCELLED' });
    expect((await txn(s.txId))!.status).toBe('CANCELLED');
    expect((await order(s.orderId))!.status).toBe('PENDING');
  });

  it('§42 provider expiry → FAILED with a canonical PROVIDER_EXPIRED classification in the callback result', async () => {
    const userId = await seedUser();
    const s = await seedTxn(userId, { providerTransactionId: 'ext-e1' });
    await cb('CLICK', { merchantTransactionId: s.txId, status: 'FAILED', providerTransactionId: 'ext-e1', reasonCode: 'PROVIDER_EXPIRED' });
    expect((await txn(s.txId))!.status).toBe('FAILED');
    const ev = await prisma.paymentCallbackEvent.findFirst({ where: { paymentTransactionId: s.txId } });
    expect(ev!.result).toContain('PROVIDER_EXPIRED');
  });

  it('§43 ambiguous / non-terminal non-success → verification rejection, zero writes, PT PENDING', async () => {
    const userId = await seedUser();
    const s = await seedTxn(userId, { providerTransactionId: 'ext-a1' });
    await expect(cb('CLICK', { merchantTransactionId: s.txId, status: 'FAILED', terminal: false, providerTransactionId: 'ext-a1' })).rejects.toBeInstanceOf(PaymentCallbackVerificationError);
    expect(await events()).toBe(0);
    expect((await txn(s.txId))!.status).toBe('PENDING');
  });

  it('§44 invalid verification (bad signature) → throws, zero writes (2.1F regression)', async () => {
    const userId = await seedUser();
    const s = await seedTxn(userId, { providerTransactionId: 'ext-i1' });
    await expect(cb('CLICK', { merchantTransactionId: s.txId, status: 'FAILED', providerTransactionId: 'ext-i1', signatureValid: false })).rejects.toBeInstanceOf(PaymentCallbackVerificationError);
    expect(await events()).toBe(0);
    expect((await txn(s.txId))!.status).toBe('PENDING');
  });

  it('§45/§46 duplicate + distinct-matching failure callbacks → one transition, terminal no-op', async () => {
    const userId = await seedUser();
    const s = await seedTxn(userId, { providerTransactionId: 'ext-d1' });
    const f = { merchantTransactionId: s.txId, status: 'FAILED' as const, providerTransactionId: 'ext-d1', eventId: 'evt-dup' };
    await cb('CLICK', f);
    await cb('CLICK', f); // §45 exact replay
    const distinct = await cb('CLICK', { merchantTransactionId: s.txId, status: 'FAILED', providerTransactionId: 'ext-d1', eventId: 'evt-distinct' }); // §46
    expect(distinct.outcome).toBe('DUPLICATE');
    expect((await txn(s.txId))!.status).toBe('FAILED');
    expect(await prisma.paymentCallbackEvent.count({ where: { paymentTransactionId: s.txId } })).toBe(2); // dup replay writes nothing new; distinct writes a no-op record
  });

  it('§47/§48/§19 late SUCCESS after FAILED / CANCELLED → PT unchanged, TERMINAL_STATUS_CONFLICT, order PENDING', async () => {
    const userId = await seedUser();
    const f = await seedTxn(userId, { txStatus: PaymentTransactionStatus.FAILED, providerTransactionId: 'ext-lf' });
    const outF = await cb('CLICK', { merchantTransactionId: f.txId, status: 'SUCCEEDED', providerTransactionId: 'ext-lf', amount: 100000, currency: 'UZS' });
    expect(outF).toMatchObject({ outcome: 'REJECTED', reason: 'TERMINAL_STATUS_CONFLICT' });
    expect((await txn(f.txId))!.status).toBe('FAILED'); // unchanged
    expect((await order(f.orderId))!.status).toBe('PENDING');
    expect(await prisma.subscription.count()).toBe(0);

    const c = await seedTxn(userId, { txStatus: PaymentTransactionStatus.CANCELLED, providerTransactionId: 'ext-lc' });
    const outC = await cb('CLICK', { merchantTransactionId: c.txId, status: 'SUCCEEDED', providerTransactionId: 'ext-lc', amount: 100000, currency: 'UZS' });
    expect(outC.reason).toBe('TERMINAL_STATUS_CONFLICT');
    expect((await txn(c.txId))!.status).toBe('CANCELLED');
  });

  it('§49/§22 late FAILURE after SUCCEEDED → PT stays SUCCEEDED, conflict evidence, no undo', async () => {
    const userId = await seedUser();
    const s = await seedTxn(userId, { txStatus: PaymentTransactionStatus.SUCCEEDED, providerTransactionId: 'ext-s1' });
    const out = await cb('CLICK', { merchantTransactionId: s.txId, status: 'FAILED', providerTransactionId: 'ext-s1' });
    expect(out).toMatchObject({ outcome: 'REJECTED', reason: 'TERMINAL_STATUS_CONFLICT' });
    expect((await txn(s.txId))!.status).toBe('SUCCEEDED');
  });

  it('§50/§23 concurrent success + failure for one PENDING PT → exactly one terminal accepted, no double transition', async () => {
    const userId = await seedUser();
    const s = await seedTxn(userId, { providerTransactionId: 'ext-r1' });
    const results = await Promise.allSettled([
      cb('CLICK', { merchantTransactionId: s.txId, status: 'SUCCEEDED', providerTransactionId: 'ext-r1', amount: 100000, currency: 'UZS', eventId: 'evt-s' }),
      cb('CLICK', { merchantTransactionId: s.txId, status: 'FAILED', providerTransactionId: 'ext-r1', eventId: 'evt-f' }),
    ]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const t = await txn(s.txId);
    expect(['SUCCEEDED', 'FAILED']).toContain(t!.status); // exactly one terminal accepted first
    const accepted = (results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ outcome: string }>[]).filter((r) => r.value.outcome === 'ACCEPTED');
    expect(accepted).toHaveLength(1); // the other became conflict evidence
  });

  it('§28/§51 discounted FAILED leaves redemption RESERVED + reservation ACTIVE + ledger unchanged', async () => {
    const userId = await seedUser();
    await prisma.iZLLedgerEntry.create({ data: { userId, entryNo: 1, entryType: 'EARN', amount: 10, balanceAfter: 10 } });
    const s = await seedTxn(userId, { discount: 4000, providerTransactionId: 'ext-dx' });
    await cb('CLICK', { merchantTransactionId: s.txId, status: 'FAILED', providerTransactionId: 'ext-dx' });
    expect((await txn(s.txId))!.status).toBe('FAILED');
    expect((await prisma.iZLRedemption.findUnique({ where: { id: s.redemptionId! } }))!.status).toBe('RESERVED');
    expect((await prisma.iZLReservation.findFirst({ where: { redemptionId: s.redemptionId } }))!.status).toBe('ACTIVE');
    expect((await prisma.iZLLedgerEntry.aggregate({ where: { userId }, _sum: { amount: true } }))._sum.amount).toBe(10); // unchanged
    expect((await order(s.orderId))!.izlDiscountAmount).toBe(4000); // pricing unchanged
  });

  it('§52 a FAILED/CANCELLED PT never enters the 2.1H finalization backlog', async () => {
    const userId = await seedUser();
    await seedTxn(userId, { txStatus: PaymentTransactionStatus.FAILED });
    await seedTxn(userId, { txStatus: PaymentTransactionStatus.CANCELLED });
    const backlog = await recovery.listBacklog(50);
    expect(backlog.total).toBe(0);
    expect(backlog.items).toHaveLength(0);
  });

  it('§53/§29 no order reopen: after FAILED the order stays PENDING and a fresh initiate still rejects (not CREATED)', async () => {
    const userId = await seedUser();
    const s = await seedTxn(userId, { providerTransactionId: 'ext-nr' });
    await cb('CLICK', { merchantTransactionId: s.txId, status: 'FAILED', providerTransactionId: 'ext-nr' });
    expect((await order(s.orderId))!.status).toBe('PENDING'); // NOT reopened (§29 — 2.1J owns this)
    await expect(payments.initiate(userId, s.orderId, 'CLICK', 'retry-key')).rejects.toBeInstanceOf(PaymentOrderNotEligibleError);
  });

  it('§54/§20 non-success verification uses the adapter only — never calls initiate', async () => {
    const userId = await seedUser();
    const s = await seedTxn(userId, { providerTransactionId: 'ext-np' });
    const initSpy = jest.spyOn(providerAdapter, 'initiate');
    await cb('CLICK', { merchantTransactionId: s.txId, status: 'FAILED', providerTransactionId: 'ext-np' });
    expect(initSpy).not.toHaveBeenCalled();
  });
});
