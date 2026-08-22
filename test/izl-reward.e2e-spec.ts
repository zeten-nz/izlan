import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ActivityType, ContainerStatus, ContentSource, LessonStatus, RevisionStatus } from '@prisma/client';
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
import { LESSON_ACTIVITY_OBJECTIVE_SCHEMA_VERSION } from '../src/lesson-execution/activity/objective-activity-payload';

describe('IZL economic reward (e2e, izlan_test)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  const sms = new TestSmsAdapter();
  const clock = { current: new Date('2026-08-20T06:00:00.000Z'), now() { return this.current; } }; // inside the default cycle period
  let n = 0;
  let so = 0;
  let ver = 100;
  const uid = () => `${Date.now()}-${n++}`;
  const nx = () => so++;

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
    await prisma.iZLLedgerEntry.deleteMany();
    await prisma.rewardGrant.deleteMany();
    await prisma.subscriptionCycle.deleteMany();
    await prisma.subscription.deleteMany();
    await prisma.planPrice.deleteMany();
    await prisma.subscriptionPlan.deleteMany();
    await prisma.rewardPolicyVersion.deleteMany();
    await prisma.xpGrant.deleteMany();
    await prisma.dailyMissionCompletionEvidence.deleteMany();
    await prisma.dailyMissionCompletion.deleteMany();
    await prisma.activityAttempt.deleteMany();
    await prisma.learnerLessonProgress.deleteMany();
    await prisma.activity.deleteMany();
    await prisma.lesson.updateMany({ data: { publishedRevisionId: null } });
    await prisma.lessonRevision.deleteMany();
    await prisma.lesson.deleteMany();
    await prisma.topic.deleteMany();
    await prisma.module.deleteMany();
    await prisma.level.deleteMany();
    await prisma.track.deleteMany();
    await prisma.subject.deleteMany();
    await cleanupAuthTables(prisma); // clears xpGrant + xpBalance too
  }
  const server = () => app.getHttpServer();

  async function makeLearner(phone: string, timezone = 'Asia/Tashkent') {
    await prisma.otpChallenge.updateMany({ where: { phone }, data: { createdAt: new Date(Date.now() - 300_000) } });
    const req = await request(server()).post('/api/auth/otp/request').send({ phone });
    const verify = await request(server()).post('/api/auth/register').send({ challengeId: req.body.challengeId, code: sms.latestCode(), password: 'Passw0rd!123' });
    const user = await prisma.user.findUnique({ where: { phone } });
    await prisma.userProfile.update({ where: { userId: user!.id }, data: { displayName: 'A', dateOfBirth: new Date('2005-01-01'), timezone, onboardingCompletedAt: new Date() } });
    return { token: verify.body.accessToken, userId: user!.id };
  }
  const izlConfig = (amountIzl = 1, dailyCap = 1, cycleCap = 30) => ({ schemaVersion: 'izl-reward-policy/v1', dailyMissionRewards: { MASTERY_TEST_90: { missionPolicyVersion: 'mastery-test-90-mission-v1', amountIzl } }, caps: { dailyMissionIzlPerLocalDate: dailyCap, dailyMissionIzlPerCycle: cycleCap } });
  const seedPolicy = (createdBy: string, config: object, status: 'ACTIVE' | 'ARCHIVED' | 'DRAFT' = 'ACTIVE') => prisma.rewardPolicyVersion.create({ data: { version: ver++, status, config, effectiveFrom: new Date('2026-08-01T00:00:00Z'), createdBy }, select: { id: true } });
  async function seedSub(userId: string) {
    const plan = await prisma.subscriptionPlan.create({ data: { code: `PLAN-${uid()}`, name: 'T', sortOrder: nx() } });
    const price = await prisma.planPrice.create({ data: { planId: plan.id, amount: 100000, billingPeriodMonths: 1, effectiveFrom: new Date('2026-08-01T00:00:00Z'), createdBy: userId } });
    const sub = await prisma.subscription.create({ data: { userId, planId: plan.id } });
    return { planId: plan.id, priceId: price.id, subId: sub.id };
  }
  const seedCycle = (sub: { subId: string; planId: string; priceId: string }, o: { policyVersionId: string; periodStart: string; periodEnd: string; seq: number }) =>
    prisma.subscriptionCycle.create({ data: { subscriptionId: sub.subId, sequenceNo: o.seq, periodStart: new Date(o.periodStart), periodEnd: new Date(o.periodEnd), planId: sub.planId, planPriceId: sub.priceId, grossPriceUzs: 100000, paidAmountUzs: 100000, rewardBasisUzs: 100000, rewardCeilingUzs: 20000, rewardPolicyVersionId: o.policyVersionId, izlRateSnapshot: 1000, rewardCeilingIzl: 1000 }, select: { id: true } });
  // Single standard cycle 2026-08-01..2026-09-01 with the given (or default) config.
  async function seedEconomy(userId: string, config: object = izlConfig()) {
    const policy = await seedPolicy(userId, config);
    const sub = await seedSub(userId);
    const cycle = await seedCycle(sub, { policyVersionId: policy.id, periodStart: '2026-08-01T00:00:00Z', periodEnd: '2026-09-01T00:00:00Z', seq: 1 });
    return { policyId: policy.id, cycleId: cycle.id, sub };
  }
  const seedCompletion = (userId: string, o: { missionCode?: string; policyVersion?: string; localDate: string; completedAt: string }) =>
    prisma.dailyMissionCompletion.create({ data: { userId, missionCode: o.missionCode ?? 'MASTERY_TEST_90', policyVersion: o.policyVersion ?? 'mastery-test-90-mission-v1', localDate: new Date(o.localDate), timezoneSnapshot: 'Asia/Tashkent', completedAt: new Date(o.completedAt) }, select: { id: true } });

  async function setupLesson(creatorId: string, type: ActivityType) {
    const s = await prisma.subject.create({ data: { slug: `s-${uid()}`, title: 'E', status: ContainerStatus.PUBLISHED, sortOrder: nx(), createdBy: creatorId } });
    const t = await prisma.track.create({ data: { subjectId: s.id, slug: `t-${uid()}`, title: 'T', status: ContainerStatus.PUBLISHED, sortOrder: nx(), createdBy: creatorId } });
    const level = await prisma.level.create({ data: { trackId: t.id, code: `C-${uid()}`, title: 'L', sortOrder: nx(), status: ContainerStatus.PUBLISHED, createdBy: creatorId } });
    const mod = await prisma.module.create({ data: { levelId: level.id, title: 'M', sortOrder: nx(), status: ContainerStatus.PUBLISHED, createdBy: creatorId } });
    const topic = await prisma.topic.create({ data: { moduleId: mod.id, title: 'Top', sortOrder: nx(), status: ContainerStatus.PUBLISHED, createdBy: creatorId } });
    const lesson = await prisma.lesson.create({ data: { topicId: topic.id, slug: `l-${uid()}`, contentKey: `ck-${uid()}`, sortOrder: nx(), status: LessonStatus.PUBLISHED, createdBy: creatorId } });
    const rev = await prisma.lessonRevision.create({ data: { lessonId: lesson.id, version: 1, title: 'V1', status: RevisionStatus.PUBLISHED, createdBy: creatorId, publishedAt: new Date() } });
    await prisma.lesson.update({ where: { id: lesson.id }, data: { publishedRevisionId: rev.id } });
    const activity = await prisma.activity.create({ data: { lessonRevisionId: rev.id, type, position: 1, payload: { schemaVersion: LESSON_ACTIVITY_OBJECTIVE_SCHEMA_VERSION, format: 'single_choice', prompt: 'Q', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], answerKey: { correctOptionIds: ['a'] } }, source: ContentSource.HUMAN } });
    await prisma.learnerLessonProgress.create({ data: { userId: creatorId, lessonId: lesson.id, lessonRevisionId: rev.id, status: 'IN_PROGRESS' } });
    return { lessonId: lesson.id, activityId: activity.id };
  }
  const submit = (token: string, lessonId: string, activityId: string, correct: boolean, rid = randomUUID()) =>
    request(server()).post(`/api/lesson-executions/${lessonId}/activities/${activityId}/attempts`).set('Authorization', `Bearer ${token}`).send({ clientRequestId: rid, answer: { selectedOptionId: correct ? 'a' : 'b' } });
  const getIzl = (token: string) => request(server()).get('/api/izl/me').set('Authorization', `Bearer ${token}`);
  const reconcileIzl = (token: string) => request(server()).post('/api/izl/me/reconcile').set('Authorization', `Bearer ${token}`);
  const grants = (userId: string) => prisma.rewardGrant.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
  const ledger = (userId: string) => prisma.iZLLedgerEntry.findMany({ where: { userId }, orderBy: { entryNo: 'asc' } });

  // ───────────────────────────────────────────────────────────────────────────

  it('§59/§37 MASTERY_TEST_90 in a valid cycle (automatic bridge) → RewardGrant 1 IZL + EARN ledger; GET = 1', async () => {
    const { token, userId } = await makeLearner('+998900009001');
    await seedEconomy(userId);
    const c = await setupLesson(userId, ActivityType.MASTERY_TEST);
    await submit(token, c.lessonId, c.activityId, true); // bridge: mission completion → XP + IZL

    const g = await grants(userId);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ amount: 1, category: 'DAILY_MISSION', status: 'GRANTED' });
    expect(g[0].missionCompletionId).toBeTruthy();
    expect(g[0].subscriptionCycleId).toBeTruthy();
    const l = await ledger(userId);
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ entryType: 'EARN', amount: 1, balanceAfter: 1, rewardGrantId: g[0].id });
    expect((await getIzl(token)).body).toMatchObject({ balanceIzl: 1 });
  });

  it('§58 LEARN_TODAY completion earns zero IZL', async () => {
    const { token, userId } = await makeLearner('+998900009002');
    await seedEconomy(userId);
    await seedCompletion(userId, { missionCode: 'LEARN_TODAY', policyVersion: 'learn-today-mission-v1', localDate: '2026-08-20', completedAt: '2026-08-20T05:00:00Z' });
    expect((await reconcileIzl(token)).body).toMatchObject({ balanceIzl: 0, grantsCreated: 0 });
    expect(await prisma.rewardGrant.count({ where: { userId } })).toBe(0);
  });

  it('§60 unknown mission producer version → no IZL', async () => {
    const { token, userId } = await makeLearner('+998900009003');
    await seedEconomy(userId);
    await seedCompletion(userId, { policyVersion: 'mastery-test-90-mission-v2', localDate: '2026-08-20', completedAt: '2026-08-20T05:00:00Z' });
    expect((await reconcileIzl(token)).body).toMatchObject({ balanceIzl: 0, grantsCreated: 0 });
  });

  it('§61/§12 no covering SubscriptionCycle → no IZL (mission/XP unaffected)', async () => {
    const { token, userId } = await makeLearner('+998900009004');
    // NO economy seeded
    await seedCompletion(userId, { localDate: '2026-08-20', completedAt: '2026-08-20T05:00:00Z' });
    expect((await reconcileIzl(token)).body).toMatchObject({ balanceIzl: 0, grantsCreated: 0 });
    expect(await prisma.rewardGrant.count({ where: { userId } })).toBe(0);
  });

  it('§62 historical cycle: grant uses the cycle covering completedAt, never the current one', async () => {
    const { token, userId } = await makeLearner('+998900009005');
    const policy = await seedPolicy(userId, izlConfig());
    const sub = await seedSub(userId);
    const cycleA = await seedCycle(sub, { policyVersionId: policy.id, periodStart: '2026-07-01T00:00:00Z', periodEnd: '2026-08-01T00:00:00Z', seq: 1 }); // historical
    await seedCycle(sub, { policyVersionId: policy.id, periodStart: '2026-08-01T00:00:00Z', periodEnd: '2026-09-01T00:00:00Z', seq: 2 }); // current
    await seedCompletion(userId, { localDate: '2026-07-15', completedAt: '2026-07-15T05:00:00Z' }); // inside Cycle A

    await reconcileIzl(token);
    const g = await grants(userId);
    expect(g).toHaveLength(1);
    expect(g[0].subscriptionCycleId).toBe(cycleA.id); // historical cycle, not the current one
  });

  it('§63 policy snapshot: historical cycle keeps its own policy amount even when a newer policy exists', async () => {
    const { token, userId } = await makeLearner('+998900009006');
    const oldPolicy = await seedPolicy(userId, izlConfig(1), 'ARCHIVED'); // Cycle A snapshot: 1 IZL (later archived)
    await seedPolicy(userId, izlConfig(2), 'ACTIVE'); // a newer ACTIVE policy says 2 — must NOT be used for Cycle A
    const sub = await seedSub(userId);
    const cycleA = await seedCycle(sub, { policyVersionId: oldPolicy.id, periodStart: '2026-08-01T00:00:00Z', periodEnd: '2026-09-01T00:00:00Z', seq: 1 });
    await seedCompletion(userId, { localDate: '2026-08-20', completedAt: '2026-08-20T05:00:00Z' });

    await reconcileIzl(token);
    const g = await grants(userId);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ amount: 1, rewardPolicyVersionId: oldPolicy.id, subscriptionCycleId: cycleA.id }); // still 1, cycle-A policy
  });

  it('§65/§26 cycle cap: caps total DAILY_MISSION IZL per cycle; excess candidates get no grant (all-or-nothing)', async () => {
    const { token, userId } = await makeLearner('+998900009007');
    await seedEconomy(userId, izlConfig(1, 1, 3)); // cycle cap = 3
    for (const d of ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13']) await seedCompletion(userId, { localDate: d, completedAt: `${d}T05:00:00Z` });

    const body = (await reconcileIzl(token)).body;
    expect(body).toMatchObject({ balanceIzl: 3, grantsCreated: 3 }); // 4th refused at cap
    expect(await prisma.rewardGrant.count({ where: { userId } })).toBe(3);
  });

  it('§66 next cycle resets the cap by SubscriptionCycle identity', async () => {
    const { token, userId } = await makeLearner('+998900009008');
    const policy = await seedPolicy(userId, izlConfig(1, 1, 1)); // cap 1 per cycle
    const sub = await seedSub(userId);
    await seedCycle(sub, { policyVersionId: policy.id, periodStart: '2026-08-01T00:00:00Z', periodEnd: '2026-08-15T00:00:00Z', seq: 1 });
    await seedCycle(sub, { policyVersionId: policy.id, periodStart: '2026-08-15T00:00:00Z', periodEnd: '2026-09-01T00:00:00Z', seq: 2 });
    await seedCompletion(userId, { localDate: '2026-08-05', completedAt: '2026-08-05T05:00:00Z' }); // cycle 1
    await seedCompletion(userId, { localDate: '2026-08-20', completedAt: '2026-08-20T05:00:00Z' }); // cycle 2

    expect((await reconcileIzl(token)).body).toMatchObject({ balanceIzl: 2, grantsCreated: 2 }); // 1 per cycle
  });

  it('§67/§76 dedup + reconcile repair idempotency → one grant, one ledger entry', async () => {
    const { token, userId } = await makeLearner('+998900009009');
    await seedEconomy(userId);
    await seedCompletion(userId, { localDate: '2026-08-20', completedAt: '2026-08-20T05:00:00Z' });
    expect((await reconcileIzl(token)).body).toMatchObject({ balanceIzl: 1, grantsCreated: 1 });
    expect((await reconcileIzl(token)).body).toMatchObject({ balanceIzl: 1, grantsCreated: 0 }); // idempotent
    expect(await prisma.rewardGrant.count({ where: { userId } })).toBe(1);
    expect(await prisma.iZLLedgerEntry.count({ where: { userId } })).toBe(1);
  });

  it('§68/§69 concurrent reconcile → one grant, one ledger credit (no double IZL)', async () => {
    const { token, userId } = await makeLearner('+998900009010');
    await seedEconomy(userId);
    await seedCompletion(userId, { localDate: '2026-08-20', completedAt: '2026-08-20T05:00:00Z' });
    const [a, b] = await Promise.all([reconcileIzl(token), reconcileIzl(token)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(await prisma.rewardGrant.count({ where: { userId } })).toBe(1);
    expect(await prisma.iZLLedgerEntry.count({ where: { userId } })).toBe(1);
    expect((await getIzl(token)).body).toMatchObject({ balanceIzl: 1 });
  });

  it('§70/§80 audit chain: every RewardGrant has exactly one EARN ledger entry (no orphans)', async () => {
    const { token, userId } = await makeLearner('+998900009011');
    await seedEconomy(userId, izlConfig(1, 1, 30));
    for (const d of ['2026-08-10', '2026-08-11', '2026-08-12']) await seedCompletion(userId, { localDate: d, completedAt: `${d}T05:00:00Z` });
    await reconcileIzl(token);
    const g = await grants(userId);
    const l = await ledger(userId);
    expect(g).toHaveLength(3);
    expect(l).toHaveLength(3);
    expect(new Set(l.map((e) => e.rewardGrantId))).toEqual(new Set(g.map((x) => x.id))); // 1:1, no orphan ledger / grant
    expect(l.map((e) => e.balanceAfter)).toEqual([1, 2, 3]); // running balance
  });

  it('§71 IZL failure (no cycle) does not break the XP branch', async () => {
    const { token, userId } = await makeLearner('+998900009012');
    // NO economy → IZL bridge is a no-op; XP must still be granted.
    const c = await setupLesson(userId, ActivityType.MASTERY_TEST);
    await submit(token, c.lessonId, c.activityId, true);
    expect((await getIzl(token)).body).toMatchObject({ balanceIzl: 0 });
    expect(await prisma.rewardGrant.count({ where: { userId } })).toBe(0);
    expect((await request(server()).get('/api/xp/me').set('Authorization', `Bearer ${token}`)).body).toMatchObject({ totalXp: 30 }); // 10 + 20
  });

  it('§74 GET reflects the signed ledger (earn + correction)', async () => {
    const { token, userId } = await makeLearner('+998900009013');
    await seedEconomy(userId);
    await seedCompletion(userId, { localDate: '2026-08-20', completedAt: '2026-08-20T05:00:00Z' });
    await reconcileIzl(token); // +1
    await prisma.iZLLedgerEntry.create({ data: { userId, entryNo: 2, entryType: 'ADJUSTMENT', amount: -1, balanceAfter: 0, reason: 'test-correction', actorUserId: userId } }); // fixture debit
    expect((await getIzl(token)).body).toMatchObject({ balanceIzl: 0 });
  });

  it('§75/§47 GET is read-only + zero state 200; §77/§79 IDOR / 401 / no leak', async () => {
    const { token, userId } = await makeLearner('+998900009014');
    const before = { grants: await prisma.rewardGrant.count(), ledger: await prisma.iZLLedgerEntry.count(), wallets: await prisma.iZLWallet.count() };
    const z = await getIzl(token);
    expect(z.status).toBe(200);
    expect(z.body).toMatchObject({ balanceIzl: 0 });
    expect(JSON.stringify(z.body)).not.toMatch(/answerKey|dedup|policy|cycle|reward|UZS|\$/i);
    const after = { grants: await prisma.rewardGrant.count(), ledger: await prisma.iZLLedgerEntry.count(), wallets: await prisma.iZLWallet.count() };
    expect(after).toEqual(before); // GET wrote nothing (no wallet either)

    const victim = userId;
    await seedEconomy(victim);
    await seedCompletion(victim, { localDate: '2026-08-20', completedAt: '2026-08-20T05:00:00Z' });
    const attacker = await makeLearner('+998900009015');
    expect((await reconcileIzl(attacker.token)).body).toMatchObject({ balanceIzl: 0, grantsCreated: 0 });
    expect(await prisma.rewardGrant.count({ where: { userId: victim } })).toBe(0); // attacker never posts victim's reward
    expect((await request(server()).get('/api/izl/me')).status).toBe(401);
    expect((await request(server()).post('/api/izl/me/reconcile')).status).toBe(401);
  });

  // ── Phase 2.1G-D — reward-disabled cycle + cycle economic ceiling ──

  async function seedDisabledCycle(userId: string) {
    const sub = await seedSub(userId);
    await prisma.subscriptionCycle.create({ data: { subscriptionId: sub.subId, sequenceNo: 1, periodStart: new Date('2026-08-01T00:00:00Z'), periodEnd: new Date('2026-09-01T00:00:00Z'), planId: sub.planId, planPriceId: sub.priceId, grossPriceUzs: 100000, paidAmountUzs: 100000, rewardBasisUzs: 100000, rewardCeilingUzs: 0, rewardPolicyVersionId: null, izlRateSnapshot: null, rewardCeilingIzl: 0 } });
  }
  async function seedCeilingCycle(userId: string, rewardCeilingIzl: number, config: object) {
    const policy = await seedPolicy(userId, config);
    const sub = await seedSub(userId);
    await prisma.subscriptionCycle.create({ data: { subscriptionId: sub.subId, sequenceNo: 1, periodStart: new Date('2026-08-01T00:00:00Z'), periodEnd: new Date('2026-09-01T00:00:00Z'), planId: sub.planId, planPriceId: sub.priceId, grossPriceUzs: 100000, paidAmountUzs: 100000, rewardBasisUzs: 100000, rewardCeilingUzs: 20000, rewardPolicyVersionId: policy.id, izlRateSnapshot: 1000, rewardCeilingIzl } });
  }

  it('§52/§14 reward-disabled cycle: mission + XP succeed, IZL grant = NONE, no rollback', async () => {
    const { token, userId } = await makeLearner('+998900009016');
    await seedDisabledCycle(userId); // policy NULL, rate NULL, ceiling 0
    const c = await setupLesson(userId, ActivityType.MASTERY_TEST);
    const res = await submit(token, c.lessonId, c.activityId, true);
    expect(res.status).toBe(200); // mission/XP branch unaffected
    expect((await request(server()).get('/api/xp/me').set('Authorization', `Bearer ${token}`)).body).toMatchObject({ totalXp: 30 });
    expect(await prisma.rewardGrant.count({ where: { userId } })).toBe(0); // no IZL earning
    expect(await prisma.iZLLedgerEntry.count({ where: { userId } })).toBe(0);
    expect((await getIzl(token)).body).toMatchObject({ balanceIzl: 0 });
    // reconcile also treats it as no-op (not an error)
    expect((await reconcileIzl(token)).body).toMatchObject({ balanceIzl: 0, grantsCreated: 0 });
  });

  it('§53/§15 cycle economic ceiling governs: min(policy 30, ceiling 2) → caps at 2 IZL', async () => {
    const { token, userId } = await makeLearner('+998900009017');
    await seedCeilingCycle(userId, 2, izlConfig(1, 1, 30)); // ceiling 2 < policy cycle cap 30
    for (const d of ['2026-08-10', '2026-08-11', '2026-08-12']) await seedCompletion(userId, { localDate: d, completedAt: `${d}T05:00:00Z` });
    expect((await reconcileIzl(token)).body).toMatchObject({ balanceIzl: 2, grantsCreated: 2 }); // 3rd refused at the economic ceiling
    expect(await prisma.rewardGrant.count({ where: { userId } })).toBe(2);
  });

  it('§54/§18 policy cap governs when smaller: min(policy 1, ceiling 1000) → caps at 1 IZL', async () => {
    const { token, userId } = await makeLearner('+998900009018');
    await seedCeilingCycle(userId, 1000, izlConfig(1, 1, 1)); // policy cycle cap 1 < ceiling 1000
    for (const d of ['2026-08-10', '2026-08-11']) await seedCompletion(userId, { localDate: d, completedAt: `${d}T05:00:00Z` });
    expect((await reconcileIzl(token)).body).toMatchObject({ balanceIzl: 1, grantsCreated: 1 }); // 2nd refused at the policy cap
  });
});
