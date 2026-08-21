import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ActivityType, AssessmentPurposeScope, ContainerStatus, ContentSource, LessonStatus, RevisionStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AuthorizationRepository } from '../src/authorization/authorization.repository';
import { AuthExceptionFilter } from '../src/auth/http/auth-exception.filter';
import { SMS_PORT } from '../src/sms/sms.port';
import { Clock } from '../src/common/clock';
import { bootstrapSystemRoles } from '../src/bootstrap/system-roles';
import { cleanupAuthTables, cleanupAssessmentTables, cleanupRoadmapContent } from './test-db.helper';
import { TestSmsAdapter } from './test-sms.adapter';
import { PLACEMENT_CONFIG_SCHEMA_VERSION, PLACEMENT_ENGINE_VERSION } from '../src/assessment/engine/placement-engine.types';
import { PLACEMENT_ITEM_SCHEMA_VERSION } from '../src/assessment/scoring/item-payload';
import { LESSON_ACTIVITY_OBJECTIVE_SCHEMA_VERSION } from '../src/lesson-execution/activity/objective-activity-payload';

describe('Lesson execution (e2e, izlan_test)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  const sms = new TestSmsAdapter();
  const clock = { current: new Date('2026-08-19T06:00:00.000Z'), now() { return this.current; } };
  let n = 0;
  let so = 0;
  const uid = () => `${Date.now()}-${n++}`;
  const nextSort = () => so++;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_PORT).useValue(sms)
      .overrideProvider(Clock).useValue(clock)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AuthExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = moduleRef.get(PrismaService);
    await resetAll();
    await prisma.role.deleteMany();
    await bootstrapSystemRoles(moduleRef.get(AuthorizationRepository));
  });
  afterAll(async () => { await resetAll(); await app.close(); });
  beforeEach(async () => { await resetAll(); sms.clear(); });

  async function resetAll() {
    await prisma.xpGrant.deleteMany();
    await prisma.dailyMissionCompletionEvidence.deleteMany();
    await prisma.dailyMissionCompletion.deleteMany();
    await prisma.activityAttempt.deleteMany();
    await prisma.dailyPlanItem.deleteMany();
    await prisma.dailyPlan.deleteMany();
    await cleanupRoadmapContent(prisma);
    await cleanupAssessmentTables(prisma);
    await prisma.learnerLearningIntent.deleteMany();
    await prisma.track.deleteMany();
    await prisma.subject.deleteMany();
    await cleanupAuthTables(prisma);
  }
  const server = () => app.getHttpServer();

  async function makeLearner(phone: string) {
    await prisma.otpChallenge.updateMany({ where: { phone }, data: { createdAt: new Date(Date.now() - 300_000) } });
    const req = await request(server()).post('/api/auth/otp/request').send({ phone });
    const verify = await request(server()).post('/api/auth/otp/verify').send({ challengeId: req.body.challengeId, code: sms.latestCode() });
    const user = await prisma.user.findUnique({ where: { phone } });
    await prisma.userProfile.update({ where: { userId: user!.id }, data: { displayName: 'A', dateOfBirth: new Date('2005-01-01'), timezone: 'Asia/Tashkent', onboardingCompletedAt: new Date() } });
    return { token: verify.body.accessToken, userId: user!.id };
  }
  const makeSubjectTrack = async (creatorId: string) => {
    const s = await prisma.subject.create({ data: { slug: `s-${uid()}`, title: 'English', status: ContainerStatus.PUBLISHED, sortOrder: nextSort(), createdBy: creatorId } });
    const t = await prisma.track.create({ data: { subjectId: s.id, slug: `t-${uid()}`, title: 'IELTS', status: ContainerStatus.PUBLISHED, sortOrder: nextSort(), createdBy: creatorId } });
    return { subjectId: s.id, trackId: t.id };
  };
  const makeSkill = (subjectId: string, name: string) => prisma.skill.create({ data: { subjectId, name: `${name}-${uid()}`, sortOrder: nextSort() } }).then((s) => s.id);
  const makeIntent = (userId: string, subjectId: string, trackId: string) => prisma.learnerLearningIntent.create({ data: { userId, subjectId, trackId } });
  const scPayload = () => ({ schemaVersion: PLACEMENT_ITEM_SCHEMA_VERSION, format: 'single_choice', prompt: 'Q', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], answerKey: { correctOptionIds: ['a'] } });
  const diagConfig = (c: number) => ({ schemaVersion: PLACEMENT_CONFIG_SCHEMA_VERSION, engine: PLACEMENT_ENGINE_VERSION, selection: { startDifficulty: 3, stepUp: 1, stepDown: 1 }, coverage: { itemsPerSkill: 1 }, stopping: { maxItems: c }, profileScale: { minDifficulty: 1, maxDifficulty: 6 } });
  async function seedDiagnostic(creatorId: string, subjectId: string, items: { skillId: string; difficulty: number }[]) {
    const def = await prisma.assessmentDefinition.create({ data: { subjectId, purposeScope: AssessmentPurposeScope.DIAGNOSTIC, title: 'P', status: ContainerStatus.PUBLISHED, createdBy: creatorId } });
    const version = await prisma.assessmentDefinitionVersion.create({ data: { definitionId: def.id, versionNo: 1, config: diagConfig(items.length), status: RevisionStatus.PUBLISHED, createdBy: creatorId, publishedAt: new Date() } });
    await prisma.assessmentDefinition.update({ where: { id: def.id }, data: { currentVersionId: version.id } });
    for (const it of items) {
      const item = await prisma.assessmentItem.create({ data: { definitionId: def.id, type: ActivityType.MINI_QUESTION, payload: scPayload(), skillId: it.skillId, difficulty: it.difficulty, status: RevisionStatus.PUBLISHED, source: ContentSource.HUMAN } });
      await prisma.assessmentVersionItem.create({ data: { versionId: version.id, itemId: item.id } });
    }
  }
  async function driveDiagnostic(token: string, intentId: string): Promise<string> {
    let view = (await request(server()).post('/api/assessments/placement/start').set('Authorization', `Bearer ${token}`).send({ learningIntentId: intentId })).body;
    const attemptId = view.attemptId;
    while (view.status === 'IN_PROGRESS') view = (await request(server()).post(`/api/assessments/attempts/${attemptId}/responses`).set('Authorization', `Bearer ${token}`).send({ itemId: view.item.id, answer: { selectedOptionId: 'a' } })).body;
    return attemptId;
  }
  async function makeTopic(creatorId: string, trackId: string) {
    const level = await prisma.level.create({ data: { trackId, code: `C-${uid()}`, title: 'Lvl', sortOrder: nextSort(), status: ContainerStatus.PUBLISHED, createdBy: creatorId } });
    const mod = await prisma.module.create({ data: { levelId: level.id, title: 'Mod', sortOrder: nextSort(), status: ContainerStatus.PUBLISHED, createdBy: creatorId } });
    return (await prisma.topic.create({ data: { moduleId: mod.id, title: 'Top', sortOrder: nextSort(), status: ContainerStatus.PUBLISHED, createdBy: creatorId } })).id;
  }
  async function makeLesson(creatorId: string, topicId: string, skillIds: string[], prereqIds: string[] = [], title = 'V1') {
    const lesson = await prisma.lesson.create({ data: { topicId, slug: `l-${uid()}`, contentKey: `ck-${uid()}`, sortOrder: nextSort(), status: LessonStatus.PUBLISHED, createdBy: creatorId } });
    const rev = await prisma.lessonRevision.create({ data: { lessonId: lesson.id, version: 1, title, description: 'desc', estimatedDurationMin: 10, status: RevisionStatus.PUBLISHED, createdBy: creatorId, publishedAt: new Date() } });
    await prisma.lesson.update({ where: { id: lesson.id }, data: { publishedRevisionId: rev.id } });
    for (const sid of skillIds) await prisma.lessonSkill.create({ data: { lessonId: lesson.id, skillId: sid } });
    for (const pid of prereqIds) await prisma.lessonPrerequisite.create({ data: { lessonId: lesson.id, prerequisiteLessonId: pid } });
    return { lessonId: lesson.id, revisionId: rev.id };
  }
  const makeActivity = (creatorId: string, revisionId: string, type: ActivityType, position: number) =>
    prisma.activity.create({ data: { lessonRevisionId: revisionId, type, position, payload: { schema_version: 'x', answerKey: 'SECRET' }, source: ContentSource.HUMAN } }).then((a) => a.id);
  async function publishNewRevision(creatorId: string, lessonId: string, title: string) {
    // archive-first (C7 ux_lesson_published_revision: one PUBLISHED revision per lesson)
    await prisma.lessonRevision.updateMany({ where: { lessonId, status: RevisionStatus.PUBLISHED }, data: { status: RevisionStatus.ARCHIVED } });
    const rev = await prisma.lessonRevision.create({ data: { lessonId, version: 2, title, status: RevisionStatus.PUBLISHED, createdBy: creatorId, publishedAt: new Date() } });
    await prisma.lesson.update({ where: { id: lessonId }, data: { publishedRevisionId: rev.id } });
    return rev.id;
  }
  async function completeLesson(userId: string, lessonId: string) {
    const rev = (await prisma.lesson.findUnique({ where: { id: lessonId }, select: { publishedRevisionId: true } }))!.publishedRevisionId!;
    await prisma.learnerLessonCompletion.create({ data: { userId, lessonId, lessonRevisionId: rev, completionNo: 1 } });
  }
  const archiveLesson = (lessonId: string) => prisma.lesson.update({ where: { id: lessonId }, data: { status: LessonStatus.ARCHIVED } });
  const genRoadmap = (token: string, attemptId: string) => request(server()).post(`/api/roadmaps/diagnostics/${attemptId}/initial`).set('Authorization', `Bearer ${token}`);
  const postToday = (token: string) => request(server()).post('/api/daily-plans/today').set('Authorization', `Bearer ${token}`);
  const startExec = (token: string, dailyPlanItemId: string) => request(server()).post(`/api/lesson-executions/daily-plan-items/${dailyPlanItemId}/start`).set('Authorization', `Bearer ${token}`);
  const resumeExec = (token: string, lessonId: string) => request(server()).get(`/api/lesson-executions/${lessonId}`).set('Authorization', `Bearer ${token}`);

  /** Diagnostic + roadmap + today's daily plan over one Topic. Returns the plan items + lesson ids. */
  async function setup(phone: string, lessons: 'single' | 'chain') {
    const { token, userId } = await makeLearner(phone);
    const { subjectId, trackId } = await makeSubjectTrack(userId);
    const skA = await makeSkill(subjectId, 'Grammar');
    const skB = await makeSkill(subjectId, 'Reading');
    const intent = await makeIntent(userId, subjectId, trackId);
    await seedDiagnostic(userId, subjectId, [{ skillId: skA, difficulty: 2 }, { skillId: skB, difficulty: 5 }]);
    const attemptId = await driveDiagnostic(token, intent.id);
    const topicA = await makeTopic(userId, trackId);
    const A = await makeLesson(userId, topicA, [skA], [], 'V1'); // MUST_DO
    const B = lessons === 'chain' ? await makeLesson(userId, topicA, [skB], [A.lessonId], 'V1') : await makeLesson(userId, topicA, [skB], [], 'V1');
    await genRoadmap(token, attemptId);
    const plan = (await postToday(token)).body;
    return { token, userId, topicA, A, B, plan };
  }
  const itemFor = (plan: { items: { id: string; lesson: { id: string } }[] }, lessonId: string) => plan.items.find((i) => i.lesson.id === lessonId)!.id;

  // ─────────────────────────────────────────────────────────────────────────

  it('start pins the published revision, returns learner-safe content, creates progress; no completion/side-effects', async () => {
    const s = await setup('+998900000701', 'single');
    await makeActivity(s.userId, s.A.revisionId, ActivityType.MINI_QUESTION, 1);
    await makeActivity(s.userId, s.A.revisionId, ActivityType.EXPLANATION, 2);

    const res = await startExec(s.token, itemFor(s.plan, s.A.lessonId));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ lessonId: s.A.lessonId, lessonRevisionId: s.A.revisionId });
    expect(res.body.lesson).toEqual({ title: 'V1', description: 'desc', estimatedDurationMin: 10 });
    expect(res.body.activities.map((a: { position: number }) => a.position)).toEqual([1, 2]);
    expect(JSON.stringify(res.body)).not.toContain('SECRET'); // no payload / answer key leak (§28/49)
    expect(res.body.activities[0]).not.toHaveProperty('payload');

    // progress persisted, pinned revision
    const progress = await prisma.learnerLessonProgress.findUnique({ where: { userId_lessonId: { userId: s.userId, lessonId: s.A.lessonId } } });
    expect(progress!.lessonRevisionId).toBe(s.A.revisionId);
    // boundary: no completion / roadmap / skill / attempt / daily-plan mutation (§53)
    expect(await prisma.learnerLessonCompletion.count({ where: { userId: s.userId } })).toBe(0);
    expect(await prisma.activityAttempt.count()).toBe(0);
    expect(await prisma.skillMeasurement.count({ where: { userId: s.userId, source: 'LESSON_MASTERY' } })).toBe(0);
    expect((await prisma.learnerRoadmap.findFirst({ where: { userId: s.userId } }))!.status).toBe('ACTIVE');
  });

  it('§10 start is idempotent — same progress, single row, no repin', async () => {
    const s = await setup('+998900000702', 'single');
    const item = itemFor(s.plan, s.A.lessonId);
    const first = await startExec(s.token, item);
    const again = await startExec(s.token, item);
    expect(again.body.lessonRevisionId).toBe(first.body.lessonRevisionId);
    expect(await prisma.learnerLessonProgress.count({ where: { userId: s.userId, lessonId: s.A.lessonId } })).toBe(1);
  });

  it('§45 revision stays pinned after a new revision is published (resume returns pinned v1)', async () => {
    const s = await setup('+998900000703', 'single');
    const start = await startExec(s.token, itemFor(s.plan, s.A.lessonId));
    expect(start.body.lesson.title).toBe('V1');
    await publishNewRevision(s.userId, s.A.lessonId, 'V2'); // current pointer → v2

    const resume = await resumeExec(s.token, s.A.lessonId);
    expect(resume.body.lessonRevisionId).toBe(s.A.revisionId); // still v1
    expect(resume.body.lesson.title).toBe('V1'); // pinned content, not v2
  });

  it('§42 cannot start via a stale/foreign/fabricated daily-plan-item (no arbitrary lesson start)', async () => {
    const s = await setup('+998900000704', 'single');
    expect((await startExec(s.token, '00000000-0000-0000-0000-000000000000')).status).toBe(404); // fabricated
    // a DailyPlanItem from a different (superseded) local day cannot start today
    const otherPlan = await prisma.dailyPlan.create({ data: { userId: s.userId, localDate: new Date('2026-08-18T00:00:00.000Z'), timezoneSnapshot: 'Asia/Tashkent', generationNo: 1, status: 'SUPERSEDED' } });
    const staleItem = await prisma.dailyPlanItem.create({ data: { dailyPlanId: otherPlan.id, section: 'MUST_DO', itemType: 'LESSON', lessonId: s.A.lessonId, position: 1 } });
    expect((await startExec(s.token, staleItem.id)).status).toBe(404);
  });

  it('§43 BLOCKED recommended cannot start; §44 becomes startable when prerequisite completed', async () => {
    const s = await setup('+998900000705', 'chain'); // B depends on A, same Topic
    const itemB = itemFor(s.plan, s.B.lessonId);
    const blocked = await startExec(s.token, itemB);
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('LESSON_NOT_EXECUTABLE');
    expect(await prisma.learnerLessonProgress.count({ where: { userId: s.userId, lessonId: s.B.lessonId } })).toBe(0);

    await completeLesson(s.userId, s.A.lessonId); // prerequisite satisfied → B AVAILABLE
    expect((await startExec(s.token, itemB)).status).toBe(200);
  });

  it('§7 already-completed lesson cannot start again', async () => {
    const s = await setup('+998900000706', 'single');
    await completeLesson(s.userId, s.A.lessonId);
    const res = await startExec(s.token, itemFor(s.plan, s.A.lessonId));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('LESSON_ALREADY_COMPLETED');
    expect(await prisma.learnerLessonProgress.count({ where: { userId: s.userId, lessonId: s.A.lessonId } })).toBe(0);
  });

  it('§48 lesson archived after plan → not executable, no draft/body leak', async () => {
    const s = await setup('+998900000707', 'single');
    await archiveLesson(s.A.lessonId);
    const res = await startExec(s.token, itemFor(s.plan, s.A.lessonId));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('LESSON_NOT_EXECUTABLE');
    expect(JSON.stringify(res.body)).not.toContain('V1');
  });

  it('§46 concurrent start → one progress row, one pinned revision', async () => {
    const s = await setup('+998900000708', 'single');
    const item = itemFor(s.plan, s.A.lessonId);
    const [r1, r2] = await Promise.all([startExec(s.token, item), startExec(s.token, item)]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect(r1.body.lessonRevisionId).toBe(r2.body.lessonRevisionId);
    expect(await prisma.learnerLessonProgress.count({ where: { userId: s.userId, lessonId: s.A.lessonId } })).toBe(1);
  });

  it('§47 security: other user + no-auth cannot start or resume', async () => {
    const s = await setup('+998900000709', 'single');
    const item = itemFor(s.plan, s.A.lessonId);
    await startExec(s.token, item); // owner has progress
    const attacker = await makeLearner('+998900000710');
    expect((await startExec(attacker.token, item)).status).toBe(404); // not attacker's plan item
    expect((await resumeExec(attacker.token, s.A.lessonId)).status).toBe(404); // not attacker's progress
    expect((await request(server()).get(`/api/lesson-executions/${s.A.lessonId}`)).status).toBe(401);
    expect((await request(server()).post(`/api/lesson-executions/daily-plan-items/${item}/start`)).status).toBe(401);
  });

  it('resume before start → 404 LESSON_PROGRESS_NOT_FOUND', async () => {
    const s = await setup('+998900000711', 'single');
    const res = await resumeExec(s.token, s.A.lessonId);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('LESSON_PROGRESS_NOT_FOUND');
  });

  // ── Activity submission (Phase 1.7B-2) ──
  const objPayload = (correct = 'a') => ({ schemaVersion: LESSON_ACTIVITY_OBJECTIVE_SCHEMA_VERSION, format: 'single_choice', prompt: 'Choose', options: [{ id: 'a', text: 'Alpha' }, { id: 'b', text: 'Beta' }], answerKey: { correctOptionIds: [correct] } });
  const makeObjActivity = (revisionId: string, position: number, type: ActivityType = ActivityType.MINI_QUESTION, correct = 'a') =>
    prisma.activity.create({ data: { lessonRevisionId: revisionId, type, position, payload: objPayload(correct), source: ContentSource.HUMAN } }).then((a) => a.id);
  const submit = (token: string, lessonId: string, activityId: string, clientRequestId: string, answer: object) =>
    request(server()).post(`/api/lesson-executions/${lessonId}/activities/${activityId}/attempts`).set('Authorization', `Bearer ${token}`).send({ clientRequestId, answer });

  it('submit objective activity: deterministic score, append-only evidence, progress step; NO completion/side-effects', async () => {
    const s = await setup('+998900000712', 'single');
    const act = await makeObjActivity(s.A.revisionId, 1);
    await startExec(s.token, itemFor(s.plan, s.A.lessonId));

    const correct = await submit(s.token, s.A.lessonId, act, randomUUID(), { selectedOptionId: 'a' });
    expect(correct.status).toBe(200);
    expect(correct.body).toMatchObject({ activityId: act, attemptNo: 1, isCorrect: true, deterministicScore: 10000, status: 'SUBMITTED' });
    expect(JSON.stringify(correct.body)).not.toContain('answerKey');

    const wrong = await submit(s.token, s.A.lessonId, act, randomUUID(), { selectedOptionId: 'b' });
    expect(wrong.body).toMatchObject({ attemptNo: 2, isCorrect: false, deterministicScore: 0 }); // §50 incorrect still recorded

    // append-only evidence + progress step recorded
    const attempts = await prisma.activityAttempt.findMany({ where: { userId: s.userId, activityId: act }, orderBy: { attemptNo: 'asc' } });
    expect(attempts.map((a) => a.attemptNo)).toEqual([1, 2]);
    const progress = await prisma.learnerLessonProgress.findUnique({ where: { userId_lessonId: { userId: s.userId, lessonId: s.A.lessonId } } });
    expect(progress!.completedActivities).toEqual([act]);
    expect(progress!.lastActivityId).toBe(act);

    // §51 boundary
    expect(await prisma.learnerLessonCompletion.count({ where: { userId: s.userId } })).toBe(0);
    expect(await prisma.skillMeasurement.count({ where: { userId: s.userId, source: 'LESSON_MASTERY' } })).toBe(0);
    expect(await prisma.aiEvaluation.count()).toBe(0);
    expect(await prisma.rewardGrant.count()).toBe(0);
    expect((await prisma.learnerRoadmap.findFirst({ where: { userId: s.userId } }))!.status).toBe('ACTIVE');
  });

  it('§47 idempotency: same requestId+answer replays; same requestId+different answer 409; new requestId new attempt', async () => {
    const s = await setup('+998900000713', 'single');
    const act = await makeObjActivity(s.A.revisionId, 1);
    await startExec(s.token, itemFor(s.plan, s.A.lessonId));
    const rid = randomUUID();

    const first = await submit(s.token, s.A.lessonId, act, rid, { selectedOptionId: 'a' });
    const replay = await submit(s.token, s.A.lessonId, act, rid, { selectedOptionId: 'a' });
    expect(replay.body.attemptId).toBe(first.body.attemptId); // idempotent
    expect(replay.body.attemptNo).toBe(1);

    const conflict = await submit(s.token, s.A.lessonId, act, rid, { selectedOptionId: 'b' }); // same rid, different answer
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('ACTIVITY_ATTEMPT_REQUEST_CONFLICT');

    const reattempt = await submit(s.token, s.A.lessonId, act, randomUUID(), { selectedOptionId: 'a' }); // new rid → new attempt
    expect(reattempt.body.attemptNo).toBe(2);
    expect(await prisma.activityAttempt.count({ where: { userId: s.userId, activityId: act } })).toBe(2);
  });

  it('§48 concurrency: same requestId → 1 row; different requestIds → 2 rows with unique attemptNo', async () => {
    const s = await setup('+998900000714', 'single');
    const act = await makeObjActivity(s.A.revisionId, 1);
    await startExec(s.token, itemFor(s.plan, s.A.lessonId));

    const rid = randomUUID();
    const [a, b] = await Promise.all([submit(s.token, s.A.lessonId, act, rid, { selectedOptionId: 'a' }), submit(s.token, s.A.lessonId, act, rid, { selectedOptionId: 'a' })]);
    expect(a.body.attemptId).toBe(b.body.attemptId); // same request → one attempt
    expect(await prisma.activityAttempt.count({ where: { userId: s.userId, activityId: act } })).toBe(1);

    const [c, d] = await Promise.all([submit(s.token, s.A.lessonId, act, randomUUID(), { selectedOptionId: 'a' }), submit(s.token, s.A.lessonId, act, randomUUID(), { selectedOptionId: 'a' })]);
    expect([c.status, d.status]).toEqual([200, 200]);
    const nos = (await prisma.activityAttempt.findMany({ where: { userId: s.userId, activityId: act }, select: { attemptNo: true } })).map((x) => x.attemptNo).sort();
    expect(nos).toEqual([1, 2, 3]); // unique attemptNo, no overwrite
  });

  it('§42 revision authority: submit pinned-v1 activity OK; v2 activity rejected', async () => {
    const s = await setup('+998900000715', 'single');
    const v1Act = await makeObjActivity(s.A.revisionId, 1);
    await startExec(s.token, itemFor(s.plan, s.A.lessonId)); // pins v1
    const v2 = await publishNewRevision(s.userId, s.A.lessonId, 'V2');
    const v2Act = await makeObjActivity(v2, 1);

    expect((await submit(s.token, s.A.lessonId, v1Act, randomUUID(), { selectedOptionId: 'a' })).status).toBe(200);
    const rejected = await submit(s.token, s.A.lessonId, v2Act, randomUUID(), { selectedOptionId: 'a' });
    expect(rejected.status).toBe(409);
    expect(rejected.body.code).toBe('ACTIVITY_NOT_IN_PINNED_REVISION');
    expect(await prisma.activityAttempt.count({ where: { activityId: v2Act } })).toBe(0); // no evidence written
  });

  it('§44 client score injection rejected; §33 unsupported type rejected', async () => {
    const s = await setup('+998900000716', 'single');
    const act = await makeObjActivity(s.A.revisionId, 1);
    const writing = await makeObjActivity(s.A.revisionId, 2, ActivityType.WRITING);
    await startExec(s.token, itemFor(s.plan, s.A.lessonId));

    const top = await request(server()).post(`/api/lesson-executions/${s.A.lessonId}/activities/${act}/attempts`).set('Authorization', `Bearer ${s.token}`).send({ clientRequestId: randomUUID(), answer: { selectedOptionId: 'a' }, score: 10000 });
    expect(top.status).toBe(400); // forbidNonWhitelisted
    const nested = await submit(s.token, s.A.lessonId, act, randomUUID(), { selectedOptionId: 'a', isCorrect: true });
    expect(nested.status).toBe(400);
    expect(nested.body.code).toBe('ACTIVITY_INVALID_RESPONSE');
    const unsupported = await submit(s.token, s.A.lessonId, writing, randomUUID(), { selectedOptionId: 'a' });
    expect(unsupported.status).toBe(409);
    expect(unsupported.body.code).toBe('ACTIVITY_TYPE_NOT_SUPPORTED');
  });

  it('§39 objective activity content is learner-safe (format/prompt/options, no answer key) on start/resume', async () => {
    const s = await setup('+998900000717', 'single');
    await makeObjActivity(s.A.revisionId, 1);
    const start = await startExec(s.token, itemFor(s.plan, s.A.lessonId));
    const objItem = start.body.activities.find((a: { format?: string }) => a.format);
    expect(objItem).toMatchObject({ format: 'single_choice', prompt: 'Choose', options: [{ id: 'a', text: 'Alpha' }, { id: 'b', text: 'Beta' }] });
    const resume = await resumeExec(s.token, s.A.lessonId);
    for (const body of [start.body, resume.body]) {
      const json = JSON.stringify(body);
      expect(json).not.toContain('answerKey');
      expect(json).not.toContain('correctOptionIds');
    }
  });

  it('§43 activity from another lesson rejected; §47 IDOR on submit', async () => {
    const s = await setup('+998900000718', 'single');
    const act = await makeObjActivity(s.A.revisionId, 1);
    await startExec(s.token, itemFor(s.plan, s.A.lessonId));
    // another lesson's activity (B revision)
    const bAct = await makeObjActivity(s.B.revisionId, 1);
    const cross = await submit(s.token, s.A.lessonId, bAct, randomUUID(), { selectedOptionId: 'a' });
    expect(cross.status).toBe(409);
    expect(cross.body.code).toBe('ACTIVITY_NOT_IN_PINNED_REVISION');

    const attacker = await makeLearner('+998900000719');
    expect((await submit(attacker.token, s.A.lessonId, act, randomUUID(), { selectedOptionId: 'a' })).status).toBe(404); // no own progress
  });
});
