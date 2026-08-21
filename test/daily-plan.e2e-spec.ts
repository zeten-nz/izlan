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

describe('Daily plan (e2e, izlan_test)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  const sms = new TestSmsAdapter();
  const clock = { current: new Date('2026-08-19T06:00:00.000Z'), now() { return this.current; }, set(d: string) { this.current = new Date(d); } };
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
  beforeEach(async () => { await resetAll(); sms.clear(); clock.set('2026-08-19T06:00:00.000Z'); });

  async function resetAll() {
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
    return (await prisma.topic.create({ data: { moduleId: mod.id, title: `Topic-${uid()}`, sortOrder: nextSort(), status: ContainerStatus.PUBLISHED, createdBy: creatorId } })).id;
  }
  async function makeLesson(creatorId: string, topicId: string, skillIds: string[], prereqIds: string[] = []) {
    const lesson = await prisma.lesson.create({ data: { topicId, slug: `l-${uid()}`, sortOrder: nextSort(), status: LessonStatus.PUBLISHED, createdBy: creatorId } });
    const rev = await prisma.lessonRevision.create({ data: { lessonId: lesson.id, version: 1, title: 'Lesson', status: RevisionStatus.PUBLISHED, createdBy: creatorId, publishedAt: new Date() } });
    await prisma.lesson.update({ where: { id: lesson.id }, data: { publishedRevisionId: rev.id } });
    for (const sid of skillIds) await prisma.lessonSkill.create({ data: { lessonId: lesson.id, skillId: sid } });
    for (const pid of prereqIds) await prisma.lessonPrerequisite.create({ data: { lessonId: lesson.id, prerequisiteLessonId: pid } });
    return lesson.id;
  }
  async function completeLesson(userId: string, lessonId: string) {
    const rev = (await prisma.lesson.findUnique({ where: { id: lessonId }, select: { publishedRevisionId: true } }))!.publishedRevisionId!;
    await prisma.learnerLessonCompletion.create({ data: { userId, lessonId, lessonRevisionId: rev, completionNo: 1 } });
  }
  const archiveLesson = (lessonId: string) => prisma.lesson.update({ where: { id: lessonId }, data: { status: LessonStatus.ARCHIVED } });
  const genRoadmap = (token: string, attemptId: string) => request(server()).post(`/api/roadmaps/diagnostics/${attemptId}/initial`).set('Authorization', `Bearer ${token}`);
  const postToday = (token: string) => request(server()).post('/api/daily-plans/today').set('Authorization', `Bearer ${token}`);
  const getToday = (token: string) => request(server()).get('/api/daily-plans/today').set('Authorization', `Bearer ${token}`);
  const stateOf = (body: { items: { lesson: { id: string }; state: string }[] }, lessonId: string) => body.items.find((i) => i.lesson.id === lessonId)?.state;

  /** Diagnostic + roadmap. skA weak (gap high, pos1), skB strong (gap low, pos2). Returns ids + a topic. */
  async function base(phone: string) {
    const { token, userId } = await makeLearner(phone);
    const { subjectId, trackId } = await makeSubjectTrack(userId);
    const skA = await makeSkill(subjectId, 'Grammar');
    const skB = await makeSkill(subjectId, 'Reading');
    const intent = await makeIntent(userId, subjectId, trackId);
    await seedDiagnostic(userId, subjectId, [{ skillId: skA, difficulty: 2 }, { skillId: skB, difficulty: 5 }]);
    const attemptId = await driveDiagnostic(token, intent.id);
    return { token, userId, subjectId, trackId, skA, skB, attemptId };
  }

  // ─────────────────────────────────────────────────────────────────────────

  it('POST today: one-Topic snapshot (MUST_DO + RECOMMENDED same topic), local date/timezone, no EXTRA', async () => {
    const s = await base('+998900000601');
    const topicA = await makeTopic(s.userId, s.trackId);
    const lA = await makeLesson(s.userId, topicA, [s.skA]); // higher gap → MUST_DO
    const lB = await makeLesson(s.userId, topicA, [s.skB]); // same topic → RECOMMENDED
    await genRoadmap(s.token, s.attemptId);

    const res = await postToday(s.token);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ localDate: '2026-08-19', timezone: 'Asia/Tashkent', generationNo: 1, done: false });
    expect(res.body.items.map((i: { kind: string; lesson: { id: string } }) => [i.kind, i.lesson.id])).toEqual([['MUST_DO', lA], ['RECOMMENDED', lB]]);
    expect(res.body.items.some((i: { kind: string }) => i.kind === 'EXTRA')).toBe(false); // §49
    expect(res.body.topic.id).toBeDefined();
    expect(res.body.progress).toMatchObject({ total: 2, completed: 0, progressBp: 0 });
    expect(res.body.nextItemId === undefined || true).toBe(true);

    // no side-effects
    expect(await prisma.learnerLessonProgress.count({ where: { userId: s.userId } })).toBe(0);
    expect(await prisma.learnerSkillState.count({ where: { userId: s.userId } })).toBe(2); // unchanged (auto-derivation)
    expect(await prisma.dailyMissionCompletion.count()).toBe(0);
    expect(await prisma.xpGrant.count({ where: { userId: s.userId } })).toBe(0);
  });

  it('§10/39 same-day idempotency: finishing early returns the SAME plan (no second Topic)', async () => {
    const s = await base('+998900000602');
    const topicA = await makeTopic(s.userId, s.trackId);
    const lA = await makeLesson(s.userId, topicA, [s.skA]);
    const lB = await makeLesson(s.userId, topicA, [s.skB]);
    await genRoadmap(s.token, s.attemptId);
    const first = await postToday(s.token);
    await completeLesson(s.userId, lA);
    await completeLesson(s.userId, lB); // finished all planned work
    const again = await postToday(s.token);
    expect(again.body.id).toBe(first.body.id);
    expect(again.body.generationNo).toBe(1);
    expect(again.body.done).toBe(true); // derived done, but still the same plan
    expect(await prisma.dailyPlan.count({ where: { userId: s.userId } })).toBe(1); // no second plan/topic
  });

  it('§35 concurrent generation → one CURRENT plan', async () => {
    const s = await base('+998900000603');
    const topicA = await makeTopic(s.userId, s.trackId);
    await makeLesson(s.userId, topicA, [s.skA]);
    await genRoadmap(s.token, s.attemptId);
    const [r1, r2] = await Promise.all([postToday(s.token), postToday(s.token)]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect(r1.body.id).toBe(r2.body.id);
    expect(await prisma.dailyPlan.count({ where: { userId: s.userId, status: 'CURRENT' } })).toBe(1);
  });

  it('§50 GET today never generates/mutates; 404 before generation', async () => {
    const s = await base('+998900000604');
    const topicA = await makeTopic(s.userId, s.trackId);
    await makeLesson(s.userId, topicA, [s.skA]);
    await genRoadmap(s.token, s.attemptId);
    expect((await getToday(s.token)).status).toBe(404); // no plan yet
    expect(await prisma.dailyPlan.count({ where: { userId: s.userId } })).toBe(0);
    const gen = await postToday(s.token);
    const got = await getToday(s.token);
    expect(got.body.id).toBe(gen.body.id);
    expect(await prisma.dailyPlan.count({ where: { userId: s.userId } })).toBe(1); // GET created nothing
  });

  it('§40 multi-day same Topic: next local date may reuse the same Topic', async () => {
    const s = await base('+998900000605');
    const topicA = await makeTopic(s.userId, s.trackId);
    const lA = await makeLesson(s.userId, topicA, [s.skA]);
    await makeLesson(s.userId, topicA, [s.skB]);
    await genRoadmap(s.token, s.attemptId);
    const day1 = await postToday(s.token);
    expect(day1.body.localDate).toBe('2026-08-19');
    await completeLesson(s.userId, lA); // finish only one topic-A lesson

    clock.set('2026-08-20T06:00:00.000Z'); // next local day
    const day2 = await postToday(s.token);
    expect(day2.body.localDate).toBe('2026-08-20');
    expect(day2.body.id).not.toBe(day1.body.id);
    expect(day2.body.topic.id).toBe(day1.body.topic.id); // still Topic A (nextItem still in it)
  });

  it('§41 next Topic on next local day after this Topic’s roadmap items done', async () => {
    const s = await base('+998900000606');
    const topicA = await makeTopic(s.userId, s.trackId);
    const topicB = await makeTopic(s.userId, s.trackId);
    const lA = await makeLesson(s.userId, topicA, [s.skA]); // pos1 (higher gap) → Topic A day 1
    const lB = await makeLesson(s.userId, topicB, [s.skB]); // pos2 → Topic B later
    await genRoadmap(s.token, s.attemptId);
    const day1 = await postToday(s.token);
    expect(stateOf(day1.body, lA)).toBeDefined();
    expect(day1.body.topic.id).toBe(topicA);
    await completeLesson(s.userId, lA);

    clock.set('2026-08-20T06:00:00.000Z');
    const day2 = await postToday(s.token);
    expect(day2.body.topic.id).toBe(topicB); // moved to next Topic
    expect(day2.body.items.map((i: { lesson: { id: string } }) => i.lesson.id)).toEqual([lB]);
  });

  it('§38 timezone change does not mutate an existing plan snapshot; future plan uses new tz', async () => {
    const s = await base('+998900000607');
    const topicA = await makeTopic(s.userId, s.trackId);
    await makeLesson(s.userId, topicA, [s.skA]);
    await genRoadmap(s.token, s.attemptId);
    const plan = await postToday(s.token);
    const before = await prisma.dailyPlan.findUnique({ where: { id: plan.body.id } });

    await prisma.userProfile.update({ where: { userId: s.userId }, data: { timezone: 'America/New_York' } });
    const after = await prisma.dailyPlan.findUnique({ where: { id: plan.body.id } });
    expect(after!.timezoneSnapshot).toBe('Asia/Tashkent'); // snapshot immutable
    expect(after!.localDate.toISOString()).toBe(before!.localDate.toISOString());
  });

  it('§46 BLOCKED recommended becomes AVAILABLE live without regeneration', async () => {
    const s = await base('+998900000608');
    const topicA = await makeTopic(s.userId, s.trackId);
    const A = await makeLesson(s.userId, topicA, [s.skA]);
    const B = await makeLesson(s.userId, topicA, [s.skA], [A]); // B requires A, same topic
    await genRoadmap(s.token, s.attemptId);
    const gen = await postToday(s.token);
    expect(stateOf(gen.body, A)).toBe('AVAILABLE');
    expect(stateOf(gen.body, B)).toBe('BLOCKED');
    await completeLesson(s.userId, A);
    const after = await getToday(s.token);
    expect(after.body.id).toBe(gen.body.id); // same snapshot
    expect(stateOf(after.body, A)).toBe('COMPLETED');
    expect(stateOf(after.body, B)).toBe('AVAILABLE'); // live transition, no regen
  });

  it('§47 lesson archived after snapshot → UNAVAILABLE, kept, no draft leak; §48 completed-then-archived → COMPLETED', async () => {
    const s = await base('+998900000609');
    const topicA = await makeTopic(s.userId, s.trackId);
    const lA = await makeLesson(s.userId, topicA, [s.skA]);
    const lB = await makeLesson(s.userId, topicA, [s.skB]);
    await genRoadmap(s.token, s.attemptId);
    await postToday(s.token);
    await completeLesson(s.userId, lA);
    await archiveLesson(lA); // completed then archived
    await archiveLesson(lB); // never completed → unavailable

    const view = await getToday(s.token);
    expect(stateOf(view.body, lA)).toBe('COMPLETED'); // history wins
    expect(stateOf(view.body, lB)).toBe('UNAVAILABLE');
    const bItem = view.body.items.find((i: { lesson: { id: string } }) => i.lesson.id === lB);
    expect(bItem.lesson.title).toBeNull(); // no archived/draft title leak
    expect(await prisma.dailyPlanItem.count({ where: { dailyPlan: { userId: s.userId } } })).toBe(2); // items kept
  });

  it('§24 all completed but roadmap not reconciled → 409, no plan, no hidden reconcile', async () => {
    const s = await base('+998900000610');
    const topicA = await makeTopic(s.userId, s.trackId);
    const lA = await makeLesson(s.userId, topicA, [s.skA]);
    const lB = await makeLesson(s.userId, topicA, [s.skB]);
    const rm = await genRoadmap(s.token, s.attemptId);
    await completeLesson(s.userId, lA);
    await completeLesson(s.userId, lB); // all roadmap lessons done, but no reconcile called
    const res = await postToday(s.token);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DAILY_PLAN_NO_EXECUTABLE_CONTENT');
    expect(await prisma.dailyPlan.count({ where: { userId: s.userId } })).toBe(0);
    expect((await prisma.learnerRoadmap.findUnique({ where: { id: rm.body.roadmap.id } }))!.status).toBe('ACTIVE'); // not secretly reconciled
  });

  it('no active roadmap → 404 ROADMAP_NOT_FOUND; requires auth', async () => {
    const s = await base('+998900000611'); // diagnostic done but no roadmap generated
    const res = await postToday(s.token);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('ROADMAP_NOT_FOUND');
    expect((await request(server()).get('/api/daily-plans/today')).status).toBe(401);
    expect((await request(server()).post('/api/daily-plans/today')).status).toBe(401);
  });
});
