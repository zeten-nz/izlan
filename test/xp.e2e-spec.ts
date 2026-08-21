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

describe('XP reward (e2e, izlan_test)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  const sms = new TestSmsAdapter();
  const clock = { current: new Date('2026-08-20T06:00:00.000Z'), now() { return this.current; } }; // Asia/Tashkent +5 → local 11:00 Aug 20
  let n = 0;
  let so = 0;
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
    await cleanupAuthTables(prisma);
  }
  const server = () => app.getHttpServer();

  async function makeLearner(phone: string, timezone = 'Asia/Tashkent') {
    await prisma.otpChallenge.updateMany({ where: { phone }, data: { createdAt: new Date(Date.now() - 300_000) } });
    const req = await request(server()).post('/api/auth/otp/request').send({ phone });
    const verify = await request(server()).post('/api/auth/otp/verify').send({ challengeId: req.body.challengeId, code: sms.latestCode() });
    const user = await prisma.user.findUnique({ where: { phone } });
    await prisma.userProfile.update({ where: { userId: user!.id }, data: { displayName: 'A', dateOfBirth: new Date('2005-01-01'), timezone, onboardingCompletedAt: new Date() } });
    return { token: verify.body.accessToken, userId: user!.id };
  }
  const objPayload = () => ({ schemaVersion: LESSON_ACTIVITY_OBJECTIVE_SCHEMA_VERSION, format: 'single_choice', prompt: 'Q', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], answerKey: { correctOptionIds: ['a'] } });
  async function setup(creatorId: string, type: ActivityType = ActivityType.PRACTICE) {
    const s = await prisma.subject.create({ data: { slug: `s-${uid()}`, title: 'E', status: ContainerStatus.PUBLISHED, sortOrder: nx(), createdBy: creatorId } });
    const t = await prisma.track.create({ data: { subjectId: s.id, slug: `t-${uid()}`, title: 'T', status: ContainerStatus.PUBLISHED, sortOrder: nx(), createdBy: creatorId } });
    const level = await prisma.level.create({ data: { trackId: t.id, code: `C-${uid()}`, title: 'L', sortOrder: nx(), status: ContainerStatus.PUBLISHED, createdBy: creatorId } });
    const mod = await prisma.module.create({ data: { levelId: level.id, title: 'M', sortOrder: nx(), status: ContainerStatus.PUBLISHED, createdBy: creatorId } });
    const topic = await prisma.topic.create({ data: { moduleId: mod.id, title: 'Top', sortOrder: nx(), status: ContainerStatus.PUBLISHED, createdBy: creatorId } });
    const lesson = await prisma.lesson.create({ data: { topicId: topic.id, slug: `l-${uid()}`, sortOrder: nx(), status: LessonStatus.PUBLISHED, createdBy: creatorId } });
    const rev = await prisma.lessonRevision.create({ data: { lessonId: lesson.id, version: 1, title: 'V1', status: RevisionStatus.PUBLISHED, createdBy: creatorId, publishedAt: new Date() } });
    await prisma.lesson.update({ where: { id: lesson.id }, data: { publishedRevisionId: rev.id } });
    const activity = await prisma.activity.create({ data: { lessonRevisionId: rev.id, type, position: 1, payload: objPayload(), source: ContentSource.HUMAN } });
    return { lessonId: lesson.id, revisionId: rev.id, activityId: activity.id };
  }
  const seedProgress = (userId: string, lessonId: string, revisionId: string) => prisma.learnerLessonProgress.create({ data: { userId, lessonId, lessonRevisionId: revisionId, status: 'IN_PROGRESS' } });
  const submitNormal = (token: string, lessonId: string, activityId: string, correct: boolean, rid = randomUUID()) =>
    request(server()).post(`/api/lesson-executions/${lessonId}/activities/${activityId}/attempts`).set('Authorization', `Bearer ${token}`).send({ clientRequestId: rid, answer: { selectedOptionId: correct ? 'a' : 'b' } });
  const seedCompletion = (userId: string, o: { missionCode: string; policyVersion: string; localDate: string; completedAt?: Date }) =>
    prisma.dailyMissionCompletion.create({ data: { userId, missionCode: o.missionCode, policyVersion: o.policyVersion, localDate: new Date(o.localDate), timezoneSnapshot: 'Asia/Tashkent', completedAt: o.completedAt ?? new Date('2026-08-20T05:00:00Z') }, select: { id: true } });
  const getXp = (token: string) => request(server()).get('/api/xp/me').set('Authorization', `Bearer ${token}`);
  const reconcileXp = (token: string) => request(server()).post('/api/xp/me/reconcile').set('Authorization', `Bearer ${token}`);
  const grants = (userId: string) => prisma.xpGrant.findMany({ where: { userId }, orderBy: { amount: 'asc' } });

  // ───────────────────────────────────────────────────────────────────────────

  it('§47 LEARN_TODAY completion → one 10-XP grant with typed provenance; GET /xp/me = 10', async () => {
    const { token, userId } = await makeLearner('+998900008001');
    const c = await setup(userId, ActivityType.PRACTICE);
    await seedProgress(userId, c.lessonId, c.revisionId);
    await submitNormal(token, c.lessonId, c.activityId, false); // wrong still earns LEARN_TODAY

    const rows = await grants(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amount: 10, reasonCode: 'DAILY_MISSION', policyVersionCode: 'daily-mission-xp-reward-v1' });
    expect(rows[0].dailyMissionCompletionId).toBeTruthy();
    expect((await getXp(token)).body).toMatchObject({ totalXp: 10 });
  });

  it('§48/§49 MASTERY_TEST correct → both missions → 10 + 20; GET = 30', async () => {
    const { token, userId } = await makeLearner('+998900008002');
    const c = await setup(userId, ActivityType.MASTERY_TEST);
    await seedProgress(userId, c.lessonId, c.revisionId);
    await submitNormal(token, c.lessonId, c.activityId, true);

    expect((await grants(userId)).map((g) => g.amount)).toEqual([10, 20]);
    expect((await getXp(token)).body).toMatchObject({ totalXp: 30 });
  });

  it('§50 many attempts same day → one 10-XP LEARN_TODAY grant (no attempt farming)', async () => {
    const { token, userId } = await makeLearner('+998900008003');
    const c = await setup(userId, ActivityType.PRACTICE);
    await seedProgress(userId, c.lessonId, c.revisionId);
    for (let i = 0; i < 5; i++) await submitNormal(token, c.lessonId, c.activityId, false);
    expect((await getXp(token)).body).toMatchObject({ totalXp: 10 });
  });

  it('§51 mastery retry (wrong then correct) → one 20-XP mastery grant', async () => {
    const { token, userId } = await makeLearner('+998900008004');
    const c = await setup(userId, ActivityType.MASTERY_TEST);
    await seedProgress(userId, c.lessonId, c.revisionId);
    await submitNormal(token, c.lessonId, c.activityId, false); // LEARN_TODAY (wrong counts)
    await submitNormal(token, c.lessonId, c.activityId, true); // MASTERY_TEST_90
    const rows = await grants(userId);
    expect(rows.filter((g) => g.amount === 20)).toHaveLength(1);
    expect((await getXp(token)).body).toMatchObject({ totalXp: 30 });
  });

  it('§52 next local day → distinct completions grant distinct XP (30 + 30 = 60)', async () => {
    const { token, userId } = await makeLearner('+998900008005');
    await seedCompletion(userId, { missionCode: 'LEARN_TODAY', policyVersion: 'learn-today-mission-v1', localDate: '2026-08-19' });
    await seedCompletion(userId, { missionCode: 'MASTERY_TEST_90', policyVersion: 'mastery-test-90-mission-v1', localDate: '2026-08-19' });
    await seedCompletion(userId, { missionCode: 'LEARN_TODAY', policyVersion: 'learn-today-mission-v1', localDate: '2026-08-20' });
    await seedCompletion(userId, { missionCode: 'MASTERY_TEST_90', policyVersion: 'mastery-test-90-mission-v1', localDate: '2026-08-20' });
    await reconcileXp(token);
    expect((await getXp(token)).body).toMatchObject({ totalXp: 60 });
    expect(await prisma.xpGrant.count({ where: { userId } })).toBe(4);
  });

  it('§53/§54 unsupported mission code OR unknown producer version → no XP', async () => {
    const { token, userId } = await makeLearner('+998900008006');
    await seedCompletion(userId, { missionCode: 'ATTENTION_CHECK', policyVersion: 'attention-check-v1', localDate: '2026-08-20' }); // unknown code
    await seedCompletion(userId, { missionCode: 'LEARN_TODAY', policyVersion: 'learn-today-mission-v2', localDate: '2026-08-20' }); // known code, unknown version
    const body = (await reconcileXp(token)).body;
    expect(body).toMatchObject({ totalXp: 0, grantsCreated: 0 });
    expect(await prisma.xpGrant.count({ where: { userId } })).toBe(0);
  });

  it('§60/§35 reconcile repairs a completion missing XP; idempotent on repeat', async () => {
    const { token, userId } = await makeLearner('+998900008007');
    await seedCompletion(userId, { missionCode: 'LEARN_TODAY', policyVersion: 'learn-today-mission-v1', localDate: '2026-08-20' });
    expect((await getXp(token)).body).toMatchObject({ totalXp: 0 }); // seeded directly, no bridge ran

    expect((await reconcileXp(token)).body).toMatchObject({ totalXp: 10, grantsCreated: 1 });
    expect((await reconcileXp(token)).body).toMatchObject({ totalXp: 10, grantsCreated: 0 }); // idempotent
    expect(await prisma.xpGrant.count({ where: { userId } })).toBe(1);
  });

  it('§61 historical reconcile uses the frozen mission completion (prior local day)', async () => {
    const { token, userId } = await makeLearner('+998900008008');
    await seedCompletion(userId, { missionCode: 'MASTERY_TEST_90', policyVersion: 'mastery-test-90-mission-v1', localDate: '2026-08-15', completedAt: new Date('2026-08-15T05:00:00Z') });
    clock.current = new Date('2026-08-20T06:00:00.000Z'); // "now" is days later
    expect((await reconcileXp(token)).body).toMatchObject({ totalXp: 20, grantsCreated: 1 });
  });

  it('§57/§59 concurrent reconcile → one grant per completion, no double XP', async () => {
    const { token, userId } = await makeLearner('+998900008009');
    await seedCompletion(userId, { missionCode: 'LEARN_TODAY', policyVersion: 'learn-today-mission-v1', localDate: '2026-08-20' });
    await seedCompletion(userId, { missionCode: 'MASTERY_TEST_90', policyVersion: 'mastery-test-90-mission-v1', localDate: '2026-08-20' });
    const [a, b] = await Promise.all([reconcileXp(token), reconcileXp(token)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect((await getXp(token)).body).toMatchObject({ totalXp: 30 });
    expect(await prisma.xpGrant.count({ where: { userId } })).toBe(2);
  });

  it('§63 totalXp reflects the full XpGrant history including corrections', async () => {
    const { token, userId } = await makeLearner('+998900008010');
    await seedCompletion(userId, { missionCode: 'LEARN_TODAY', policyVersion: 'learn-today-mission-v1', localDate: '2026-08-20' });
    await seedCompletion(userId, { missionCode: 'MASTERY_TEST_90', policyVersion: 'mastery-test-90-mission-v1', localDate: '2026-08-20' });
    await reconcileXp(token); // +30 mission XP
    await prisma.xpGrant.create({ data: { userId, amount: -5, reasonCode: 'ADMIN_CORRECTION' } }); // non-mission correction row
    expect((await getXp(token)).body).toMatchObject({ totalXp: 25 });
  });

  it('§64/§65/§43 XpBalance, RewardGrant and IZL untouched by mission XP', async () => {
    const { token, userId } = await makeLearner('+998900008011');
    const c = await setup(userId, ActivityType.MASTERY_TEST);
    await seedProgress(userId, c.lessonId, c.revisionId);
    const before = { rewards: await prisma.rewardGrant.count(), wallets: await prisma.iZLWallet.count(), ledger: await prisma.iZLLedgerEntry.count() };
    await submitNormal(token, c.lessonId, c.activityId, true);
    await reconcileXp(token);
    const after = { rewards: await prisma.rewardGrant.count(), wallets: await prisma.iZLWallet.count(), ledger: await prisma.iZLLedgerEntry.count() };
    expect(after).toEqual(before); // RewardGrant / IZL untouched by XP (TD-142)
    // Phase 2.0D: XpBalance IS now written — a projection of XpGrant, not IZL (§80 supersedes the 2.0C zero-write boundary).
    expect(await prisma.xpBalance.findUnique({ where: { userId } })).toMatchObject({ totalXp: 30, currentLevel: 1, progressionVersionCode: 'xp-progression-v1' });
    expect((await getXp(token)).body).toMatchObject({ totalXp: 30 });
  });

  it('§66/§69 cross-user: another learner reconcile never grants for a victim completion', async () => {
    const victim = await makeLearner('+998900008012');
    await seedCompletion(victim.userId, { missionCode: 'LEARN_TODAY', policyVersion: 'learn-today-mission-v1', localDate: '2026-08-20' });
    const attacker = await makeLearner('+998900008013');
    expect((await reconcileXp(attacker.token)).body).toMatchObject({ totalXp: 0, grantsCreated: 0 });
    expect(await prisma.xpGrant.count({ where: { userId: victim.userId } })).toBe(0); // victim untouched
    expect((await getXp(attacker.token)).body).toMatchObject({ totalXp: 0 });
  });

  it('§34/§68 zero state 200 (not 404); unauth 401; no raw evidence leak', async () => {
    const { token } = await makeLearner('+998900008014');
    const z = await getXp(token);
    expect(z.status).toBe(200);
    expect(z.body).toMatchObject({ totalXp: 0 });
    expect(JSON.stringify(z.body)).not.toMatch(/answerKey|correctOptionIds|activityId|completionId|reward|izl/i);
    expect((await request(server()).get('/api/xp/me')).status).toBe(401);
    expect((await request(server()).post('/api/xp/me/reconcile')).status).toBe(401);
  });

  it('§67 network replay (same clientRequestId) → one attempt, one completion, one 10-XP grant', async () => {
    const { token, userId } = await makeLearner('+998900008015');
    const c = await setup(userId, ActivityType.PRACTICE);
    await seedProgress(userId, c.lessonId, c.revisionId);
    const rid = randomUUID();
    await submitNormal(token, c.lessonId, c.activityId, false, rid);
    await submitNormal(token, c.lessonId, c.activityId, false, rid);
    expect(await prisma.activityAttempt.count({ where: { userId } })).toBe(1);
    expect(await prisma.xpGrant.count({ where: { userId } })).toBe(1);
    expect((await getXp(token)).body).toMatchObject({ totalXp: 10 });
  });

  // ── Phase 2.0D — XP progression ─────────────────────────────────────────────
  const seedGrant = (userId: string, amount: number) => prisma.xpGrant.create({ data: { userId, amount, reasonCode: 'TEST_SEED' } }); // non-mission grant (completion FK NULL)
  const balance = (userId: string) => prisma.xpBalance.findUnique({ where: { userId } });

  it('§31/§70 first mission grant → GET progression + XpBalance projection (10 / L1 / v1)', async () => {
    const { token, userId } = await makeLearner('+998900008101');
    const c = await setup(userId, ActivityType.PRACTICE);
    await seedProgress(userId, c.lessonId, c.revisionId);
    await submitNormal(token, c.lessonId, c.activityId, false); // bridge grants XP + recomputes projection

    expect((await getXp(token)).body).toMatchObject({ totalXp: 10, progressionXp: 10, currentLevel: 1, currentLevelStartXp: 0, nextLevelXp: 100, xpIntoLevel: 10, xpToNextLevel: 90, progressBp: 1000, progressionVersion: 'xp-progression-v1' });
    expect(await balance(userId)).toMatchObject({ totalXp: 10, currentLevel: 1, progressionVersionCode: 'xp-progression-v1' });
  });

  it('§32-35 level boundaries: seeded totals 100→L2, 300→L3, 4500→L10 (GET + projection agree)', async () => {
    for (const [phone, total, level] of [['+998900008102', 100, 2], ['+998900008103', 300, 3], ['+998900008104', 4500, 10]] as const) {
      const { token, userId } = await makeLearner(phone);
      await seedGrant(userId, total);
      const body = (await reconcileXp(token)).body;
      expect(body).toMatchObject({ totalXp: total, currentLevel: level });
      expect(await balance(userId)).toMatchObject({ totalXp: total, currentLevel: level, progressionVersionCode: 'xp-progression-v1' });
    }
  });

  it('§36 negative total: signed totalXp preserved, progression clamped, L1', async () => {
    const { token, userId } = await makeLearner('+998900008105');
    await seedGrant(userId, 50);
    await seedGrant(userId, -80); // total -30
    const body = (await reconcileXp(token)).body;
    expect(body).toMatchObject({ totalXp: -30, progressionXp: 0, currentLevel: 1, progressBp: 0 });
    expect(await balance(userId)).toMatchObject({ totalXp: -30, currentLevel: 1 }); // accounting total not clamped in cache
  });

  it('§37/§8 level DOWN after a negative correction (no highest-level persistence)', async () => {
    const { token, userId } = await makeLearner('+998900008106');
    await seedGrant(userId, 310);
    expect((await reconcileXp(token)).body).toMatchObject({ currentLevel: 3 });
    await seedGrant(userId, -50); // total 260
    expect((await reconcileXp(token)).body).toMatchObject({ totalXp: 260, currentLevel: 2 });
    expect(await balance(userId)).toMatchObject({ totalXp: 260, currentLevel: 2 });
  });

  it('§26/§27/§57 GET is canonical from XpGrant and never repairs a stale cache', async () => {
    const { token, userId } = await makeLearner('+998900008107');
    await seedGrant(userId, 300); // canonical L3, no bridge/reconcile ran
    await prisma.xpBalance.create({ data: { userId, totalXp: 10, currentLevel: 1, progressionVersionCode: 'xp-progression-v1' } }); // stale cache

    expect((await getXp(token)).body).toMatchObject({ totalXp: 300, currentLevel: 3 }); // canonical, NOT the stale 10/L1
    expect(await balance(userId)).toMatchObject({ totalXp: 10, currentLevel: 1 }); // GET did not mutate the stale row

    expect((await reconcileXp(token)).body).toMatchObject({ totalXp: 300, currentLevel: 3 });
    expect(await balance(userId)).toMatchObject({ totalXp: 300, currentLevel: 3 }); // reconcile repaired the cache
  });

  it('§52 stale/unversioned projection is upgraded to xp-progression-v1 on reconcile', async () => {
    const { token, userId } = await makeLearner('+998900008108');
    await seedGrant(userId, 100);
    await prisma.xpBalance.create({ data: { userId, totalXp: 100, currentLevel: 2, progressionVersionCode: null } }); // unversioned
    await reconcileXp(token);
    expect(await balance(userId)).toMatchObject({ totalXp: 100, currentLevel: 2, progressionVersionCode: 'xp-progression-v1' });
  });

  it('§75/§76 zero state read-only: GET returns L1/0 and never creates an XpBalance row', async () => {
    const { token, userId } = await makeLearner('+998900008109');
    expect((await getXp(token)).body).toMatchObject({ totalXp: 0, currentLevel: 1, nextLevelXp: 100, progressBp: 0, progressionVersion: 'xp-progression-v1' });
    expect(await balance(userId)).toBeNull(); // GET wrote nothing
    await getXp(token);
    expect(await prisma.xpBalance.count({ where: { userId } })).toBe(0);
  });

  it('§47/§73 concurrent reconcile converges the projection to the full canonical sum', async () => {
    const { token, userId } = await makeLearner('+998900008110');
    await seedGrant(userId, 120);
    await seedGrant(userId, 200); // total 320 → L3
    const [a, b] = await Promise.all([reconcileXp(token), reconcileXp(token)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(await balance(userId)).toMatchObject({ totalXp: 320, currentLevel: 3, progressionVersionCode: 'xp-progression-v1' });
    expect((await getXp(token)).body).toMatchObject({ totalXp: 320, currentLevel: 3 });
  });

  it('§38/§77 level-up has zero side effects (no reward/IZL/notification/new grant)', async () => {
    const { token, userId } = await makeLearner('+998900008111');
    await seedGrant(userId, 99); // L1
    const before = { grants: await prisma.xpGrant.count({ where: { userId } }), rewards: await prisma.rewardGrant.count(), wallets: await prisma.iZLWallet.count(), notes: await prisma.notification.count() };
    await seedGrant(userId, 1); // now 100 → crosses into L2
    await reconcileXp(token);
    expect((await getXp(token)).body).toMatchObject({ currentLevel: 2 });
    const after = { grants: await prisma.xpGrant.count({ where: { userId } }), rewards: await prisma.rewardGrant.count(), wallets: await prisma.iZLWallet.count(), notes: await prisma.notification.count() };
    expect(after).toEqual({ ...before, grants: before.grants + 1 }); // only the seeded grant; level-up produced nothing
  });
});
