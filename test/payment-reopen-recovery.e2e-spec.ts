import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { PaymentOrderStatus, PaymentProvider, PaymentTransactionStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AuthorizationRepository } from '../src/authorization/authorization.repository';
import { AuthExceptionFilter } from '../src/auth/http/auth-exception.filter';
import { SMS_PORT } from '../src/sms/sms.port';
import { PAYMENT_PROVIDER_PORT } from '../src/payments/provider/payment-provider.port';
import { PaymentReopenRecoveryService } from '../src/payments/payment-reopen-recovery.service';
import { PaymentOrderReopenService } from '../src/payments/payment-order-reopen.service';
import { PaymentOrderReopenRepository } from '../src/payments/payment-order-reopen.repository';
import { PaymentsService } from '../src/payments/payments.service';
import { PAYMENT_REOPEN_READ, PAYMENT_REOPEN_RECONCILE } from '../src/payments/reopen-recovery.constants';
import { PaymentOrderNotEligibleError } from '../src/common/errors';
import { bootstrapSystemRoles } from '../src/bootstrap/system-roles';
import { cleanupAuthTables } from './test-db.helper';
import { TestSmsAdapter } from './test-sms.adapter';
import { TestPaymentProviderAdapter } from './test-payment-provider.adapter';

describe('Terminal payment reopen recovery (e2e, izlan_test)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let recovery: PaymentReopenRecoveryService;
  let reopen: PaymentOrderReopenService;
  let reopenRepo: PaymentOrderReopenRepository;
  let payments: PaymentsService;
  let authz: AuthorizationRepository;
  const sms = new TestSmsAdapter();
  const providerAdapter = new TestPaymentProviderAdapter();
  let n = 0;
  let so = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_PORT).useValue(sms)
      .overrideProvider(PAYMENT_PROVIDER_PORT).useValue(providerAdapter)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AuthExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = moduleRef.get(PrismaService);
    recovery = moduleRef.get(PaymentReopenRecoveryService);
    reopen = moduleRef.get(PaymentOrderReopenService);
    reopenRepo = moduleRef.get(PaymentOrderReopenRepository);
    payments = moduleRef.get(PaymentsService);
    authz = moduleRef.get(AuthorizationRepository);
    await reset();
    await bootstrapSystemRoles(authz);
  });
  afterAll(async () => { await reset(); await app.close(); });
  beforeEach(async () => { await reset(); await bootstrapSystemRoles(authz); sms.clear(); jest.restoreAllMocks(); });

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
  const server = () => app.getHttpServer();
  const uid = () => `${Date.now()}-${n++}`;

  async function makeLearner(phone: string) {
    await prisma.otpChallenge.updateMany({ where: { phone }, data: { createdAt: new Date(Date.now() - 300_000) } });
    const req = await request(server()).post('/api/auth/otp/request').send({ phone });
    const verify = await request(server()).post('/api/auth/otp/verify').send({ challengeId: req.body.challengeId, code: sms.latestCode() });
    const user = await prisma.user.findUnique({ where: { phone } });
    return { token: verify.body.accessToken, userId: user!.id };
  }
  async function makeAdmin(phone: string) {
    const learner = await makeLearner(phone);
    const admin = await prisma.role.findUnique({ where: { code: 'ADMIN' } });
    await prisma.rolePermission.createMany({ data: [{ roleId: admin!.id, permissionCode: PAYMENT_REOPEN_READ }, { roleId: admin!.id, permissionCode: PAYMENT_REOPEN_RECONCILE }], skipDuplicates: true });
    await prisma.userRole.create({ data: { userId: learner.userId, roleId: admin!.id, grantedBy: null } });
    return learner;
  }

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
  const seedTx = (orderId: string, status: PaymentTransactionStatus, providerTransactionId?: string) =>
    prisma.paymentTransaction.create({ data: { paymentOrderId: orderId, provider: 'CLICK', amount: 100000, status, providerTransactionId: providerTransactionId ?? (status === 'PENDING' ? null : `ext-${uid()}`), confirmedAt: status === 'SUCCEEDED' ? new Date('2026-08-20T07:00:00Z') : null, clientRequestId: uid() }, select: { id: true } }).then((t) => t.id);
  const order = (id: string) => prisma.paymentOrder.findUnique({ where: { id } });
  const backlogGet = (token: string) => request(server()).get('/api/admin/payments/reopen-backlog').set('Authorization', `Bearer ${token}`);
  const reconcilePost = (token: string, body: object = {}) => request(server()).post('/api/admin/payments/reopen-reconcile').set('Authorization', `Bearer ${token}`).send(body);

  // ───────────────────────────────────────────────────────────────────────────

  it('§45 backlog returns only actionable stuck orders (terminal PT + PENDING order, no live/success); learner/unauth denied', async () => {
    const admin = await makeAdmin('+998900015001');
    const oa = await seedOrder(admin.userId); const a = await seedTx(oa.orderId, PaymentTransactionStatus.FAILED, 'ext-a'); // actionable
    const ob = await seedOrder(admin.userId); await seedTx(ob.orderId, PaymentTransactionStatus.CANCELLED, 'ext-b'); // actionable
    const oc = await seedOrder(admin.userId); await seedTx(oc.orderId, PaymentTransactionStatus.PENDING); // has live PENDING → excluded
    const od = await seedOrder(admin.userId); await seedTx(od.orderId, PaymentTransactionStatus.FAILED, 'ext-d1'); await seedTx(od.orderId, PaymentTransactionStatus.SUCCEEDED, 'ext-d2'); // SUCCEEDED → excluded
    const oe = await seedOrder(admin.userId, { orderStatus: PaymentOrderStatus.CREATED }); await seedTx(oe.orderId, PaymentTransactionStatus.FAILED, 'ext-e'); // order not PENDING → excluded
    const res = await backlogGet(admin.token);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items.map((i: { paymentOrderId: string }) => i.paymentOrderId).sort()).toEqual([oa.orderId, ob.orderId].sort());
    expect(res.body.items.find((i: { paymentTransactionId: string }) => i.paymentTransactionId === a)).toMatchObject({ terminalStatus: 'FAILED', provider: 'CLICK', payableAmount: 100000, discounted: false });
    expect(JSON.stringify(res.body)).not.toMatch(/providerMetadata|clientRequestId|phone|answerKey/i);
    // read-only
    expect((await order(oa.orderId))!.status).toBe('PENDING');
    // security
    const learner = await makeLearner('+998900015002');
    expect((await backlogGet(learner.token)).status).toBe(403);
    expect((await request(server()).get('/api/admin/payments/reopen-backlog')).status).toBe(401);
  });

  it('§46/§47/§56/§57 reconcile reopens FAILED + CANCELLED stuck orders (REOPENED); PT unchanged; no provider call; no new PT', async () => {
    const admin = await makeAdmin('+998900015003');
    const oa = await seedOrder(admin.userId); const a = await seedTx(oa.orderId, PaymentTransactionStatus.FAILED, 'ext-a');
    const ob = await seedOrder(admin.userId); const b = await seedTx(ob.orderId, PaymentTransactionStatus.CANCELLED, 'ext-b');
    const initSpy = jest.spyOn(providerAdapter, 'initiate');
    const verifySpy = jest.spyOn(providerAdapter, 'verifyCallback');
    const before = await prisma.paymentTransaction.count();
    const res = await reconcilePost(admin.token, { limit: 50 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ scanned: 2, reopened: 2, failed: 0 });
    expect((await order(oa.orderId))!.status).toBe('CREATED');
    expect((await order(ob.orderId))!.status).toBe('CREATED');
    expect((await prisma.paymentTransaction.findUnique({ where: { id: a } }))!.status).toBe('FAILED');
    expect((await prisma.paymentTransaction.findUnique({ where: { id: b } }))!.status).toBe('CANCELLED');
    expect(initSpy).not.toHaveBeenCalled();
    expect(verifySpy).not.toHaveBeenCalled();
    expect(await prisma.paymentTransaction.count()).toBe(before); // §57 no automatic new attempt
  });

  it('§48/§21 discounted stuck order recovers to CREATED with redemption/reservation/ledger unchanged', async () => {
    const admin = await makeAdmin('+998900015004');
    await prisma.iZLLedgerEntry.create({ data: { userId: admin.userId, entryNo: 1, entryType: 'EARN', amount: 10, balanceAfter: 10 } });
    const o = await seedOrder(admin.userId, { discount: 4000 });
    await seedTx(o.orderId, PaymentTransactionStatus.FAILED, 'ext-a');
    await reconcilePost(admin.token);
    const reopened = (await order(o.orderId))!;
    expect(reopened).toMatchObject({ status: 'CREATED', izlDiscountAmount: 4000, payableAmount: 96000, izlRedemptionId: o.redemptionId });
    expect((await prisma.iZLRedemption.findUnique({ where: { id: o.redemptionId! } }))!.status).toBe('RESERVED');
    expect((await prisma.iZLReservation.findFirst({ where: { redemptionId: o.redemptionId } }))!.status).toBe('ACTIVE');
    expect((await prisma.iZLLedgerEntry.aggregate({ where: { userId: admin.userId }, _sum: { amount: true } }))._sum.amount).toBe(10);
  });

  it('§49/§31 expired stuck order recovers to CREATED; a fresh initiate is then rejected by expiry', async () => {
    const admin = await makeAdmin('+998900015005');
    const o = await seedOrder(admin.userId, { expiresAt: '2000-01-01T00:00:00Z' });
    await seedTx(o.orderId, PaymentTransactionStatus.FAILED, 'ext-a');
    expect((await reconcilePost(admin.token)).body.reopened).toBe(1);
    expect((await order(o.orderId))!.status).toBe('CREATED');
    await expect(payments.initiate(admin.userId, o.orderId, 'CLICK', 'k2')).rejects.toBeInstanceOf(PaymentOrderNotEligibleError);
  });

  it('§50/§27 bridge/reconcile race → one REOPENED effect (order CREATED once)', async () => {
    const admin = await makeAdmin('+998900015006');
    const o = await seedOrder(admin.userId); const a = await seedTx(o.orderId, PaymentTransactionStatus.FAILED, 'ext-a');
    await Promise.all([recovery.reconcile(50), reopen.reopenAfterTerminalAttempt(a)]);
    expect((await order(o.orderId))!.status).toBe('CREATED');
  });

  it('§51 dual reconcile over the same backlog → one reopen effect, safe classifications', async () => {
    const admin = await makeAdmin('+998900015007');
    const o = await seedOrder(admin.userId); await seedTx(o.orderId, PaymentTransactionStatus.FAILED, 'ext-a');
    const [r1, r2] = await Promise.all([recovery.reconcile(50), recovery.reconcile(50)]);
    expect(r1.reopened + r1.alreadyReopened + r2.reopened + r2.alreadyReopened).toBeGreaterThanOrEqual(1);
    expect((await order(o.orderId))!.status).toBe('CREATED');
  });

  it('§55 one item failure does not stop a later valid item', async () => {
    const admin = await makeAdmin('+998900015008');
    const oa = await seedOrder(admin.userId); const a = await seedTx(oa.orderId, PaymentTransactionStatus.FAILED, 'ext-a');
    const ob = await seedOrder(admin.userId); await seedTx(ob.orderId, PaymentTransactionStatus.FAILED, 'ext-b');
    const real = PaymentOrderReopenRepository.prototype.reopen;
    jest.spyOn(reopenRepo, 'reopen').mockImplementation(function (this: PaymentOrderReopenRepository, txId: string) {
      if (txId === a) throw new Error('transient');
      return real.call(this, txId);
    });
    const res = await reconcilePost(admin.token, { limit: 50 });
    expect(res.body).toMatchObject({ scanned: 2, reopened: 1, failed: 1 });
    const byTx = Object.fromEntries(res.body.items.map((i: { paymentTransactionId: string; outcome: string; reasonCode?: string }) => [i.paymentTransactionId, i]));
    expect(byTx[a]).toMatchObject({ outcome: 'FAILED', reasonCode: 'INTERNAL_REOPEN_ERROR' });
    expect((await order(oa.orderId))!.status).toBe('PENDING'); // A stayed stuck
    expect((await order(ob.orderId))!.status).toBe('CREATED'); // B recovered
  });

  it('§58/§59 reconcile limit validation + learner/unauth denied + no leak', async () => {
    const admin = await makeAdmin('+998900015009');
    expect((await reconcilePost(admin.token, { limit: 500 })).status).toBe(400);
    const empty = await reconcilePost(admin.token, {});
    expect(empty.status).toBe(201);
    expect(JSON.stringify(empty.body)).not.toMatch(/SELECT|prisma|Error:|stack/i);
    const learner = await makeLearner('+998900015010');
    expect((await reconcilePost(learner.token)).status).toBe(403);
    expect((await request(server()).post('/api/admin/payments/reopen-reconcile').send({})).status).toBe(401);
  });

  it('§25 reopen permissions are distinct from finalization permissions (finalization grant does not authorize reopen)', async () => {
    const learner = await makeLearner('+998900015011');
    const admin = await prisma.role.findUnique({ where: { code: 'ADMIN' } });
    await prisma.rolePermission.create({ data: { roleId: admin!.id, permissionCode: 'payments.finalization.reconcile' } });
    await prisma.userRole.create({ data: { userId: learner.userId, roleId: admin!.id, grantedBy: null } });
    expect((await reconcilePost(learner.token)).status).toBe(403); // has finalization perm, NOT reopen perm
  });
});
