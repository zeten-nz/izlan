import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { SubscriptionPlanStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AuthorizationRepository } from '../src/authorization/authorization.repository';
import { AuthExceptionFilter } from '../src/auth/http/auth-exception.filter';
import { SMS_PORT } from '../src/sms/sms.port';
import { Clock } from '../src/common/clock';
import { bootstrapSystemRoles } from '../src/bootstrap/system-roles';
import { cleanupAuthTables } from './test-db.helper';
import { TestSmsAdapter } from './test-sms.adapter';

describe('Subscription purchase order (e2e, izlan_test)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  const sms = new TestSmsAdapter();
  const clock = { current: new Date('2026-08-20T06:00:00.000Z'), now() { return this.current; } };
  let np = 0;
  let sortSeq = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(SMS_PORT).useValue(sms).overrideProvider(Clock).useValue(clock).compile();
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
  beforeEach(async () => { await reset(); sms.clear(); clock.current = new Date('2026-08-20T06:00:00.000Z'); });

  async function reset() {
    await prisma.paymentOrder.deleteMany();
    await prisma.planPrice.deleteMany();
    await prisma.subscriptionPlan.deleteMany();
    await cleanupAuthTables(prisma);
  }
  const server = () => app.getHttpServer();

  async function makeLearner(phone: string) {
    await prisma.otpChallenge.updateMany({ where: { phone }, data: { createdAt: new Date(Date.now() - 300_000) } });
    const req = await request(server()).post('/api/auth/otp/request').send({ phone });
    const verify = await request(server()).post('/api/auth/otp/verify').send({ challengeId: req.body.challengeId, code: sms.latestCode() });
    const user = await prisma.user.findUnique({ where: { phone } });
    return { token: verify.body.accessToken, userId: user!.id };
  }
  const seedPlan = (status: SubscriptionPlanStatus = SubscriptionPlanStatus.ACTIVE) =>
    prisma.subscriptionPlan.create({ data: { code: `PLAN-${np++}-${Date.now()}`, name: 'Pro', status, sortOrder: sortSeq++ }, select: { id: true } });
  const seedPrice = (planId: string, amount: number, effectiveFrom: string, createdBy: string) =>
    prisma.planPrice.create({ data: { planId, currency: 'UZS', amount, billingPeriodMonths: 1, effectiveFrom: new Date(effectiveFrom), createdBy }, select: { id: true } });
  const createOrder = (token: string, planId: string, clientRequestId = randomUUID()) =>
    request(server()).post('/api/payments/subscription-orders').set('Authorization', `Bearer ${token}`).send({ planId, clientRequestId });
  const getOrder = (token: string, id: string) => request(server()).get(`/api/payments/orders/${id}`).set('Authorization', `Bearer ${token}`);

  // ───────────────────────────────────────────────────────────────────────────

  it('§7/§14/§36 create → CREATED order, frozen gross, discount 0, payable=gross, provider NULL, no side effects', async () => {
    const { token, userId } = await makeLearner('+998900010001');
    const plan = await seedPlan();
    await seedPrice(plan.id, 100000, '2026-08-01T00:00:00Z', userId);

    const res = await createOrder(token, plan.id);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ purpose: 'SUBSCRIPTION_PURCHASE', status: 'CREATED', currency: 'UZS', grossAmount: 100000, izlDiscountAmount: 0, payableAmount: 100000, plan: { id: plan.id } });
    const row = await prisma.paymentOrder.findUnique({ where: { id: res.body.id } });
    expect(row!.provider).toBeNull(); // provider-agnostic (§8/§36)
    expect(await prisma.paymentTransaction.count()).toBe(0);
    expect(await prisma.subscription.count()).toBe(0);
    expect(await prisma.subscriptionCycle.count()).toBe(0);
    expect(await prisma.iZLRedemption.count()).toBe(0);
    expect(await prisma.iZLReservation.count()).toBe(0);
    expect(await prisma.iZLLedgerEntry.count()).toBe(0);
    expect(await prisma.xpGrant.count()).toBe(0);
  });

  it('§11/§30 idempotent replay returns the original order (never repriced)', async () => {
    const { token, userId } = await makeLearner('+998900010002');
    const plan = await seedPlan();
    await seedPrice(plan.id, 100000, '2026-08-01T00:00:00Z', userId);
    const rid = randomUUID();
    const a = await createOrder(token, plan.id, rid);
    await seedPrice(plan.id, 120000, '2026-08-15T00:00:00Z', userId); // newer effective price
    const b = await createOrder(token, plan.id, rid); // replay
    expect(b.body.id).toBe(a.body.id);
    expect(b.body.grossAmount).toBe(100000); // original snapshot, not repriced
    expect(await prisma.paymentOrder.count({ where: { userId } })).toBe(1);
  });

  it('§12/§38 idempotency conflict (same key, different plan) → 409, no second order', async () => {
    const { token, userId } = await makeLearner('+998900010003');
    const planA = await seedPlan();
    const planB = await seedPlan();
    await seedPrice(planA.id, 100000, '2026-08-01T00:00:00Z', userId);
    await seedPrice(planB.id, 200000, '2026-08-01T00:00:00Z', userId);
    const rid = randomUUID();
    await createOrder(token, planA.id, rid);
    const conflict = await createOrder(token, planB.id, rid);
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('PAYMENT_ORDER_REQUEST_CONFLICT');
    expect(await prisma.paymentOrder.count({ where: { userId } })).toBe(1);
  });

  it('§29 new request after a price change gets the new gross; earlier order unchanged', async () => {
    const { token, userId } = await makeLearner('+998900010004');
    const plan = await seedPlan();
    await seedPrice(plan.id, 100000, '2026-08-01T00:00:00Z', userId);
    const a = await createOrder(token, plan.id);
    await seedPrice(plan.id, 120000, '2026-08-15T00:00:00Z', userId);
    const b = await createOrder(token, plan.id); // new clientRequestId
    expect(a.body.grossAmount).toBe(100000);
    expect(b.body.grossAmount).toBe(120000);
  });

  it('§32/§33/§34 price eligibility: no price → 409; future-only → 409; effectiveFrom == now → eligible', async () => {
    const { token, userId } = await makeLearner('+998900010005');
    const noPrice = await seedPlan();
    expect((await createOrder(token, noPrice.id)).status).toBe(409);

    const futureOnly = await seedPlan();
    await seedPrice(futureOnly.id, 50000, '2026-09-01T00:00:00Z', userId); // > now
    const fut = await createOrder(token, futureOnly.id);
    expect(fut.status).toBe(409);
    expect(fut.body.code).toBe('PAYMENT_PLAN_PRICE_NOT_AVAILABLE');

    const exact = await seedPlan();
    await seedPrice(exact.id, 70000, '2026-08-20T06:00:00Z', userId); // == clock now
    const ok = await createOrder(token, exact.id);
    expect(ok.status).toBe(201);
    expect(ok.body.grossAmount).toBe(70000);
  });

  it('§5 archived plan is not purchasable → 404', async () => {
    const { token, userId } = await makeLearner('+998900010006');
    const plan = await seedPlan(SubscriptionPlanStatus.ARCHIVED);
    await seedPrice(plan.id, 100000, '2026-08-01T00:00:00Z', userId);
    const res = await createOrder(token, plan.id);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('PAYMENT_PLAN_NOT_AVAILABLE');
  });

  it('§37 different users may reuse the same clientRequestId → two orders', async () => {
    const a = await makeLearner('+998900010007');
    const b = await makeLearner('+998900010008');
    const plan = await seedPlan();
    await seedPrice(plan.id, 100000, '2026-08-01T00:00:00Z', a.userId);
    const rid = randomUUID();
    const oa = await createOrder(a.token, plan.id, rid);
    const ob = await createOrder(b.token, plan.id, rid);
    expect(oa.status).toBe(201);
    expect(ob.status).toBe(201);
    expect(oa.body.id).not.toBe(ob.body.id);
  });

  it('§13/§39 concurrent identical create → one order', async () => {
    const { token, userId } = await makeLearner('+998900010009');
    const plan = await seedPlan();
    await seedPrice(plan.id, 100000, '2026-08-01T00:00:00Z', userId);
    const rid = randomUUID();
    const [a, b] = await Promise.all([createOrder(token, plan.id, rid), createOrder(token, plan.id, rid)]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.id).toBe(b.body.id);
    expect(await prisma.paymentOrder.count({ where: { userId } })).toBe(1);
  });

  it('§23/§25 GET own order (read-only); foreign 404; 401; no client economic authority', async () => {
    const { token, userId } = await makeLearner('+998900010010');
    const plan = await seedPlan();
    await seedPrice(plan.id, 100000, '2026-08-01T00:00:00Z', userId);
    const created = await createOrder(token, plan.id);
    const g = await getOrder(token, created.body.id);
    expect(g.status).toBe(200);
    expect(g.body).toMatchObject({ id: created.body.id, grossAmount: 100000, status: 'CREATED' });
    expect(await prisma.paymentOrder.findUnique({ where: { id: created.body.id } }).then((r) => r!.status)).toBe('CREATED'); // GET didn't transition

    const attacker = await makeLearner('+998900010011');
    expect((await getOrder(attacker.token, created.body.id)).status).toBe(404); // IDOR → 404
    expect((await request(server()).get(`/api/payments/orders/${created.body.id}`)).status).toBe(401);
    // client cannot inject economic fields (whitelist rejects)
    const inject = await request(server()).post('/api/payments/subscription-orders').set('Authorization', `Bearer ${token}`).send({ planId: plan.id, clientRequestId: randomUUID(), grossAmount: 1, provider: 'CLICK', status: 'PAID' });
    expect(inject.status).toBe(400);
  });
});
