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

describe('Subscription discount commit (e2e, izlan_test)', () => {
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
    const verify = await request(server()).post('/api/auth/register').send({ challengeId: req.body.challengeId, code: sms.latestCode(), password: 'Passw0rd!123' });
    const user = await prisma.user.findUnique({ where: { phone } });
    return { token: verify.body.accessToken, userId: user!.id };
  }
  const seedRate = (createdBy: string, rateUzsPerIzl: number, status: RateVersionStatus = RateVersionStatus.ACTIVE, effectiveFrom = '2026-08-01T00:00:00Z') =>
    prisma.izlRateVersion.create({ data: { rateUzsPerIzl, status, effectiveFrom: new Date(effectiveFrom), createdBy } });
  async function seedOrder(userId: string, gross: number) {
    const plan = await prisma.subscriptionPlan.create({ data: { code: `P-${uid()}`, name: 'Pro', sortOrder: so++ } });
    const price = await prisma.planPrice.create({ data: { planId: plan.id, amount: gross, billingPeriodMonths: 1, effectiveFrom: new Date('2026-08-01T00:00:00Z'), createdBy: userId } });
    const order = await prisma.paymentOrder.create({ data: { userId, purpose: PaymentOrderPurpose.SUBSCRIPTION_PURCHASE, planId: plan.id, planPriceId: price.id, currency: 'UZS', grossAmount: gross, izlDiscountAmount: 0, payableAmount: gross, status: PaymentOrderStatus.CREATED }, select: { id: true } });
    return order.id;
  }
  const addLedger = async (userId: string, amount: number) => {
    const agg = await prisma.iZLLedgerEntry.aggregate({ where: { userId }, _max: { entryNo: true }, _sum: { amount: true } });
    return prisma.iZLLedgerEntry.create({ data: { userId, entryNo: (agg._max.entryNo ?? 0) + 1, entryType: 'EARN', amount, balanceAfter: (agg._sum.amount ?? 0) + amount } });
  };
  const create = (token: string, paymentOrderId: string, amountIzl: number, clientRequestId = randomUUID()) =>
    request(server()).post('/api/izl/redemptions/subscription-discount').set('Authorization', `Bearer ${token}`).send({ paymentOrderId, amountIzl, clientRequestId });
  const commit = (token: string, id: string) => request(server()).post(`/api/izl/redemptions/${id}/commit-discount`).set('Authorization', `Bearer ${token}`);
  const release = (token: string, id: string) => request(server()).post(`/api/izl/redemptions/${id}/release`).set('Authorization', `Bearer ${token}`);
  const getIzl = (token: string) => request(server()).get('/api/izl/me').set('Authorization', `Bearer ${token}`);
  const order = (id: string) => prisma.paymentOrder.findUnique({ where: { id } });
  const redemption = (id: string) => prisma.iZLRedemption.findUnique({ where: { id }, include: { reservation: true } });

  // seed a RESERVED redemption + ACTIVE hold on a fresh order (rate 1000; ledger 100 → available 100)
  async function seedReserved(token: string, userId: string, gross = 100000, amountIzl = 4) {
    if (!(await prisma.izlRateVersion.findFirst({ where: { status: 'ACTIVE' } }))) await seedRate(userId, 1000); // one ACTIVE rate globally (ux_active_izl_rate)
    await addLedger(userId, 100);
    const orderId = await seedOrder(userId, gross);
    const r = await create(token, orderId, amountIzl);
    return { orderId, redemptionId: r.body.id as string, valueUzs: r.body.discountValueUzs as number };
  }

  // ───────────────────────────────────────────────────────────────────────────

  it('§52/§53/§7 commit binds discount to order; redemption RESERVED, hold ACTIVE, ledger + available unchanged', async () => {
    const { token, userId } = await makeLearner('+998900012001');
    const { orderId, redemptionId } = await seedReserved(token, userId); // value 4000
    const izlBefore = (await getIzl(token)).body;
    const ledgerBefore = await prisma.iZLLedgerEntry.count({ where: { userId } });

    const res = await commit(token, redemptionId);
    expect(res.status).toBe(200);
    expect(res.body.paymentOrder).toMatchObject({ id: orderId, grossAmount: 100000, izlDiscountAmount: 4000, payableAmount: 96000, status: 'CREATED' });
    expect(res.body.redemption).toMatchObject({ status: 'RESERVED', amountIzl: 4, discountValueUzs: 4000 });
    expect(await order(orderId).then((o) => o!.izlRedemptionId)).toBe(redemptionId);
    expect((await redemption(redemptionId))!).toMatchObject({ status: 'RESERVED', reservation: { status: 'ACTIVE' } });
    expect(await prisma.iZLLedgerEntry.count({ where: { userId } })).toBe(ledgerBefore); // §6 zero ledger
    expect((await getIzl(token)).body).toEqual(izlBefore); // §7 balance/reserved/available unchanged
  });

  it('§54 commit is idempotent', async () => {
    const { token, userId } = await makeLearner('+998900012002');
    const { orderId, redemptionId } = await seedReserved(token, userId);
    await commit(token, redemptionId);
    const again = await commit(token, redemptionId);
    expect(again.status).toBe(200);
    expect(again.body.paymentOrder).toMatchObject({ izlDiscountAmount: 4000, payableAmount: 96000 });
    expect(await order(orderId).then((o) => o!.izlRedemptionId)).toBe(redemptionId);
  });

  it('§55 commit uses the frozen quote even after the active rate changes', async () => {
    const { token, userId } = await makeLearner('+998900012003');
    const { orderId, redemptionId } = await seedReserved(token, userId, 100000, 10); // value 10000 at rate 1000
    await prisma.izlRateVersion.updateMany({ where: { status: 'ACTIVE' }, data: { status: 'ARCHIVED' } });
    await seedRate(userId, 2000);
    await commit(token, redemptionId);
    expect(await order(orderId).then((o) => ({ d: o!.izlDiscountAmount, p: o!.payableAmount }))).toEqual({ d: 10000, p: 90000 }); // frozen 10000, not 20000
  });

  it('§56 committed value inconsistent with the gross ceiling → rejected, order unchanged', async () => {
    const { token, userId } = await makeLearner('+998900012004');
    const { orderId, redemptionId } = await seedReserved(token, userId);
    await prisma.iZLRedemption.update({ where: { id: redemptionId }, data: { valueUzs: 99999 } }); // corrupt: exceeds ceiling 20000
    const res = await commit(token, redemptionId);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('REDEMPTION_CEILING_EXCEEDED');
    expect(await order(orderId).then((o) => o!.izlDiscountAmount)).toBe(0); // unchanged
  });

  it('§57/§58 commit on an expired or wrong-status order → rejected, order pricing unchanged', async () => {
    const { token, userId } = await makeLearner('+998900012005');
    const a = await seedReserved(token, userId);
    await prisma.paymentOrder.update({ where: { id: a.orderId }, data: { expiresAt: new Date('2026-08-19T00:00:00Z') } });
    expect((await commit(token, a.redemptionId)).status).toBe(409);
    expect(await order(a.orderId).then((o) => o!.izlDiscountAmount)).toBe(0);

    const b = await makeLearner('+998900012006');
    const bReserved = await seedReserved(b.token, b.userId);
    await prisma.paymentOrder.update({ where: { id: bReserved.orderId }, data: { status: PaymentOrderStatus.PENDING } });
    expect((await commit(b.token, bReserved.redemptionId)).status).toBe(409);
  });

  it('§17 order pointing to a different redemption → commit conflict', async () => {
    const { token, userId } = await makeLearner('+998900012007');
    const { orderId, redemptionId } = await seedReserved(token, userId);
    await prisma.paymentOrder.update({ where: { id: orderId }, data: { izlRedemptionId: randomUUID() } }); // points elsewhere
    const res = await commit(token, redemptionId);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('REDEMPTION_COMMIT_CONFLICT');
  });

  it('§59/§60 committed release restores the order + frees the hold; idempotent; no ledger', async () => {
    const { token, userId } = await makeLearner('+998900012008');
    const { orderId, redemptionId } = await seedReserved(token, userId);
    await commit(token, redemptionId);
    const ledgerBefore = await prisma.iZLLedgerEntry.count({ where: { userId } });

    const rel = await release(token, redemptionId);
    expect(rel.status).toBe(200);
    expect(rel.body.status).toBe('RELEASED');
    expect(await order(orderId)).toMatchObject({ izlDiscountAmount: 0, payableAmount: 100000, izlRedemptionId: null }); // restored (§25)
    expect((await redemption(redemptionId))!).toMatchObject({ status: 'RELEASED', reservation: { status: 'RELEASED' } });
    expect(await prisma.iZLLedgerEntry.count({ where: { userId } })).toBe(ledgerBefore); // §54 no ledger
    expect((await getIzl(token)).body).toEqual({ balanceIzl: 100, reservedIzl: 0, availableIzl: 100 });
    expect((await release(token, redemptionId)).body.status).toBe('RELEASED'); // idempotent
  });

  it('§25 committed redemption cannot be released once its order is no longer CREATED', async () => {
    const { token, userId } = await makeLearner('+998900012009');
    const { orderId, redemptionId } = await seedReserved(token, userId);
    await commit(token, redemptionId);
    await prisma.paymentOrder.update({ where: { id: orderId }, data: { status: PaymentOrderStatus.PENDING } });
    const rel = await release(token, redemptionId);
    expect(rel.status).toBe(409);
    expect(rel.body.code).toBe('REDEMPTION_COMMIT_CONFLICT');
  });

  it('§41/§61 commit/release race converges without a split state', async () => {
    const { token, userId } = await makeLearner('+998900012010');
    const { orderId, redemptionId } = await seedReserved(token, userId);
    const [c, r] = await Promise.allSettled([commit(token, redemptionId), release(token, redemptionId)]);
    expect([c.status, r.status]).toContain('fulfilled');
    const red = await redemption(redemptionId);
    const ord = await order(orderId);
    // final states must be internally consistent (no split): a RELEASED redemption ⇒ reservation RELEASED + order undiscounted;
    // a RESERVED redemption ⇒ reservation ACTIVE.
    if (red!.status === 'RELEASED') {
      expect(red!.reservation!.status).toBe('RELEASED');
      expect(ord).toMatchObject({ izlDiscountAmount: 0, izlRedemptionId: null });
    } else {
      expect(red!.status).toBe('RESERVED');
      expect(red!.reservation!.status).toBe('ACTIVE');
    }
    expect(await prisma.iZLLedgerEntry.count({ where: { userId } })).toBe(1); // seed only; no debit
  });

  it('§45/§64 security + boundaries: cross-user 404, 401, no ledger/reward/tx/subscription/xp writes', async () => {
    const a = await makeLearner('+998900012011');
    const { redemptionId } = await seedReserved(a.token, a.userId);
    const before = { tx: await prisma.paymentTransaction.count(), subs: await prisma.subscription.count(), rewards: await prisma.rewardGrant.count(), xp: await prisma.xpGrant.count(), ledger: await prisma.iZLLedgerEntry.count() };
    await commit(a.token, redemptionId);
    const after = { tx: await prisma.paymentTransaction.count(), subs: await prisma.subscription.count(), rewards: await prisma.rewardGrant.count(), xp: await prisma.xpGrant.count(), ledger: await prisma.iZLLedgerEntry.count() };
    expect(after).toEqual(before);
    expect(await prisma.iZLRedemption.count({ where: { status: 'APPLIED' } })).toBe(0);

    const b = await makeLearner('+998900012012');
    expect((await commit(b.token, redemptionId)).status).toBe(404); // foreign
    expect((await request(server()).post(`/api/izl/redemptions/${redemptionId}/commit-discount`)).status).toBe(401);
  });
});
