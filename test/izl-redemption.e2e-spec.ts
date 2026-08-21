import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { PaymentOrderPurpose, PaymentOrderStatus, RateVersionStatus } from '@prisma/client';
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

describe('Subscription discount redemption intent (e2e, izlan_test)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  const sms = new TestSmsAdapter();
  const clock = { current: new Date('2026-08-20T06:00:00.000Z'), now() { return this.current; } };
  let n = 0;
  let so = 0;

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
    await prisma.iZLReservation.deleteMany();
    await prisma.iZLRedemption.deleteMany();
    await prisma.iZLLedgerEntry.deleteMany();
    await prisma.paymentOrder.deleteMany();
    await prisma.planPrice.deleteMany();
    await prisma.subscriptionPlan.deleteMany();
    await prisma.izlRateVersion.deleteMany();
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
  const seedRate = (createdBy: string, rateUzsPerIzl: number, status: RateVersionStatus = RateVersionStatus.ACTIVE, effectiveFrom = '2026-08-01T00:00:00Z') =>
    prisma.izlRateVersion.create({ data: { rateUzsPerIzl, status, effectiveFrom: new Date(effectiveFrom), createdBy } });
  async function seedOrder(userId: string, gross: number, o: { status?: PaymentOrderStatus; purpose?: PaymentOrderPurpose; expiresAt?: string; discount?: number } = {}) {
    const plan = await prisma.subscriptionPlan.create({ data: { code: `P-${uid()}`, name: 'Pro', sortOrder: so++ } });
    const price = await prisma.planPrice.create({ data: { planId: plan.id, amount: gross, billingPeriodMonths: 1, effectiveFrom: new Date('2026-08-01T00:00:00Z'), createdBy: userId } });
    const discount = o.discount ?? 0;
    const order = await prisma.paymentOrder.create({ data: { userId, purpose: o.purpose ?? PaymentOrderPurpose.SUBSCRIPTION_PURCHASE, planId: plan.id, planPriceId: price.id, currency: 'UZS', grossAmount: gross, izlDiscountAmount: discount, payableAmount: gross - discount, status: o.status ?? PaymentOrderStatus.CREATED, ...(o.expiresAt ? { expiresAt: new Date(o.expiresAt) } : {}) }, select: { id: true } });
    return order.id;
  }
  async function addLedger(userId: string, amount: number) {
    const agg = await prisma.iZLLedgerEntry.aggregate({ where: { userId }, _max: { entryNo: true }, _sum: { amount: true } });
    return prisma.iZLLedgerEntry.create({ data: { userId, entryNo: (agg._max.entryNo ?? 0) + 1, entryType: 'EARN', amount, balanceAfter: (agg._sum.amount ?? 0) + amount } });
  }
  const create = (token: string, paymentOrderId: string, amountIzl: number, clientRequestId = randomUUID()) =>
    request(server()).post('/api/izl/redemptions/subscription-discount').set('Authorization', `Bearer ${token}`).send({ paymentOrderId, amountIzl, clientRequestId });
  const getR = (token: string, id: string) => request(server()).get(`/api/izl/redemptions/${id}`).set('Authorization', `Bearer ${token}`);
  const release = (token: string, id: string) => request(server()).post(`/api/izl/redemptions/${id}/release`).set('Authorization', `Bearer ${token}`);
  const getIzl = (token: string) => request(server()).get('/api/izl/me').set('Authorization', `Bearer ${token}`);

  // ───────────────────────────────────────────────────────────────────────────

  it('§31/§34/§35 create → RESERVED + ACTIVE hold; no ledger; PaymentOrder unchanged; reserved rises', async () => {
    const { token, userId } = await makeLearner('+998900011001');
    await seedRate(userId, 1000);
    await addLedger(userId, 100); // 100 IZL available
    const orderId = await seedOrder(userId, 100000); // ceiling 20000
    const ledgerBefore = await prisma.iZLLedgerEntry.count({ where: { userId } });

    const res = await create(token, orderId, 20); // value 20000 = ceiling
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ paymentOrderId: orderId, type: 'SUBSCRIPTION_DISCOUNT', status: 'RESERVED', amountIzl: 20, discountValueUzs: 20000, policyVersion: 'subscription-discount-redemption-v1' });
    const reservation = await prisma.iZLReservation.findFirst({ where: { userId } });
    expect(reservation).toMatchObject({ status: 'ACTIVE', amountIzl: 20, purposeCode: 'SUBSCRIPTION_DISCOUNT_REDEMPTION', redemptionId: res.body.id });
    expect(await prisma.iZLLedgerEntry.count({ where: { userId } })).toBe(ledgerBefore); // no ledger movement (§34)
    const order = await prisma.paymentOrder.findUnique({ where: { id: orderId } });
    expect(order).toMatchObject({ grossAmount: 100000, izlDiscountAmount: 0, payableAmount: 100000, izlRedemptionId: null }); // unchanged (§35/§11)
    expect((await getIzl(token)).body).toEqual({ balanceIzl: 100, reservedIzl: 20, availableIzl: 80 });
  });

  it('§36 idempotent replay → same redemption, one reservation', async () => {
    const { token, userId } = await makeLearner('+998900011002');
    await seedRate(userId, 1000);
    await addLedger(userId, 100);
    const orderId = await seedOrder(userId, 100000);
    const rid = randomUUID();
    const a = await create(token, orderId, 10, rid);
    const b = await create(token, orderId, 10, rid);
    expect(b.body.id).toBe(a.body.id);
    expect(await prisma.iZLRedemption.count({ where: { userId } })).toBe(1);
    expect(await prisma.iZLReservation.count({ where: { userId } })).toBe(1);
  });

  it('§37 idempotency conflict (same key, different amount) → 409', async () => {
    const { token, userId } = await makeLearner('+998900011003');
    await seedRate(userId, 1000);
    await addLedger(userId, 100);
    const orderId = await seedOrder(userId, 100000);
    const rid = randomUUID();
    await create(token, orderId, 10, rid);
    const conflict = await create(token, orderId, 12, rid);
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('REDEMPTION_REQUEST_CONFLICT');
  });

  it('§9/§10 one open redemption per order; RELEASED permits a new one', async () => {
    const { token, userId } = await makeLearner('+998900011004');
    await seedRate(userId, 1000);
    await addLedger(userId, 100);
    const orderId = await seedOrder(userId, 100000);
    const first = await create(token, orderId, 5);
    const second = await create(token, orderId, 6); // new key, same order
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('REDEMPTION_OPEN_INTENT_CONFLICT');
    await release(token, first.body.id);
    const third = await create(token, orderId, 7); // now allowed
    expect(third.status).toBe(201);
    expect(third.body.status).toBe('RESERVED');
  });

  it('§42 ceiling: 20 IZL (=ceiling) allowed, 21 rejected', async () => {
    const { token, userId } = await makeLearner('+998900011005');
    await seedRate(userId, 1000);
    await addLedger(userId, 100);
    const orderId = await seedOrder(userId, 100000); // ceiling 20000
    const over = await create(token, orderId, 21);
    expect(over.status).toBe(409);
    expect(over.body.code).toBe('REDEMPTION_CEILING_EXCEEDED');
    expect((await create(token, orderId, 20)).status).toBe(201);
  });

  it('§66/§67 availability: over available rejected; exact available allowed → reserved fills', async () => {
    const a = await makeLearner('+998900011006');
    await seedRate(a.userId, 1);
    await addLedger(a.userId, 3);
    const o1 = await seedOrder(a.userId, 100000);
    expect((await create(a.token, o1, 4)).status).toBe(409); // needs 4, has 3
    expect((await create(a.token, o1, 3)).status).toBe(201);
    expect((await getIzl(a.token)).body).toEqual({ balanceIzl: 3, reservedIzl: 3, availableIzl: 0 });
  });

  it('§40 stale wallet is not authorization authority', async () => {
    const { token, userId } = await makeLearner('+998900011007');
    await seedRate(userId, 1);
    await addLedger(userId, 3);
    await prisma.iZLWallet.create({ data: { userId, balance: 999, reservedAmount: 0, projectionVersionCode: 'izl-wallet-projection-v1' } }); // stale high
    const orderId = await seedOrder(userId, 100000);
    expect((await create(token, orderId, 4)).status).toBe(409); // canonical available is 3, not 999
  });

  it('§41 rate is snapshotted; replay never reprices after a rate change', async () => {
    const { token, userId } = await makeLearner('+998900011008');
    await seedRate(userId, 1000); // active
    await addLedger(userId, 100);
    const orderId = await seedOrder(userId, 100000);
    const rid = randomUUID();
    const r = await create(token, orderId, 10, rid); // value 10000 at rate 1000
    expect(r.body.discountValueUzs).toBe(10000);
    await prisma.izlRateVersion.updateMany({ where: { status: 'ACTIVE' }, data: { status: 'ARCHIVED' } });
    await seedRate(userId, 2000); // new active
    const replay = await create(token, orderId, 10, rid);
    expect(replay.body.id).toBe(r.body.id);
    expect(replay.body.discountValueUzs).toBe(10000); // original snapshot, not 20000
    expect((await prisma.iZLRedemption.findUnique({ where: { id: r.body.id } }))!.izlRateSnapshot).toBe(1000);
  });

  it('§44-47 release frees the hold atomically (no ledger); replay idempotent', async () => {
    const { token, userId } = await makeLearner('+998900011009');
    await seedRate(userId, 1000);
    await addLedger(userId, 100);
    const orderId = await seedOrder(userId, 100000);
    const r = await create(token, orderId, 10);
    const ledgerBefore = await prisma.iZLLedgerEntry.count({ where: { userId } });
    const rel = await release(token, r.body.id);
    expect(rel.status).toBe(200);
    expect(rel.body.status).toBe('RELEASED');
    expect((await prisma.iZLReservation.findFirst({ where: { userId } }))!.status).toBe('RELEASED');
    expect(await prisma.iZLLedgerEntry.count({ where: { userId } })).toBe(ledgerBefore); // no ledger (§54)
    expect((await getIzl(token)).body).toEqual({ balanceIzl: 100, reservedIzl: 0, availableIzl: 100 });
    expect((await release(token, r.body.id)).body.status).toBe('RELEASED'); // idempotent
  });

  it('§69/§71/§72/§73 ineligible orders (expired / wrong status / wrong purpose / already discounted) → 409, no rows', async () => {
    const { token, userId } = await makeLearner('+998900011010');
    await seedRate(userId, 1000);
    await addLedger(userId, 100);
    const expired = await seedOrder(userId, 100000, { expiresAt: '2026-08-19T00:00:00Z' });
    const pending = await seedOrder(userId, 100000, { status: PaymentOrderStatus.PENDING });
    const renewal = await seedOrder(userId, 100000, { purpose: PaymentOrderPurpose.SUBSCRIPTION_RENEWAL });
    const discounted = await seedOrder(userId, 100000, { discount: 5000 });
    for (const id of [expired, pending, renewal, discounted]) {
      const res = await create(token, id, 5);
      expect(res.status).toBe(409);
    }
    expect(await prisma.iZLRedemption.count({ where: { userId } })).toBe(0);
    expect(await prisma.iZLReservation.count({ where: { userId } })).toBe(0);
  });

  it('§19 no usable ACTIVE rate → 409, no rows', async () => {
    const { token, userId } = await makeLearner('+998900011011');
    await seedRate(userId, 1000, RateVersionStatus.DRAFT); // not active
    await addLedger(userId, 100);
    const orderId = await seedOrder(userId, 100000);
    const res = await create(token, orderId, 5);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('REDEMPTION_RATE_NOT_AVAILABLE');
  });

  it('§52/§54/§55-58 no APPLIED / no ledger / no PaymentTransaction / Subscription / XP', async () => {
    const { token, userId } = await makeLearner('+998900011012');
    await seedRate(userId, 1000);
    await addLedger(userId, 100);
    const orderId = await seedOrder(userId, 100000);
    await create(token, orderId, 10);
    expect(await prisma.iZLRedemption.count({ where: { status: 'APPLIED' } })).toBe(0);
    expect(await prisma.iZLReservation.count({ where: { status: 'RELEASED', redemptionId: null } })).toBe(0);
    expect(await prisma.paymentTransaction.count()).toBe(0);
    expect(await prisma.subscription.count()).toBe(0);
    expect(await prisma.rewardGrant.count()).toBe(0);
    expect(await prisma.xpGrant.count()).toBe(0);
  });

  it('§63/§64/§65 security: cross-user order 404, cross-user redemption 404, 401, no injection', async () => {
    const a = await makeLearner('+998900011013');
    await seedRate(a.userId, 1000);
    await addLedger(a.userId, 100);
    const orderId = await seedOrder(a.userId, 100000);
    const r = await create(a.token, orderId, 10);

    const b = await makeLearner('+998900011014');
    expect((await create(b.token, orderId, 10)).status).toBe(404); // B can't redeem A's order
    expect((await getR(b.token, r.body.id)).status).toBe(404); // B can't read A's redemption
    expect((await release(b.token, r.body.id)).status).toBe(404); // B can't release A's redemption
    expect((await request(server()).get(`/api/izl/redemptions/${r.body.id}`)).status).toBe(401);
    const inject = await request(server()).post('/api/izl/redemptions/subscription-discount').set('Authorization', `Bearer ${a.token}`).send({ paymentOrderId: orderId, amountIzl: 5, clientRequestId: randomUUID(), valueUzs: 1, status: 'APPLIED', izlRateSnapshot: 1 });
    expect(inject.status).toBe(400);
  });
});
