import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ActivityType, AssessmentPurposeScope, ContainerStatus, ContentSource, LessonProgressStatus, LessonStatus, RevisionStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AuthorizationRepository } from '../src/authorization/authorization.repository';
import { AuthExceptionFilter } from '../src/auth/http/auth-exception.filter';
import { SMS_PORT } from '../src/sms/sms.port';
import { bootstrapSystemRoles } from '../src/bootstrap/system-roles';
import { cleanupAuthTables, cleanupAssessmentTables, cleanupRoadmapContent } from './test-db.helper';
import { TestSmsAdapter } from './test-sms.adapter';
import { PLACEMENT_CONFIG_SCHEMA_VERSION, PLACEMENT_ENGINE_VERSION } from '../src/assessment/engine/placement-engine.types';
import { PLACEMENT_ITEM_SCHEMA_VERSION } from '../src/assessment/scoring/item-payload';

describe('Roadmap progress read model (e2e, izlan_test)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  const sms = new TestSmsAdapter();
  let n = 0;
  let so = 0;
  const uid = () => `${Date.now()}-${n++}`;
  const nextSort = () => so++;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(SMS_PORT).useValue(sms).compile();
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
  async function makeLesson(creatorId: string, topicId: string, opts: { skillIds?: string[]; prereqIds?: string[]; title?: string } = {}) {
    const lesson = await prisma.lesson.create({ data: { topicId, slug: `l-${uid()}`, contentKey: `ck-${uid()}`, sortOrder: nextSort(), status: LessonStatus.PUBLISHED, createdBy: creatorId } });
    const rev = await prisma.lessonRevision.create({ data: { lessonId: lesson.id, version: 1, title: opts.title ?? 'Lesson', status: RevisionStatus.PUBLISHED, createdBy: creatorId, publishedAt: new Date() } });
    await prisma.lesson.update({ where: { id: lesson.id }, data: { publishedRevisionId: rev.id } });
    for (const sid of opts.skillIds ?? []) await prisma.lessonSkill.create({ data: { lessonId: lesson.id, skillId: sid } });
    for (const pid of opts.prereqIds ?? []) await prisma.lessonPrerequisite.create({ data: { lessonId: lesson.id, prerequisiteLessonId: pid } });
    return lesson.id;
  }
  async function revisionOf(lessonId: string) { return (await prisma.lesson.findUnique({ where: { id: lessonId }, select: { publishedRevisionId: true } }))!.publishedRevisionId!; }
  async function completeLesson(userId: string, lessonId: string) { await prisma.learnerLessonCompletion.create({ data: { userId, lessonId, lessonRevisionId: await revisionOf(lessonId), completionNo: 1 } }); }
  async function startLesson(userId: string, lessonId: string) { await prisma.learnerLessonProgress.create({ data: { userId, lessonId, lessonRevisionId: await revisionOf(lessonId), status: LessonProgressStatus.IN_PROGRESS } }); }
  const archiveLesson = (lessonId: string) => prisma.lesson.update({ where: { id: lessonId }, data: { status: LessonStatus.ARCHIVED } });

  const generate = (token: string, attemptId: string) => request(server()).post(`/api/roadmaps/diagnostics/${attemptId}/initial`).set('Authorization', `Bearer ${token}`);
  const getActive = (token: string, subjectId: string) => request(server()).get(`/api/roadmaps/me/subjects/${subjectId}/active`).set('Authorization', `Bearer ${token}`);
  const getById = (token: string, roadmapId: string) => request(server()).get(`/api/roadmaps/${roadmapId}`).set('Authorization', `Bearer ${token}`);
  const reconcile = (token: string, roadmapId: string) => request(server()).post(`/api/roadmaps/${roadmapId}/reconcile`).set('Authorization', `Bearer ${token}`);
  const stateOf = (body: { items: { lesson: { id: string }; state: string }[] }, lessonId: string) => body.items.find((i) => i.lesson.id === lessonId)?.state;

  async function setup(phone: string) {
    const { token, userId } = await makeLearner(phone);
    const { subjectId, trackId } = await makeSubjectTrack(userId);
    const skA = await makeSkill(subjectId, 'Grammar');
    const skB = await makeSkill(subjectId, 'Reading');
    const intent = await makeIntent(userId, subjectId, trackId);
    await seedDiagnostic(userId, subjectId, [{ skillId: skA, difficulty: 2 }, { skillId: skB, difficulty: 5 }]);
    const attemptId = await driveDiagnostic(token, intent.id);
    const topicId = await makeTopic(userId, trackId);
    return { token, userId, subjectId, trackId, skA, skB, attemptId, topicId };
  }

  // ─────────────────────────────────────────────────────────────────────────

  it('read model: derived states, progress summary, nextItemId, deterministic order, lesson title', async () => {
    const s = await setup('+998900000501');
    const lA = await makeLesson(s.userId, s.topicId, { skillIds: [s.skA], title: 'Grammar Basics' });
    const lB = await makeLesson(s.userId, s.topicId, { skillIds: [s.skB], title: 'Reading Basics' });
    const gen = await generate(s.token, s.attemptId);
    const roadmapId = gen.body.roadmap.id;

    const active = await getActive(s.token, s.subjectId);
    expect(active.status).toBe(200);
    expect(active.body).toMatchObject({ id: roadmapId, subjectId: s.subjectId, status: 'ACTIVE' });
    expect(active.body.progress).toEqual({ total: 2, completed: 0, inProgress: 0, available: 2, blocked: 0, unavailable: 0, progressBp: 0 });
    expect(active.body.items.map((i: { position: number }) => i.position)).toEqual([1, 2]); // canonical order
    expect(stateOf(active.body, lA)).toBe('AVAILABLE');
    expect(active.body.items[0].lesson).toEqual({ id: lA, title: 'Grammar Basics' });
    expect(active.body.nextItemId).toBe(active.body.items[0].id); // earliest AVAILABLE
    void lB;
    // GET by id uses the same projector
    expect((await getById(s.token, roadmapId)).body.progress.progressBp).toBe(0);
  });

  it('§27 lesson archived after generation → UNAVAILABLE; item kept; not auto-completed; no draft leak', async () => {
    const s = await setup('+998900000502');
    const lA = await makeLesson(s.userId, s.topicId, { skillIds: [s.skA], title: 'Secret Draft Title' });
    await makeLesson(s.userId, s.topicId, { skillIds: [s.skB] });
    await generate(s.token, s.attemptId);
    await archiveLesson(lA);

    const active = await getActive(s.token, s.subjectId);
    expect(stateOf(active.body, lA)).toBe('UNAVAILABLE');
    expect(active.body.progress.unavailable).toBe(1);
    expect(active.body.status).toBe('ACTIVE'); // not auto-completed
    const item = active.body.items.find((i: { lesson: { id: string } }) => i.lesson.id === lA);
    expect(item.lesson.title).toBeNull(); // no unpublished/archived title leak
    expect(await prisma.roadmapItem.count({ where: { lessonId: lA } })).toBe(1); // item not deleted
  });

  it('§28 completed then archived → still COMPLETED (history wins)', async () => {
    const s = await setup('+998900000503');
    const lA = await makeLesson(s.userId, s.topicId, { skillIds: [s.skA] });
    await makeLesson(s.userId, s.topicId, { skillIds: [s.skB] });
    await generate(s.token, s.attemptId);
    await completeLesson(s.userId, lA);
    await archiveLesson(lA);
    expect(stateOf((await getActive(s.token, s.subjectId)).body, lA)).toBe('COMPLETED');
  });

  it('§29 prerequisite chain transitions A→B→C via completion/progress', async () => {
    const s = await setup('+998900000504');
    const A = await makeLesson(s.userId, s.topicId, { skillIds: [s.skA] });
    const B = await makeLesson(s.userId, s.topicId, { skillIds: [s.skA], prereqIds: [A] });
    const C = await makeLesson(s.userId, s.topicId, { skillIds: [s.skA], prereqIds: [B] });
    await generate(s.token, s.attemptId);

    let b = (await getActive(s.token, s.subjectId)).body;
    expect([stateOf(b, A), stateOf(b, B), stateOf(b, C)]).toEqual(['AVAILABLE', 'BLOCKED', 'BLOCKED']);
    await completeLesson(s.userId, A);
    b = (await getActive(s.token, s.subjectId)).body;
    expect([stateOf(b, A), stateOf(b, B), stateOf(b, C)]).toEqual(['COMPLETED', 'AVAILABLE', 'BLOCKED']);
    await startLesson(s.userId, B);
    expect(stateOf((await getActive(s.token, s.subjectId)).body, B)).toBe('IN_PROGRESS');
    await completeLesson(s.userId, B);
    b = (await getActive(s.token, s.subjectId)).body;
    expect([stateOf(b, B), stateOf(b, C)]).toEqual(['COMPLETED', 'AVAILABLE']);
  });

  it('§30 external prerequisite (completed before generation) gates on completion, not roadmap membership', async () => {
    const s = await setup('+998900000505');
    const P = await makeLesson(s.userId, s.topicId, { skillIds: [s.skB] }); // will be completed before generation → excluded from roadmap
    const C = await makeLesson(s.userId, s.topicId, { skillIds: [s.skA], prereqIds: [P] });
    await completeLesson(s.userId, P);
    await generate(s.token, s.attemptId);
    const active = await getActive(s.token, s.subjectId);
    expect(active.body.items.map((i: { lesson: { id: string } }) => i.lesson.id)).not.toContain(P); // P excluded (completed)
    expect(stateOf(active.body, C)).toBe('AVAILABLE'); // external prereq P satisfied via completion
    // remove the completion → C becomes BLOCKED (membership never implied satisfaction)
    await prisma.learnerLessonCompletion.deleteMany({ where: { userId: s.userId, lessonId: P } });
    expect(stateOf((await getActive(s.token, s.subjectId)).body, C)).toBe('BLOCKED');
  });

  it('§33 all-completed reconcile → ACTIVE→COMPLETED, idempotent; §16 GET does not mutate', async () => {
    const s = await setup('+998900000506');
    const lA = await makeLesson(s.userId, s.topicId, { skillIds: [s.skA] });
    const lB = await makeLesson(s.userId, s.topicId, { skillIds: [s.skB] });
    const gen = await generate(s.token, s.attemptId);
    const roadmapId = gen.body.roadmap.id;
    await completeLesson(s.userId, lA);
    await completeLesson(s.userId, lB);

    // GET must NOT reconcile (§16)
    expect((await getById(s.token, roadmapId)).body.status).toBe('ACTIVE');
    expect((await prisma.learnerRoadmap.findUnique({ where: { id: roadmapId } }))!.status).toBe('ACTIVE');

    const rec = await reconcile(s.token, roadmapId);
    expect(rec.status).toBe(200);
    expect(rec.body).toMatchObject({ status: 'COMPLETED', nextItemId: null });
    expect(rec.body.progress).toMatchObject({ total: 2, completed: 2, progressBp: 10000 });
    const again = await reconcile(s.token, roadmapId);
    expect(again.body.status).toBe('COMPLETED'); // idempotent
  });

  it('§34 partial completion → reconcile keeps ACTIVE', async () => {
    const s = await setup('+998900000507');
    const lA = await makeLesson(s.userId, s.topicId, { skillIds: [s.skA] });
    await makeLesson(s.userId, s.topicId, { skillIds: [s.skB] });
    const gen = await generate(s.token, s.attemptId);
    await completeLesson(s.userId, lA); // only 1 of 2
    const rec = await reconcile(s.token, gen.body.roadmap.id);
    expect(rec.body.status).toBe('ACTIVE');
  });

  it('§35 concurrent reconcile → one transition, both COMPLETED', async () => {
    const s = await setup('+998900000508');
    const lA = await makeLesson(s.userId, s.topicId, { skillIds: [s.skA] });
    const lB = await makeLesson(s.userId, s.topicId, { skillIds: [s.skB] });
    const gen = await generate(s.token, s.attemptId);
    await completeLesson(s.userId, lA);
    await completeLesson(s.userId, lB);
    const [r1, r2] = await Promise.all([reconcile(s.token, gen.body.roadmap.id), reconcile(s.token, gen.body.roadmap.id)]);
    expect([r1.body.status, r2.body.status]).toEqual(['COMPLETED', 'COMPLETED']);
    expect((await prisma.learnerRoadmap.findUnique({ where: { id: gen.body.roadmap.id } }))!.status).toBe('COMPLETED');
  });

  it('§36 completed roadmap: GET by id works; active endpoint excludes it', async () => {
    const s = await setup('+998900000509');
    const lA = await makeLesson(s.userId, s.topicId, { skillIds: [s.skA] });
    const lB = await makeLesson(s.userId, s.topicId, { skillIds: [s.skB] });
    const gen = await generate(s.token, s.attemptId);
    await completeLesson(s.userId, lA);
    await completeLesson(s.userId, lB);
    await reconcile(s.token, gen.body.roadmap.id);

    const byId = await getById(s.token, gen.body.roadmap.id);
    expect(byId.body).toMatchObject({ status: 'COMPLETED', nextItemId: null });
    expect(byId.body.progress).toMatchObject({ completed: 2, total: 2, progressBp: 10000 });
    expect((await getActive(s.token, s.subjectId)).status).toBe(404); // active excludes COMPLETED
  });

  it('§47 security: other user + no-auth cannot read or reconcile', async () => {
    const s = await setup('+998900000510');
    await makeLesson(s.userId, s.topicId, { skillIds: [s.skA] });
    const gen = await generate(s.token, s.attemptId);
    const attacker = await makeLearner('+998900000511');
    expect((await getById(attacker.token, gen.body.roadmap.id)).status).toBe(404);
    expect((await reconcile(attacker.token, gen.body.roadmap.id)).status).toBe(404);
    expect((await request(server()).get(`/api/roadmaps/${gen.body.roadmap.id}`)).status).toBe(401);
    // attacker's reconcile must not have completed the owner's roadmap
    expect((await prisma.learnerRoadmap.findUnique({ where: { id: gen.body.roadmap.id } }))!.status).toBe('ACTIVE');
  });
});
