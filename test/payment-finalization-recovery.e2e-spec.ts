import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { PaymentOrderStatus, PaymentTransactionStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AuthorizationRepository } from '../src/authorization/authorization.repository';
import { AuthExceptionFilter } from '../src/auth/http/auth-exception.filter';
import { SMS_PORT } from '../src/sms/sms.port';
import { PAYMENT_PROVIDER_PORT } from '../src/payments/provider/payment-provider.port';
import { PaymentFinalizationService } from '../src/payments/payment-finalization.service';
import { PaymentFinalizationRecoveryService } from '../src/payments/payment-finalization-recovery.service';
import { PAYMENT_FINALIZATION_READ, PAYMENT_FINALIZATION_RECONCILE } from '../src/payments/finalization-recovery.constants';
import { bootstrapSystemRoles } from '../src/bootstrap/system-roles';
import { cleanupAuthTables } from './test-db.helper';
import { TestSmsAdapter } from './test-sms.adapter';
import { TestPaymentProviderAdapter } from './test-payment-provider.adapter';

const CONFIRMED = new Date('2026-08-20T07:00:00.000Z');

describe('Payment finalization recovery (e2e, izlan_test)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let finalizer: PaymentFinalizationService;
  let recovery: PaymentFinalizationRecoveryService;
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
    finalizer = moduleRef.get(PaymentFinalizationService);
    recovery = moduleRef.get(PaymentFinalizationRecoveryService);
    authz = moduleRef.get(AuthorizationRepository);
    await reset();
    await bootstrapSystemRoles(authz);
  });
  afterAll(async () => { await reset(); await app.close(); });
  beforeEach(async () => { await reset(); await bootstrapSystemRoles(authz); sms.clear(); jest.restoreAllMocks(); });

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
  async function makeAdmin(phone: string) {
    const learner = await makeLearner(phone);
    const admin = await prisma.role.findUnique({ where: { code: 'ADMIN' } });
    await prisma.rolePermission.createMany({ data: [{ roleId: admin!.id, permissionCode: PAYMENT_FINALIZATION_READ }, { roleId: admin!.id, permissionCode: PAYMENT_FINALIZATION_RECONCILE }], skipDuplicates: true });
    await prisma.userRole.create({ data: { userId: learner.userId, roleId: admin!.id, grantedBy: null } });
    return learner;
  }

  async function seedPlan(userId: string) {
    const plan = await prisma.subscriptionPlan.create({ data: { code: `P-${uid()}`, name: 'Pro', sortOrder: so++ }, select: { id: true } });
    const price = await prisma.planPrice.create({ data: { planId: plan.id, amount: 100000, billingPeriodMonths: 1, effectiveFrom: new Date('2026-08-01T00:00:00Z'), createdBy: userId }, select: { id: true } });
    return { planId: plan.id, priceId: price.id };
  }
  // A SUCCEEDED transaction + PENDING order = one backlog item. `txStatus`/`orderStatus` let us seed non-backlog rows.
  async function seedItem(userId: string, opts: { discount?: number; txStatus?: PaymentTransactionStatus; orderStatus?: PaymentOrderStatus } = {}) {
    const discount = opts.discount ?? 0;
    const p = await seedPlan(userId);
    let izlRedemptionId: string | null = null;
    if (discount > 0) {
      const red = await prisma.iZLRedemption.create({ data: { userId, type: 'SUBSCRIPTION_DISCOUNT', amountIzl: discount / 1000, izlRateSnapshot: 1000, valueUzs: discount, policyVersionCode: 'subscription-discount-redemption-v1', status: 'RESERVED' }, select: { id: true } });
      await prisma.iZLReservation.create({ data: { userId, amountIzl: discount / 1000, status: 'ACTIVE', idempotencyKey: `subscription-discount-redemption:${red.id}`, purposeCode: 'SUBSCRIPTION_DISCOUNT_REDEMPTION', redemptionId: red.id } });
      izlRedemptionId = red.id;
    }
    const order = await prisma.paymentOrder.create({ data: { userId, purpose: 'SUBSCRIPTION_PURCHASE', planId: p.planId, planPriceId: p.priceId, currency: 'UZS', grossAmount: 100000, izlDiscountAmount: discount, payableAmount: 100000 - discount, status: opts.orderStatus ?? PaymentOrderStatus.PENDING, izlRedemptionId }, select: { id: true } });
    if (izlRedemptionId) await prisma.iZLRedemption.update({ where: { id: izlRedemptionId }, data: { paymentOrderId: order.id } });
    const tx = await prisma.paymentTransaction.create({ data: { paymentOrderId: order.id, provider: 'CLICK', amount: 100000 - discount, status: opts.txStatus ?? PaymentTransactionStatus.SUCCEEDED, providerTransactionId: `ext-${uid()}`, confirmedAt: (opts.txStatus ?? 'SUCCEEDED') === 'SUCCEEDED' ? CONFIRMED : null, clientRequestId: uid() }, select: { id: true } });
    return { orderId: order.id, txId: tx.id, redemptionId: izlRedemptionId };
  }
  const order = (id: string) => prisma.paymentOrder.findUnique({ where: { id } });
  const cycles = (orderId: string) => prisma.subscriptionCycle.count({ where: { paymentOrderId: orderId } });
  const backlogGet = (token: string, q = '') => request(server()).get(`/api/admin/payments/finalization-backlog${q}`).set('Authorization', `Bearer ${token}`);
  const reconcilePost = (token: string, body: object = {}) => request(server()).post('/api/admin/payments/finalization-reconcile').set('Authorization', `Bearer ${token}`).send(body);

  // ───────────────────────────────────────────────────────────────────────────

  it('§51 admin backlog GET returns only SUCCEEDED+PENDING items; read-only; learner/unauth denied', async () => {
    const admin = await makeAdmin('+998900014001');
    const a = await seedItem(admin.userId); // SUCCEEDED + PENDING → backlog
    await seedItem(admin.userId, { orderStatus: PaymentOrderStatus.PAID }); // PAID order → not backlog
    await seedItem(admin.userId, { txStatus: PaymentTransactionStatus.PENDING }); // PENDING tx → not backlog
    const res = await backlogGet(admin.token);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ paymentTransactionId: a.txId, paymentOrderId: a.orderId, payableAmount: 100000, currency: 'UZS', discounted: false });
    expect(JSON.stringify(res.body)).not.toMatch(/providerMetadata|providerTransactionId|clientRequestId|phone|answerKey/i);
    // read-only
    expect(await cycles(a.orderId)).toBe(0);
    // security
    const learner = await makeLearner('+998900014002');
    expect((await backlogGet(learner.token)).status).toBe(403);
    expect((await request(server()).get('/api/admin/payments/finalization-backlog')).status).toBe(401);
  });

  it('§52 admin reconcile finalizes a backlog item via the existing finalizer → FINALIZED, order PAID', async () => {
    const admin = await makeAdmin('+998900014003');
    const a = await seedItem(admin.userId);
    const res = await reconcilePost(admin.token, { limit: 50 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ scanned: 1, finalized: 1, alreadyFinalized: 0, blocked: 0, failed: 0 });
    expect(res.body.items[0]).toMatchObject({ paymentTransactionId: a.txId, paymentOrderId: a.orderId, outcome: 'FINALIZED' });
    expect((await order(a.orderId))!.status).toBe('PAID');
    expect(await cycles(a.orderId)).toBe(1);
  });

  it('§53 discounted backlog item → REDEEM/CONSUMED/APPLIED/PAID (one effect)', async () => {
    const admin = await makeAdmin('+998900014004');
    await prisma.iZLLedgerEntry.create({ data: { userId: admin.userId, entryNo: 1, entryType: 'EARN', amount: 10, balanceAfter: 10 } });
    const a = await seedItem(admin.userId, { discount: 4000 });
    await reconcilePost(admin.token);
    expect((await order(a.orderId))!.status).toBe('PAID');
    expect((await prisma.iZLRedemption.findUnique({ where: { id: a.redemptionId! } }))!.status).toBe('APPLIED');
    expect((await prisma.iZLReservation.findFirst({ where: { redemptionId: a.redemptionId } }))!.status).toBe('CONSUMED');
    expect(await prisma.iZLLedgerEntry.count({ where: { entryType: 'REDEEM', redemptionId: a.redemptionId } })).toBe(1);
  });

  it('§54/§30 blocked (ACTIVE conflict) does not starve a later valid item', async () => {
    const admin = await makeAdmin('+998900014005');
    const blockedUser = await makeLearner('+998900014006');
    const p = await seedPlan(blockedUser.userId);
    await prisma.subscription.create({ data: { userId: blockedUser.userId, planId: p.planId, status: 'ACTIVE' } });
    const a = await seedItem(blockedUser.userId); // A: SUCCEEDED+PENDING but user already ACTIVE → BLOCKED
    const b = await seedItem(admin.userId); // B: valid
    const res = await reconcilePost(admin.token, { limit: 50 });
    expect(res.body).toMatchObject({ scanned: 2, finalized: 1, blocked: 1, failed: 0 });
    const byTx = Object.fromEntries(res.body.items.map((i: { paymentTransactionId: string; outcome: string; reasonCode?: string }) => [i.paymentTransactionId, i]));
    expect(byTx[a.txId]).toMatchObject({ outcome: 'BLOCKED', reasonCode: 'SUBSCRIPTION_PURCHASE_ACTIVE_CONFLICT' });
    expect(byTx[b.txId].outcome).toBe('FINALIZED');
    expect((await order(a.orderId))!.status).toBe('PENDING'); // A recoverable
    expect((await order(b.orderId))!.status).toBe('PAID');
    expect(JSON.stringify(res.body)).not.toMatch(/Error|SELECT|prisma/i); // no leak
  });

  it('§59 repeated reconcile of a blocked item stays BLOCKED, no mutation', async () => {
    const admin = await makeAdmin('+998900014007');
    const u = await makeLearner('+998900014008');
    const p = await seedPlan(u.userId);
    await prisma.subscription.create({ data: { userId: u.userId, planId: p.planId, status: 'ACTIVE' } });
    const a = await seedItem(u.userId);
    expect((await reconcilePost(admin.token)).body.blocked).toBe(1);
    expect((await reconcilePost(admin.token)).body.blocked).toBe(1);
    expect((await order(a.orderId))!.status).toBe('PENDING');
    expect(await cycles(a.orderId)).toBe(0);
  });

  it('§23/§58 already-finalized item → ALREADY_FINALIZED (no false FAILED, one effect)', async () => {
    const admin = await makeAdmin('+998900014009');
    const a = await seedItem(admin.userId);
    await finalizer.finalizeVerifiedPayment(a.txId); // finalized out-of-band first
    const res = await reconcilePost(admin.token);
    // backlog query excludes PAID orders, so nothing to scan — but a direct reconcileOne converges to ALREADY_FINALIZED
    expect(res.body.scanned).toBe(0);
    const one = await recovery.reconcileOne(a.txId);
    expect(one.outcome).toBe('ALREADY_FINALIZED');
    expect(await cycles(a.orderId)).toBe(1);
  });

  it('§56/§57/§21 concurrent reconcile + finalizer race → exactly one cycle, safe convergence', async () => {
    const admin = await makeAdmin('+998900014010');
    const a = await seedItem(admin.userId);
    const [r1, r2] = await Promise.all([recovery.reconcile(50), finalizer.finalizeVerifiedPayment(a.txId)]);
    expect(await cycles(a.orderId)).toBe(1); // one effect
    expect((await order(a.orderId))!.status).toBe('PAID');
    expect(r1.finalized + r1.alreadyFinalized).toBe(1); // reconcile classified it safely
    expect(r2.status).toBe('PAID');
  });

  it('§60/§20 reconcile never calls the payment provider', async () => {
    const admin = await makeAdmin('+998900014011');
    await seedItem(admin.userId);
    const initSpy = jest.spyOn(providerAdapter, 'initiate');
    const verifySpy = jest.spyOn(providerAdapter, 'verifyCallback');
    await reconcilePost(admin.token);
    expect(initSpy).not.toHaveBeenCalled();
    expect(verifySpy).not.toHaveBeenCalled();
  });

  it('§6/§18 reconcile limit validation + learner/unauth denied', async () => {
    const admin = await makeAdmin('+998900014012');
    expect((await reconcilePost(admin.token, { limit: 500 })).status).toBe(400); // > max 200
    expect((await reconcilePost(admin.token, { limit: 0 })).status).toBe(400);
    expect((await reconcilePost(admin.token, {})).status).toBe(201); // default
    const learner = await makeLearner('+998900014013');
    expect((await reconcilePost(learner.token)).status).toBe(403);
    expect((await request(server()).post('/api/admin/payments/finalization-reconcile').send({})).status).toBe(401);
  });
});
