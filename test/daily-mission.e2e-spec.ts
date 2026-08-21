import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ActivityAttemptStatus, ActivityType, ContainerStatus, ContentSource, LessonStatus, RevisionStatus } from '@prisma/client';
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

describe('Daily missions (e2e, izlan_test)', () => {
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
    await prisma.learnerReviewSessionActivity.deleteMany();
    await prisma.learnerReviewSession.deleteMany();
    await prisma.skillMeasurement.deleteMany();
    await prisma.learnerLessonProgress.deleteMany();
    await prisma.activity.deleteMany();
    await prisma.lesson.updateMany({ data: { publishedRevisionId: null } });
    await prisma.lessonRevision.deleteMany();
    await prisma.lesson.deleteMany();
    await prisma.topic.deleteMany();
    await prisma.module.deleteMany();
    await prisma.level.deleteMany();
    await prisma.track.deleteMany();
    await prisma.skill.deleteMany();
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
    return { subjectId: s.id, lessonId: lesson.id, revisionId: rev.id, activityId: activity.id };
  }
  let seq = 0;
  const seedAttempt = (userId: string, activityId: string, revisionId: string, o: { score: number; submittedAt: Date; reviewSessionId?: string | null }) =>
    prisma.activityAttempt.create({ data: { userId, activityId, lessonRevisionId: revisionId, attemptNo: ++seq, status: ActivityAttemptStatus.SUBMITTED, isCorrect: o.score >= 5000, deterministicScore: o.score, submittedAt: o.submittedAt, reviewSessionId: o.reviewSessionId ?? null } });
  const seedProgress = (userId: string, lessonId: string, revisionId: string) => prisma.learnerLessonProgress.create({ data: { userId, lessonId, lessonRevisionId: revisionId, status: 'IN_PROGRESS' } });
  const submitNormal = (token: string, lessonId: string, activityId: string, correct: boolean, rid = randomUUID()) =>
    request(server()).post(`/api/lesson-executions/${lessonId}/activities/${activityId}/attempts`).set('Authorization', `Bearer ${token}`).send({ clientRequestId: rid, answer: { selectedOptionId: correct ? 'a' : 'b' } });
  const getMissions = (token: string) => request(server()).get('/api/daily-missions/me/today').set('Authorization', `Bearer ${token}`);
  const reconcile = (token: string) => request(server()).post('/api/daily-missions/me/today/reconcile').set('Authorization', `Bearer ${token}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mission = (body: any, code: string): any => body.missions.find((m: any) => m.code === code);
  const completions = (userId: string, code?: string) => prisma.dailyMissionCompletion.count({ where: { userId, ...(code ? { missionCode: code } : {}) } });

  // ───────────────────────────────────────────────────────────────────────────

  it('§50/§59 normal wrong PRACTICE submit → LEARN_TODAY completed (not TEST_90); multiple attempts → one completion', async () => {
    const { token, userId } = await makeLearner('+998900007001');
    const c = await setup(userId, ActivityType.PRACTICE);
    await seedProgress(userId, c.lessonId, c.revisionId);
    await submitNormal(token, c.lessonId, c.activityId, false); // wrong
    await submitNormal(token, c.lessonId, c.activityId, false); // another wrong

    const body = (await getMissions(token)).body;
    expect(body).toMatchObject({ localDate: '2026-08-20', timezone: 'Asia/Tashkent' });
    expect(mission(body, 'LEARN_TODAY')).toMatchObject({ completed: true, policyVersion: 'learn-today-mission-v1' });
    expect(mission(body, 'MASTERY_TEST_90')).toMatchObject({ completed: false, completedAt: null });
    expect(await completions(userId, 'LEARN_TODAY')).toBe(1); // §59 one completion
  });

  it('§51/§16 normal correct MASTERY_TEST submit → both LEARN_TODAY and MASTERY_TEST_90', async () => {
    const { token, userId } = await makeLearner('+998900007002');
    const c = await setup(userId, ActivityType.MASTERY_TEST);
    await seedProgress(userId, c.lessonId, c.revisionId);
    await submitNormal(token, c.lessonId, c.activityId, true); // score 10000

    const body = (await getMissions(token)).body;
    expect(mission(body, 'LEARN_TODAY').completed).toBe(true);
    expect(mission(body, 'MASTERY_TEST_90')).toMatchObject({ completed: true, policyVersion: 'mastery-test-90-mission-v1' });
    expect(await completions(userId)).toBe(2); // two distinct mission rows from one attempt
  });

  it('§52/§53 review attempt (reviewSessionId set) qualifies via reconcile — LEARN_TODAY + TEST_90', async () => {
    const { token, userId } = await makeLearner('+998900007003');
    const c = await setup(userId, ActivityType.MASTERY_TEST);
    const skill = await prisma.skill.create({ data: { subjectId: c.subjectId, name: `Grammar-${uid()}`, sortOrder: nx() } });
    const rs = await prisma.learnerReviewSession.create({ data: { userId, skillId: skill.id, lessonId: c.lessonId, lessonRevisionId: c.revisionId, status: 'ACTIVE', provenance: { schemaVersion: 'review-session/v1', signalTypes: ['WEAK_SKILL'] } } });
    await seedAttempt(userId, c.activityId, c.revisionId, { score: 10000, submittedAt: new Date('2026-08-20T05:00:00Z'), reviewSessionId: rs.id }); // review-linked evidence

    const body = (await reconcile(token)).body;
    expect(mission(body, 'LEARN_TODAY').completed).toBe(true);
    expect(mission(body, 'MASTERY_TEST_90').completed).toBe(true);
    // no LESSON_MASTERY / review mastery required for mission qualification
    expect(await prisma.skillMeasurement.count({ where: { userId } })).toBe(0);
  });

  it('§54/§55 no objective attempt → both incomplete; GET is read-only', async () => {
    const { token, userId } = await makeLearner('+998900007004');
    await setup(userId);
    const before = await completions(userId);
    const g1 = (await getMissions(token)).body;
    const g2 = (await getMissions(token)).body;
    expect(mission(g1, 'LEARN_TODAY').completed).toBe(false);
    expect(mission(g1, 'MASTERY_TEST_90').completed).toBe(false);
    expect(g2).toEqual(g1);
    expect(await completions(userId)).toBe(before); // GET wrote nothing
  });

  it('§15/§56 MASTERY_TEST score boundary: 8999 no TEST_90; 9000 yes', async () => {
    const a = await makeLearner('+998900007005');
    const ca = await setup(a.userId, ActivityType.MASTERY_TEST);
    await seedAttempt(a.userId, ca.activityId, ca.revisionId, { score: 8999, submittedAt: new Date('2026-08-20T05:00:00Z') });
    expect(mission((await reconcile(a.token)).body, 'MASTERY_TEST_90').completed).toBe(false);
    expect(mission((await getMissions(a.token)).body, 'LEARN_TODAY').completed).toBe(true); // objective attempt still learned

    const b = await makeLearner('+998900007006');
    const cb = await setup(b.userId, ActivityType.MASTERY_TEST);
    await seedAttempt(b.userId, cb.activityId, cb.revisionId, { score: 9000, submittedAt: new Date('2026-08-20T05:00:00Z') });
    expect(mission((await reconcile(b.token)).body, 'MASTERY_TEST_90').completed).toBe(true);
  });

  it('§57/§63 reconcile picks EARLIEST qualifying evidence; retry (0 then 10000) completes at the qualifying attempt', async () => {
    const { token, userId } = await makeLearner('+998900007007');
    const c = await setup(userId, ActivityType.MASTERY_TEST);
    await seedAttempt(userId, c.activityId, c.revisionId, { score: 0, submittedAt: new Date('2026-08-20T05:00:00Z') }); // does not qualify TEST_90
    await seedAttempt(userId, c.activityId, c.revisionId, { score: 10000, submittedAt: new Date('2026-08-20T05:30:00Z') }); // qualifies

    const body = (await reconcile(token)).body;
    expect(mission(body, 'MASTERY_TEST_90').completed).toBe(true);
    expect(mission(body, 'MASTERY_TEST_90').completedAt).toBe('2026-08-20T05:30:00.000Z'); // first QUALIFYING attempt
    expect(mission(body, 'LEARN_TODAY').completedAt).toBe('2026-08-20T05:00:00.000Z'); // earliest objective attempt
  });

  it('§58 network retry (same clientRequestId) → same attempt, missions unchanged', async () => {
    const { token, userId } = await makeLearner('+998900007008');
    const c = await setup(userId, ActivityType.PRACTICE);
    await seedProgress(userId, c.lessonId, c.revisionId);
    const rid = randomUUID();
    await submitNormal(token, c.lessonId, c.activityId, true, rid);
    await submitNormal(token, c.lessonId, c.activityId, true, rid); // replay
    expect(await prisma.activityAttempt.count({ where: { userId } })).toBe(1);
    expect(await completions(userId, 'LEARN_TODAY')).toBe(1);
  });

  it('§60 day boundary: attempts on different learner-local days → separate LEARN_TODAY completions', async () => {
    const { token, userId } = await makeLearner('+998900007009');
    const c = await setup(userId);
    // Aug 19 23:59 local (18:59Z) and Aug 20 00:01 local (19:01Z)
    await seedAttempt(userId, c.activityId, c.revisionId, { score: 0, submittedAt: new Date('2026-08-19T18:59:00Z') });
    await seedAttempt(userId, c.activityId, c.revisionId, { score: 0, submittedAt: new Date('2026-08-19T19:01:00Z') });

    clock.current = new Date('2026-08-19T18:59:30.000Z'); // local Aug 19 23:59
    await reconcile(token);
    clock.current = new Date('2026-08-20T06:00:00.000Z'); // local Aug 20
    await reconcile(token);
    const rows = await prisma.dailyMissionCompletion.findMany({ where: { userId, missionCode: 'LEARN_TODAY' }, orderBy: { localDate: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.localDate.toISOString().slice(0, 10))).toEqual(['2026-08-19', '2026-08-20']);
  });

  it('§61 timezone snapshot immutable: profile tz change does not move a historical completion', async () => {
    const { token, userId } = await makeLearner('+998900007010', 'Asia/Tashkent');
    const c = await setup(userId, ActivityType.PRACTICE);
    await seedProgress(userId, c.lessonId, c.revisionId);
    await submitNormal(token, c.lessonId, c.activityId, false);
    const row = await prisma.dailyMissionCompletion.findFirst({ where: { userId, missionCode: 'LEARN_TODAY' } });
    expect(row!.timezoneSnapshot).toBe('Asia/Tashkent');
    expect(row!.localDate.toISOString().slice(0, 10)).toBe('2026-08-20');

    await prisma.userProfile.update({ where: { userId }, data: { timezone: 'America/New_York' } });
    const after = await prisma.dailyMissionCompletion.findFirst({ where: { userId, missionCode: 'LEARN_TODAY' } });
    expect(after!.timezoneSnapshot).toBe('Asia/Tashkent'); // historical row unchanged
    expect(after!.localDate.toISOString().slice(0, 10)).toBe('2026-08-20');
  });

  it('§62 reconcile repair + idempotency: seeded evidence with no auto-hook → reconcile creates, repeat stable', async () => {
    const { token, userId } = await makeLearner('+998900007011');
    const c = await setup(userId, ActivityType.MASTERY_TEST);
    await seedAttempt(userId, c.activityId, c.revisionId, { score: 10000, submittedAt: new Date('2026-08-20T05:00:00Z') });
    expect(await completions(userId)).toBe(0); // no auto-hook (direct seed)

    await reconcile(token);
    expect(await completions(userId)).toBe(2); // LEARN_TODAY + TEST_90
    await reconcile(token);
    expect(await completions(userId)).toBe(2); // idempotent
  });

  it('§64-73 IDOR + no leak + side-effect boundary (no reward/skill/signal/plan/roadmap/session/notification)', async () => {
    const { token, userId } = await makeLearner('+998900007012');
    const c = await setup(userId, ActivityType.MASTERY_TEST);
    await seedProgress(userId, c.lessonId, c.revisionId);
    const before = { rewards: await prisma.rewardGrant.count(), states: await prisma.learnerSkillState.count(), measures: await prisma.skillMeasurement.count(), signals: await prisma.learnerSignal.count(), plans: await prisma.dailyPlan.count(), roadmaps: await prisma.learnerRoadmap.count(), sessions: await prisma.learnerReviewSession.count(), notes: await prisma.notification.count() };
    await submitNormal(token, c.lessonId, c.activityId, true);
    const body = (await getMissions(token)).body;

    expect(JSON.stringify(body)).not.toMatch(/answerKey|correctOptionIds|xp|izl|reward|coins|attemptId|activityId/i);
    const after = { rewards: await prisma.rewardGrant.count(), states: await prisma.learnerSkillState.count(), measures: await prisma.skillMeasurement.count(), signals: await prisma.learnerSignal.count(), plans: await prisma.dailyPlan.count(), roadmaps: await prisma.learnerRoadmap.count(), sessions: await prisma.learnerReviewSession.count(), notes: await prisma.notification.count() };
    expect(after).toEqual(before); // mission module wrote none of these
    expect(await prisma.aiEvaluation.count()).toBe(0);

    // §65 IDOR / 401
    const attacker = await makeLearner('+998900007013');
    expect((await getMissions(attacker.token)).body.missions.every((m: { completed: boolean }) => !m.completed)).toBe(true);
    expect(await completions(userId)).toBe(2); // attacker did not touch victim
    expect((await request(server()).get('/api/daily-missions/me/today')).status).toBe(401);
  });
});
