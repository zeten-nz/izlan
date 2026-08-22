import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { PaymentOrderPurpose, PaymentOrderStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AuthorizationRepository } from '../src/authorization/authorization.repository';
import { AuthExceptionFilter } from '../src/auth/http/auth-exception.filter';
import { SMS_PORT } from '../src/sms/sms.port';
import { Clock } from '../src/common/clock';
import { PAYMENT_PROVIDER_PORT } from '../src/payments/provider/payment-provider.port';
import { bootstrapSystemRoles } from '../src/bootstrap/system-roles';
import { cleanupAuthTables } from './test-db.helper';
import { TestSmsAdapter } from './test-sms.adapter';
import { TestPaymentProviderAdapter } from './test-payment-provider.adapter';

describe('Payment execution foundation (e2e, izlan_test)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  const sms = new TestSmsAdapter();
  const providerAdapter = new TestPaymentProviderAdapter();
  const clock = { current: new Date('2026-08-20T06:00:00.000Z'), now() { return this.current; } };
  let n = 0;
  let so = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_PORT).useValue(sms)
      .overrideProvider(Clock).useValue(clock)
      .overrideProvider(PAYMENT_PROVIDER_PORT).useValue(providerAdapter)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AuthExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = moduleRef.get(PrismaService);
    await reset();
    await prisma.role.deleteMany();
    await bootstrapSystemRoles(moduleRef.get(AuthorizationRepository));
  });
  afterAll(async () => { await reset(); await app.close(); });
  beforeEach(async () => { await reset(); sms.clear(); providerAdapter.failMode = false; clock.current = new Date('2026-08-20T06:00:00.000Z'); });

  async function reset() {
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
  const server = () => app.getHttpServer();
  const uid = () => `${Date.now()}-${n++}`;

  async function makeLearner(phone: string) {
    await prisma.otpChallenge.updateMany({ where: { phone }, data: { createdAt: new Date(Date.now() - 300_000) } });
    const req = await request(server()).post('/api/auth/otp/request').send({ phone });
    const verify = await request(server()).post('/api/auth/register').send({ challengeId: req.body.challengeId, code: sms.latestCode(), password: 'Passw0rd!123' });
    const user = await prisma.user.findUnique({ where: { phone } });
    return { token: verify.body.accessToken, userId: user!.id };
  }
  async function seedOrder(userId: string, gross: number, o: { status?: PaymentOrderStatus; purpose?: PaymentOrderPurpose; expiresAt?: string; discount?: number } = {}) {
    const plan = await prisma.subscriptionPlan.create({ data: { code: `P-${uid()}`, name: 'Pro', sortOrder: so++ } });
    const price = await prisma.planPrice.create({ data: { planId: plan.id, amount: gross, billingPeriodMonths: 1, effectiveFrom: new Date('2026-08-01T00:00:00Z'), createdBy: userId } });
    const discount = o.discount ?? 0;
    const order = await prisma.paymentOrder.create({ data: { userId, purpose: o.purpose ?? PaymentOrderPurpose.SUBSCRIPTION_PURCHASE, planId: plan.id, planPriceId: price.id, currency: 'UZS', grossAmount: gross, izlDiscountAmount: discount, payableAmount: gross - discount, status: o.status ?? PaymentOrderStatus.CREATED, ...(o.expiresAt ? { expiresAt: new Date(o.expiresAt) } : {}) }, select: { id: true } });
    return order.id;
  }
  // discounted order committed to a RESERVED redemption + ACTIVE hold (as after Phase 2.1D commit)
  async function seedDiscounted(userId: string, gross: number, valueUzs: number, amountIzl: number) {
    const orderId = await seedOrder(userId, gross, { discount: valueUzs });
    const red = await prisma.iZLRedemption.create({ data: { userId, type: 'SUBSCRIPTION_DISCOUNT', amountIzl, izlRateSnapshot: 1000, valueUzs, paymentOrderId: orderId, policyVersionCode: 'subscription-discount-redemption-v1', status: 'RESERVED' }, select: { id: true } });
    await prisma.iZLReservation.create({ data: { userId, amountIzl, status: 'ACTIVE', idempotencyKey: `subscription-discount-redemption:${red.id}`, purposeCode: 'SUBSCRIPTION_DISCOUNT_REDEMPTION', redemptionId: red.id } });
    await prisma.paymentOrder.update({ where: { id: orderId }, data: { izlRedemptionId: red.id } });
    return { orderId, redemptionId: red.id };
  }
  const initiate = (token: string, orderId: string, provider: 'CLICK' | 'PAYME', clientRequestId = randomUUID()) =>
    request(server()).post(`/api/payments/orders/${orderId}/initiate`).set('Authorization', `Bearer ${token}`).send({ provider, clientRequestId });
  const order = (id: string) => prisma.paymentOrder.findUnique({ where: { id } });
  const txns = (orderId: string) => prisma.paymentTransaction.findMany({ where: { paymentOrderId: orderId } });

  // ───────────────────────────────────────────────────────────────────────────

  it('§63/§66 initiate → order PENDING + PENDING attempt (amount=payable, provider attached); no PAID/callback/subscription/IZL', async () => {
    const { token, userId } = await makeLearner('+998900013001');
    const orderId = await seedOrder(userId, 96000);
    const res = await initiate(token, orderId, 'CLICK');
    expect(res.status).toBe(201);
    expect(res.body.paymentOrder).toMatchObject({ id: orderId, status: 'PENDING', payableAmount: 96000, currency: 'UZS' });
    expect(res.body.paymentTransaction).toMatchObject({ provider: 'CLICK', status: 'PENDING' });
    expect(res.body.checkoutUrl).toContain('checkout');
    const t = (await txns(orderId))[0];
    expect(t).toMatchObject({ provider: 'CLICK', status: 'PENDING', amount: 96000 });
    expect(t.providerTransactionId).toBe(`test-CLICK-${t.id}`);
    expect(await order(orderId).then((o) => o!.status)).toBe('PENDING');
    expect(await order(orderId).then((o) => o!.provider)).toBeNull(); // §32 PaymentOrder.provider not written
    expect(await prisma.paymentCallbackEvent.count()).toBe(0);
    expect(await prisma.paymentTransaction.count({ where: { status: 'SUCCEEDED' } })).toBe(0);
    expect(await prisma.paymentOrder.count({ where: { status: 'PAID' } })).toBe(0);
    expect(await prisma.subscription.count()).toBe(0);
    expect(await prisma.iZLLedgerEntry.count()).toBe(0);
  });

  it('§64 discounted order: charge = payableAmount; RESERVED redemption + ACTIVE hold unchanged; ledger unchanged', async () => {
    const { token, userId } = await makeLearner('+998900013002');
    const { orderId, redemptionId } = await seedDiscounted(userId, 100000, 4000, 4); // payable 96000
    const res = await initiate(token, orderId, 'PAYME');
    expect(res.body.paymentTransaction).toMatchObject({ provider: 'PAYME', status: 'PENDING' });
    expect((await txns(orderId))[0].amount).toBe(96000); // §66 payable, not gross 100000
    expect((await prisma.iZLRedemption.findUnique({ where: { id: redemptionId }, include: { reservation: true } }))!).toMatchObject({ status: 'RESERVED', reservation: { status: 'ACTIVE' } });
    expect(await prisma.iZLLedgerEntry.count({ where: { userId } })).toBe(0);
  });

  it('§67 idempotent replay → one attempt, same provider transaction id', async () => {
    const { token, userId } = await makeLearner('+998900013003');
    const orderId = await seedOrder(userId, 96000);
    const rid = randomUUID();
    const a = await initiate(token, orderId, 'CLICK', rid);
    const b = await initiate(token, orderId, 'CLICK', rid);
    expect(b.body.paymentTransaction.id).toBe(a.body.paymentTransaction.id);
    expect(await prisma.paymentTransaction.count({ where: { paymentOrderId: orderId } })).toBe(1);
  });

  it('§68/§53 same key with a different provider → conflict', async () => {
    const { token, userId } = await makeLearner('+998900013004');
    const orderId = await seedOrder(userId, 96000);
    const rid = randomUUID();
    await initiate(token, orderId, 'CLICK', rid);
    const conflict = await initiate(token, orderId, 'PAYME', rid);
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('PAYMENT_ATTEMPT_REQUEST_CONFLICT');
  });

  it('§54/§69 one in-flight attempt: a new key against a PENDING order is rejected', async () => {
    const { token, userId } = await makeLearner('+998900013005');
    const orderId = await seedOrder(userId, 96000);
    await initiate(token, orderId, 'CLICK');
    const second = await initiate(token, orderId, 'PAYME'); // new key, order now PENDING
    expect(second.status).toBe(409);
    expect(await prisma.paymentTransaction.count({ where: { paymentOrderId: orderId, status: 'PENDING' } })).toBe(1);
  });

  it('§50/§52 concurrent initiations (same + different provider) → exactly one PENDING attempt', async () => {
    const same = await makeLearner('+998900013006');
    const o1 = await seedOrder(same.userId, 96000);
    const rid = randomUUID();
    const [a, b] = await Promise.all([initiate(same.token, o1, 'CLICK', rid), initiate(same.token, o1, 'CLICK', rid)]);
    expect(a.body.paymentTransaction.id).toBe(b.body.paymentTransaction.id);
    expect(await prisma.paymentTransaction.count({ where: { paymentOrderId: o1 } })).toBe(1);

    const diff = await makeLearner('+998900013007');
    const o2 = await seedOrder(diff.userId, 96000);
    const results = await Promise.allSettled([initiate(diff.token, o2, 'CLICK'), initiate(diff.token, o2, 'PAYME')]);
    const oks = results.filter((r) => r.status === 'fulfilled' && (r.value as { status: number }).status === 201);
    expect(oks.length).toBeGreaterThanOrEqual(1);
    expect(await prisma.paymentTransaction.count({ where: { paymentOrderId: o2, status: 'PENDING' } })).toBe(1);
  });

  it('§72/§30/§73 ambiguous provider init leaves PENDING (no id); retry attaches the id, same attempt', async () => {
    const { token, userId } = await makeLearner('+998900013008');
    const orderId = await seedOrder(userId, 96000);
    const rid = randomUUID();
    providerAdapter.failMode = true;
    const fail = await initiate(token, orderId, 'CLICK', rid);
    expect(fail.status).toBe(201);
    expect(fail.body.checkoutUrl).toBeUndefined();
    const t1 = (await txns(orderId))[0];
    expect(t1).toMatchObject({ status: 'PENDING' });
    expect(t1.providerTransactionId).toBeNull(); // §30 no id attached
    expect(await order(orderId).then((o) => o!.status)).toBe('PENDING'); // order still PENDING

    providerAdapter.failMode = false;
    const retry = await initiate(token, orderId, 'CLICK', rid); // §73 same key/attempt
    expect(retry.body.paymentTransaction.id).toBe(t1.id);
    expect((await txns(orderId))).toHaveLength(1);
    expect((await txns(orderId))[0].providerTransactionId).toBe(`test-CLICK-${t1.id}`); // now attached
  });

  it('§75/§76 ineligible orders (expired / already PENDING / PAID) → 409, no new attempt', async () => {
    const { token, userId } = await makeLearner('+998900013009');
    const expired = await seedOrder(userId, 96000, { expiresAt: '2000-01-01T00:00:00Z' });
    expect((await initiate(token, expired, 'CLICK')).status).toBe(409);
    const paid = await seedOrder(userId, 96000, { status: PaymentOrderStatus.PAID });
    expect((await initiate(token, paid, 'CLICK')).status).toBe(409);
    const pending = await seedOrder(userId, 96000, { status: PaymentOrderStatus.PENDING });
    expect((await initiate(token, pending, 'CLICK')).status).toBe(409);
    expect(await prisma.paymentTransaction.count({ where: { paymentOrder: { userId } } })).toBe(0);
  });

  it('§77 zero payable → no provider attempt', async () => {
    const { token, userId } = await makeLearner('+998900013010');
    const orderId = await seedOrder(userId, 100000, { discount: 100000 }); // payable 0
    const res = await initiate(token, orderId, 'CLICK');
    expect(res.status).toBe(409);
    expect(await prisma.paymentTransaction.count({ where: { paymentOrderId: orderId } })).toBe(0);
    expect(await order(orderId).then((o) => o!.status)).toBe('CREATED'); // unchanged
  });

  it('§78/§79 security: foreign order 404, 401, client cannot inject economic fields', async () => {
    const a = await makeLearner('+998900013011');
    const orderId = await seedOrder(a.userId, 96000);
    const b = await makeLearner('+998900013012');
    expect((await initiate(b.token, orderId, 'CLICK')).status).toBe(404);
    expect((await request(server()).post(`/api/payments/orders/${orderId}/initiate`).send({ provider: 'CLICK', clientRequestId: randomUUID() })).status).toBe(401);
    const inject = await request(server()).post(`/api/payments/orders/${orderId}/initiate`).set('Authorization', `Bearer ${a.token}`).send({ provider: 'CLICK', clientRequestId: randomUUID(), amount: 1, status: 'SUCCEEDED', providerTransactionId: 'x' });
    expect(inject.status).toBe(400);
  });
});
