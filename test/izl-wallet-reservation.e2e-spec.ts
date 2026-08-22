import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AuthorizationRepository } from '../src/authorization/authorization.repository';
import { AuthExceptionFilter } from '../src/auth/http/auth-exception.filter';
import { SMS_PORT } from '../src/sms/sms.port';
import { bootstrapSystemRoles } from '../src/bootstrap/system-roles';
import { cleanupAuthTables } from './test-db.helper';
import { TestSmsAdapter } from './test-sms.adapter';
import { IzlReservationService } from '../src/finance/reservation/izl-reservation.service';
import { IzlInsufficientAvailableError, IzlReservationConflictError } from '../src/common/errors';

describe('IZL wallet + reservation (e2e, izlan_test)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let reservations: IzlReservationService;
  const sms = new TestSmsAdapter();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(SMS_PORT).useValue(sms).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AuthExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = moduleRef.get(PrismaService);
    reservations = moduleRef.get(IzlReservationService); // internal trusted primitive (no public endpoint)
    await reset();
    await prisma.role.deleteMany();
    await bootstrapSystemRoles(moduleRef.get(AuthorizationRepository));
  });
  afterAll(async () => { await reset(); await app.close(); });
  beforeEach(async () => { await reset(); sms.clear(); });

  async function reset() {
    await prisma.iZLLedgerEntry.deleteMany();
    await prisma.iZLReservation.deleteMany();
    await prisma.iZLWallet.deleteMany();
    await cleanupAuthTables(prisma);
  }
  const server = () => app.getHttpServer();
  let np = 0;

  async function makeLearner() {
    const phone = `+9989011${String(10000 + np++).slice(-5)}`;
    await prisma.otpChallenge.updateMany({ where: { phone }, data: { createdAt: new Date(Date.now() - 300_000) } });
    const req = await request(server()).post('/api/auth/otp/request').send({ phone });
    const verify = await request(server()).post('/api/auth/register').send({ challengeId: req.body.challengeId, code: sms.latestCode(), password: 'Passw0rd!123' });
    const user = await prisma.user.findUnique({ where: { phone } });
    return { token: verify.body.accessToken, userId: user!.id };
  }
  // Append a canonical ledger entry with correct running entryNo/balanceAfter (positive=EARN, negative=ADJUSTMENT).
  async function addLedger(userId: string, amount: number) {
    const agg = await prisma.iZLLedgerEntry.aggregate({ where: { userId }, _max: { entryNo: true }, _sum: { amount: true } });
    const entryNo = (agg._max.entryNo ?? 0) + 1;
    const balanceAfter = (agg._sum.amount ?? 0) + amount;
    return prisma.iZLLedgerEntry.create({ data: { userId, entryNo, entryType: amount >= 0 ? 'EARN' : 'ADJUSTMENT', amount, balanceAfter, ...(amount < 0 ? { reason: 'test-correction', actorUserId: userId } : {}) } });
  }
  const reserve = (userId: string, amountIzl: number, idempotencyKey: string, purposeCode = 'REDEMPTION_HOLD') => reservations.reserve({ userId, amountIzl, idempotencyKey, purposeCode });
  const getIzl = (token: string) => request(server()).get('/api/izl/me').set('Authorization', `Bearer ${token}`);
  const reconcileIzl = (token: string) => request(server()).post('/api/izl/me/reconcile').set('Authorization', `Bearer ${token}`);
  const wallet = (userId: string) => prisma.iZLWallet.findUnique({ where: { userId } });
  const activeReservations = (userId: string) => prisma.iZLReservation.count({ where: { userId, status: 'ACTIVE' } });

  // ───────────────────────────────────────────────────────────────────────────

  it('§68 zero state → 0/0/0; reserve rejected on empty balance', async () => {
    const { token, userId } = await makeLearner();
    expect((await getIzl(token)).body).toEqual({ balanceIzl: 0, reservedIzl: 0, availableIzl: 0 });
    await expect(reserve(userId, 1, 'k')).rejects.toBeInstanceOf(IzlInsufficientAvailableError);
    expect(await activeReservations(userId)).toBe(0);
  });

  it('§70 reserve holds against available; creates NO ledger entry', async () => {
    const { token, userId } = await makeLearner();
    await addLedger(userId, 10);
    const before = await prisma.iZLLedgerEntry.count({ where: { userId } });
    await reserve(userId, 4, 'k');
    expect(await prisma.iZLLedgerEntry.count({ where: { userId } })).toBe(before); // no ledger movement (§35)
    expect((await getIzl(token)).body).toEqual({ balanceIzl: 10, reservedIzl: 4, availableIzl: 6 });
    expect(await wallet(userId)).toMatchObject({ balance: 10, reservedAmount: 4, projectionVersionCode: 'izl-wallet-projection-v1' }); // projection refreshed
  });

  it('§71/§72 full reserve then reject; over-reserve rejected with no row', async () => {
    const { token, userId } = await makeLearner();
    await addLedger(userId, 5);
    await reserve(userId, 5, 'full');
    expect((await getIzl(token)).body).toEqual({ balanceIzl: 5, reservedIzl: 5, availableIzl: 0 });
    await expect(reserve(userId, 1, 'more')).rejects.toBeInstanceOf(IzlInsufficientAvailableError);
    const { userId: u2 } = await makeLearner();
    await addLedger(u2, 5);
    await expect(reserve(u2, 6, 'over')).rejects.toBeInstanceOf(IzlInsufficientAvailableError);
    expect(await activeReservations(u2)).toBe(0);
  });

  it('§73 idempotent reserve → same reservation, reserved unchanged', async () => {
    const { token, userId } = await makeLearner();
    await addLedger(userId, 10);
    const a = await reserve(userId, 3, 'K');
    const b = await reserve(userId, 3, 'K');
    expect(b.id).toBe(a.id);
    expect(await prisma.iZLReservation.count({ where: { userId } })).toBe(1);
    expect((await getIzl(token)).body).toMatchObject({ reservedIzl: 3 });
  });

  it('§74 idempotency conflict (same key, different amount) → conflict, no mutation', async () => {
    const { userId } = await makeLearner();
    await addLedger(userId, 10);
    await reserve(userId, 3, 'K');
    await expect(reserve(userId, 4, 'K')).rejects.toBeInstanceOf(IzlReservationConflictError);
    const rows = await prisma.iZLReservation.findMany({ where: { userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].amountIzl).toBe(3); // unchanged
  });

  it('§75/§24 concurrent reservations → exactly one succeeds against balance 1', async () => {
    const { token, userId } = await makeLearner();
    await addLedger(userId, 1);
    const results = await Promise.allSettled([reserve(userId, 1, 'A'), reserve(userId, 1, 'B')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await activeReservations(userId)).toBe(1);
    expect((await getIzl(token)).body).toEqual({ balanceIzl: 1, reservedIzl: 1, availableIzl: 0 });
  });

  it('§76 multiple valid holds accumulate reserved', async () => {
    const { token, userId } = await makeLearner();
    await addLedger(userId, 10);
    await reserve(userId, 2, 'a');
    await reserve(userId, 3, 'b');
    await reserve(userId, 4, 'c');
    expect((await getIzl(token)).body).toEqual({ balanceIzl: 10, reservedIzl: 9, availableIzl: 1 });
  });

  it('§77/§78 release frees the hold with no ledger movement; release replay is idempotent', async () => {
    const { token, userId } = await makeLearner();
    await addLedger(userId, 10);
    const r = await reserve(userId, 3, 'k');
    const ledgerBefore = await prisma.iZLLedgerEntry.count({ where: { userId } });
    await reservations.release(userId, r.id);
    expect((await getIzl(token)).body).toEqual({ balanceIzl: 10, reservedIzl: 0, availableIzl: 10 });
    expect(await prisma.iZLLedgerEntry.count({ where: { userId } })).toBe(ledgerBefore); // no +3 credit (§36)
    await reservations.release(userId, r.id); // replay
    expect(await prisma.iZLReservation.count({ where: { userId, status: 'RELEASED' } })).toBe(1);
  });

  it('§80/§42 negative correction: signed available, existing hold stays ACTIVE, new reserve rejected', async () => {
    const { token, userId } = await makeLearner();
    await addLedger(userId, 5);
    await reserve(userId, 3, 'k'); // available 2
    await addLedger(userId, -4); // ledger now 1
    expect((await getIzl(token)).body).toEqual({ balanceIzl: 1, reservedIzl: 3, availableIzl: -2 });
    expect(await activeReservations(userId)).toBe(1); // not auto-released
    await expect(reserve(userId, 1, 'k2')).rejects.toBeInstanceOf(IzlInsufficientAvailableError);
  });

  it('§81 GET is canonical + read-only against a stale wallet', async () => {
    const { token, userId } = await makeLearner();
    await addLedger(userId, 10);
    await reserve(userId, 3, 'k'); // wallet now canonical 10/3
    await prisma.iZLWallet.update({ where: { userId }, data: { balance: 999, reservedAmount: 0 } }); // corrupt the cache
    expect((await getIzl(token)).body).toEqual({ balanceIzl: 10, reservedIzl: 3, availableIzl: 7 }); // canonical, not stale
    expect(await wallet(userId)).toMatchObject({ balance: 999, reservedAmount: 0 }); // GET did not repair
  });

  it('§82/§46 reconcile repairs a corrupt wallet to canonical projection', async () => {
    const { token, userId } = await makeLearner();
    await addLedger(userId, 10);
    await reserve(userId, 3, 'k');
    await prisma.iZLWallet.update({ where: { userId }, data: { balance: 999, reservedAmount: 0, projectionVersionCode: null } });
    await reconcileIzl(token);
    expect(await wallet(userId)).toMatchObject({ balance: 10, reservedAmount: 3, projectionVersionCode: 'izl-wallet-projection-v1' });
    expect((await getIzl(token)).body).toEqual({ balanceIzl: 10, reservedIzl: 3, availableIzl: 7 });
  });

  it('§83/§40 wallet absent: GET correct + creates nothing; reconcile creates the projection', async () => {
    const { token, userId } = await makeLearner();
    await addLedger(userId, 5); // direct ledger, no reserve/reconcile → no wallet
    expect(await wallet(userId)).toBeNull();
    expect((await getIzl(token)).body).toEqual({ balanceIzl: 5, reservedIzl: 0, availableIzl: 5 });
    expect(await wallet(userId)).toBeNull(); // GET created no wallet (§39/§40)
    await reconcileIzl(token);
    expect(await wallet(userId)).toMatchObject({ balance: 5, reservedAmount: 0, projectionVersionCode: 'izl-wallet-projection-v1' });
  });

  it('§87 GET security: own-user only + 401', async () => {
    const a = await makeLearner();
    await addLedger(a.userId, 7);
    await reserve(a.userId, 2, 'k');
    const b = await makeLearner();
    expect((await getIzl(b.token)).body).toEqual({ balanceIzl: 0, reservedIzl: 0, availableIzl: 0 }); // never sees A's balance/holds
    expect((await request(server()).get('/api/izl/me')).status).toBe(401);
  });

  it('§88/§16 no public learner reservation create/release endpoint exists', async () => {
    const { token } = await makeLearner();
    expect((await request(server()).post('/api/izl/reservations').set('Authorization', `Bearer ${token}`).send({ amountIzl: 1 })).status).toBe(404);
    expect((await request(server()).post('/api/izl/me/reservations').set('Authorization', `Bearer ${token}`).send({ amountIzl: 1 })).status).toBe(404);
  });
});
