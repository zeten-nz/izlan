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
import { bootstrapSystemRoles } from '../src/bootstrap/system-roles';
import { cleanupAuthTables, cleanupAssessmentTables, cleanupRoadmapContent } from './test-db.helper';
import { TestSmsAdapter } from './test-sms.adapter';
import { PLACEMENT_CONFIG_SCHEMA_VERSION, PLACEMENT_ENGINE_VERSION } from '../src/assessment/engine/placement-engine.types';
import { PLACEMENT_ITEM_SCHEMA_VERSION } from '../src/assessment/scoring/item-payload';

describe('Roadmap foundation (e2e, izlan_test)', () => {
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

  async function makeLearner(phone: string): Promise<{ token: string; userId: string }> {
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
  const diagConfig = (skillCount: number) => ({
    schemaVersion: PLACEMENT_CONFIG_SCHEMA_VERSION, engine: PLACEMENT_ENGINE_VERSION,
    selection: { startDifficulty: 3, stepUp: 1, stepDown: 1 }, coverage: { itemsPerSkill: 1 },
    stopping: { maxItems: skillCount }, profileScale: { minDifficulty: 1, maxDifficulty: 6 },
  });
  // Seed a DIAGNOSTIC definition: one item per skill at a chosen difficulty (mastery = difficulty).
  async function seedDiagnostic(creatorId: string, subjectId: string, items: { skillId: string; difficulty: number }[]) {
    const def = await prisma.assessmentDefinition.create({ data: { subjectId, purposeScope: AssessmentPurposeScope.DIAGNOSTIC, title: 'Placement', status: ContainerStatus.PUBLISHED, createdBy: creatorId } });
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

  async function makeTopic(creatorId: string, trackId: string): Promise<string> {
    const level = await prisma.level.create({ data: { trackId, code: `C-${uid()}`, title: 'Lvl', sortOrder: nextSort(), status: ContainerStatus.PUBLISHED, createdBy: creatorId } });
    const mod = await prisma.module.create({ data: { levelId: level.id, title: 'Mod', sortOrder: nextSort(), status: ContainerStatus.PUBLISHED, createdBy: creatorId } });
    const topic = await prisma.topic.create({ data: { moduleId: mod.id, title: 'Top', sortOrder: nextSort(), status: ContainerStatus.PUBLISHED, createdBy: creatorId } });
    return topic.id;
  }
  interface LessonOpts { status?: LessonStatus; published?: boolean; skillIds?: string[]; prereqIds?: string[] }
  async function makeLesson(creatorId: string, topicId: string, opts: LessonOpts = {}): Promise<string> {
    const lesson = await prisma.lesson.create({ data: { topicId, slug: `l-${uid()}`, sortOrder: nextSort(), status: opts.status ?? LessonStatus.PUBLISHED, createdBy: creatorId } });
    if (opts.published ?? true) {
      const rev = await prisma.lessonRevision.create({ data: { lessonId: lesson.id, version: 1, title: 'L', status: RevisionStatus.PUBLISHED, createdBy: creatorId, publishedAt: new Date() } });
      await prisma.lesson.update({ where: { id: lesson.id }, data: { publishedRevisionId: rev.id } });
    }
    for (const sid of opts.skillIds ?? []) await prisma.lessonSkill.create({ data: { lessonId: lesson.id, skillId: sid } });
    for (const pid of opts.prereqIds ?? []) await prisma.lessonPrerequisite.create({ data: { lessonId: lesson.id, prerequisiteLessonId: pid } });
    return lesson.id;
  }
  async function completeLesson(userId: string, lessonId: string) {
    const l = await prisma.lesson.findUnique({ where: { id: lessonId }, select: { publishedRevisionId: true } });
    await prisma.learnerLessonCompletion.create({ data: { userId, lessonId, lessonRevisionId: l!.publishedRevisionId!, completionNo: 1 } });
  }

  const generate = (token: string, attemptId: string) => request(server()).post(`/api/roadmaps/diagnostics/${attemptId}/initial`).set('Authorization', `Bearer ${token}`);
  const getActive = (token: string, subjectId: string) => request(server()).get(`/api/roadmaps/me/subjects/${subjectId}/active`).set('Authorization', `Bearer ${token}`);
  const getById = (token: string, roadmapId: string) => request(server()).get(`/api/roadmaps/${roadmapId}`).set('Authorization', `Bearer ${token}`);

  /** skA weak (difficulty 2 → gap 8000), skB strong (difficulty 5 → gap 2000). Returns ids + attempt. */
  async function baseSetup(phone: string) {
    const { token, userId } = await makeLearner(phone);
    const { subjectId, trackId } = await makeSubjectTrack(userId);
    const skA = await makeSkill(subjectId, 'Grammar');
    const skB = await makeSkill(subjectId, 'Reading');
    const intent = await makeIntent(userId, subjectId, trackId);
    await seedDiagnostic(userId, subjectId, [{ skillId: skA, difficulty: 2 }, { skillId: skB, difficulty: 5 }]);
    const attemptId = await driveDiagnostic(token, intent.id);
    const topicId = await makeTopic(userId, trackId);
    return { token, userId, subjectId, trackId, skA, skB, attemptId, topicId, intentId: intent.id };
  }

  // ─────────────────────────────────────────────────────────────────────────

  it('generates a deterministic ACTIVE roadmap ordered by gap priority; provenance + no side-effects', async () => {
    const s = await baseSetup('+998900000401');
    const lessonA = await makeLesson(s.userId, s.topicId, { skillIds: [s.skA] }); // weak skill (higher gap)
    const lessonB = await makeLesson(s.userId, s.topicId, { skillIds: [s.skB] }); // strong skill (lower gap)

    const res = await generate(s.token, s.attemptId);
    expect(res.status).toBe(200);
    expect(res.body.roadmap).toMatchObject({ subjectId: s.subjectId, trackId: s.trackId, status: 'ACTIVE', sourceAssessmentAttemptId: s.attemptId });
    expect(res.body.uncoveredSkillIds).toEqual([]);
    const items = res.body.roadmap.items;
    expect(items.map((i: { lessonId: string }) => i.lessonId)).toEqual([lessonA, lessonB]); // gap: skA(8000) before skB(2000)
    expect(items.map((i: { position: number }) => i.position)).toEqual([1, 2]);
    expect(items.every((i: { itemType: string }) => i.itemType === 'LESSON')).toBe(true);
    expect(items[0].skillId).toBe(s.skA); // originating-skill provenance
    const dbItems = await prisma.roadmapItem.findMany({ where: { roadmap: { id: res.body.roadmap.id } } });
    expect(dbItems.every((i) => i.source === 'INITIAL_GENERATION')).toBe(true);

    // read-only against learning state; no downstream layers (§30-34/66)
    const beforeStates = await prisma.learnerSkillState.count({ where: { userId: s.userId } });
    expect(beforeStates).toBe(2); // from auto-derivation, unchanged
    expect(await prisma.skillMeasurement.count({ where: { userId: s.userId } })).toBe(2);
    expect(await prisma.learnerLessonProgress.count({ where: { userId: s.userId } })).toBe(0);
    expect(await prisma.dailyPlan.count({ where: { userId: s.userId } })).toBe(0);
    expect(await prisma.learnerSignal.count({ where: { userId: s.userId } })).toBe(0);
    expect(await prisma.xpGrant.count({ where: { userId: s.userId } })).toBe(0);
    expect(await prisma.aiEvaluation.count()).toBe(0);
  });

  it('§42 only learner-visible published content is selected', async () => {
    const s = await baseSetup('+998900000402');
    const good = await makeLesson(s.userId, s.topicId, { skillIds: [s.skA] });
    await makeLesson(s.userId, s.topicId, { status: LessonStatus.DRAFT, skillIds: [s.skA] });
    await makeLesson(s.userId, s.topicId, { status: LessonStatus.ARCHIVED, skillIds: [s.skA] });
    await makeLesson(s.userId, s.topicId, { published: false, skillIds: [s.skA] }); // no published revision
    const res = await generate(s.token, s.attemptId);
    expect(res.body.roadmap.items.map((i: { lessonId: string }) => i.lessonId)).toEqual([good]);
  });

  it('§43 selection follows explicit LessonSkill mapping only (no title inference)', async () => {
    const s = await baseSetup('+998900000403');
    const mapped = await makeLesson(s.userId, s.topicId, { skillIds: [s.skA] });
    await makeLesson(s.userId, s.topicId, { skillIds: [] }); // unmapped, even if it "looked like" Grammar
    const res = await generate(s.token, s.attemptId);
    expect(res.body.roadmap.items.map((i: { lessonId: string }) => i.lessonId)).toEqual([mapped]);
  });

  it('§44 completed lessons excluded; unrelated in-progress kept', async () => {
    const s = await baseSetup('+998900000404');
    const done = await makeLesson(s.userId, s.topicId, { skillIds: [s.skA] });
    const todo = await makeLesson(s.userId, s.topicId, { skillIds: [s.skA] });
    await completeLesson(s.userId, done);
    const res = await generate(s.token, s.attemptId);
    const ids = res.body.roadmap.items.map((i: { lessonId: string }) => i.lessonId);
    expect(ids).toContain(todo);
    expect(ids).not.toContain(done);
  });

  it('§45 prerequisite closure ordered A→B→C, no duplicates', async () => {
    const s = await baseSetup('+998900000405');
    const A = await makeLesson(s.userId, s.topicId, { skillIds: [s.skA] });
    const B = await makeLesson(s.userId, s.topicId, { skillIds: [s.skA], prereqIds: [A] });
    const C = await makeLesson(s.userId, s.topicId, { skillIds: [s.skA], prereqIds: [B] });
    const res = await generate(s.token, s.attemptId);
    const ids = res.body.roadmap.items.map((i: { lessonId: string }) => i.lessonId);
    expect(ids.filter((x: string) => [A, B, C].includes(x))).toEqual([A, B, C]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('§46 cross-skill prerequisite appears before its higher-gap dependent', async () => {
    const s = await baseSetup('+998900000406');
    const bLesson = await makeLesson(s.userId, s.topicId, { skillIds: [s.skB] }); // low-gap skill B
    const aLesson = await makeLesson(s.userId, s.topicId, { skillIds: [s.skA], prereqIds: [bLesson] }); // high-gap A requires B
    const res = await generate(s.token, s.attemptId);
    const ids = res.body.roadmap.items.map((i: { lessonId: string }) => i.lessonId);
    expect(ids.indexOf(bLesson)).toBeLessThan(ids.indexOf(aLesson));
  });

  it('§47 a lesson mapped to two skills appears once', async () => {
    const s = await baseSetup('+998900000407');
    const shared = await makeLesson(s.userId, s.topicId, { skillIds: [s.skA, s.skB] });
    const res = await generate(s.token, s.attemptId);
    const ids = res.body.roadmap.items.map((i: { lessonId: string }) => i.lessonId);
    expect(ids.filter((x: string) => x === shared)).toHaveLength(1);
  });

  it('§48 uncovered skill reported; covered skills still generate', async () => {
    const s = await baseSetup('+998900000408');
    const lessonA = await makeLesson(s.userId, s.topicId, { skillIds: [s.skA] }); // skB has NO content
    const res = await generate(s.token, s.attemptId);
    expect(res.body.roadmap.items.map((i: { lessonId: string }) => i.lessonId)).toEqual([lessonA]);
    expect(res.body.uncoveredSkillIds).toEqual([s.skB]);
  });

  it('§49 no eligible content → 409, no ACTIVE roadmap created', async () => {
    const s = await baseSetup('+998900000409'); // no lessons at all
    const res = await generate(s.token, s.attemptId);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ROADMAP_NO_ELIGIBLE_CONTENT');
    expect(await prisma.learnerRoadmap.count({ where: { userId: s.userId } })).toBe(0);
  });

  it('§50 concurrent generation → exactly one roadmap', async () => {
    const s = await baseSetup('+998900000410');
    await makeLesson(s.userId, s.topicId, { skillIds: [s.skA] });
    const [r1, r2] = await Promise.all([generate(s.token, s.attemptId), generate(s.token, s.attemptId)]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect(r1.body.roadmap.id).toBe(r2.body.roadmap.id);
    expect(await prisma.learnerRoadmap.count({ where: { userId: s.userId, subjectId: s.subjectId, status: 'ACTIVE' } })).toBe(1);
  });

  it('§52 same-source retry is idempotent (same roadmap + items)', async () => {
    const s = await baseSetup('+998900000411');
    await makeLesson(s.userId, s.topicId, { skillIds: [s.skA] });
    const first = await generate(s.token, s.attemptId);
    const again = await generate(s.token, s.attemptId);
    expect(again.body.roadmap.id).toBe(first.body.roadmap.id);
    expect(again.body.roadmap.items.map((i: { id: string }) => i.id)).toEqual(first.body.roadmap.items.map((i: { id: string }) => i.id));
  });

  it('§51 different-source diagnostic → 409 ROADMAP_ALREADY_ACTIVE (no replacement)', async () => {
    const s = await baseSetup('+998900000412');
    await makeLesson(s.userId, s.topicId, { skillIds: [s.skA] });
    const first = await generate(s.token, s.attemptId);
    const attempt2 = await driveDiagnostic(s.token, s.intentId); // a second completed diagnostic, same subject
    const res = await generate(s.token, attempt2);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ROADMAP_ALREADY_ACTIVE');
    expect(await prisma.learnerRoadmap.count({ where: { userId: s.userId, subjectId: s.subjectId, status: 'ACTIVE' } })).toBe(1);
    expect((await getActive(s.token, s.subjectId)).body.id).toBe(first.body.roadmap.id);
  });

  it('§53 ranking uses the exact diagnostic snapshot, not mutable current state', async () => {
    const s = await baseSetup('+998900000413');
    const lessonA = await makeLesson(s.userId, s.topicId, { skillIds: [s.skA] });
    const lessonB = await makeLesson(s.userId, s.topicId, { skillIds: [s.skB] });
    // Corrupt current state so it would invert priorities if it were the source.
    await prisma.learnerSkillState.updateMany({ where: { userId: s.userId, skillId: s.skA }, data: { masteryScoreBp: 10000, confidenceBp: 10000 } });
    await prisma.learnerSkillState.deleteMany({ where: { userId: s.userId, skillId: s.skB } });
    const res = await generate(s.token, s.attemptId);
    // Order still reflects the SkillMeasurement snapshot (skA weak → first), not the mutated state.
    expect(res.body.roadmap.items.map((i: { lessonId: string }) => i.lessonId)).toEqual([lessonA, lessonB]);
  });

  it('§54 security: other user + no-auth cannot generate or read', async () => {
    const s = await baseSetup('+998900000414');
    await makeLesson(s.userId, s.topicId, { skillIds: [s.skA] });
    const mine = await generate(s.token, s.attemptId);
    const attacker = await makeLearner('+998900000415');
    expect((await generate(attacker.token, s.attemptId)).status).toBe(404);
    expect((await getById(attacker.token, mine.body.roadmap.id)).status).toBe(404);
    expect((await request(server()).get(`/api/roadmaps/${mine.body.roadmap.id}`)).status).toBe(401);
    expect((await getActive(s.token, s.subjectId)).body.id).toBe(mine.body.roadmap.id);
  });

  it('GET active → 404 when none', async () => {
    const s = await baseSetup('+998900000416');
    expect((await getActive(s.token, s.subjectId)).status).toBe(404);
  });
});
