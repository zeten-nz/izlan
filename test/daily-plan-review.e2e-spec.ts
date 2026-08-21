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

describe('Daily plan review EXTRA (e2e, izlan_test)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  const sms = new TestSmsAdapter();
  const clock = { current: new Date('2026-08-20T06:00:00.000Z'), now() { return this.current; } };
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
    await resetAll();
    await prisma.role.deleteMany();
    await bootstrapSystemRoles(moduleRef.get(AuthorizationRepository));
  });
  afterAll(async () => { await resetAll(); await app.close(); });
  beforeEach(async () => { await resetAll(); sms.clear(); clock.current = new Date('2026-08-20T06:00:00.000Z'); });

  async function resetAll() {
    await prisma.learnerReviewSessionActivity.deleteMany();
    await prisma.learnerReviewSession.deleteMany();
    await prisma.learnerSignal.deleteMany();
    await prisma.skillMeasurement.deleteMany();
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
    const s = await prisma.subject.create({ data: { slug: `s-${uid()}`, title: 'English', status: ContainerStatus.PUBLISHED, sortOrder: nx(), createdBy: creatorId } });
    const t = await prisma.track.create({ data: { subjectId: s.id, slug: `t-${uid()}`, title: 'IELTS', status: ContainerStatus.PUBLISHED, sortOrder: nx(), createdBy: creatorId } });
    return { subjectId: s.id, trackId: t.id };
  };
  const makeSkill = (subjectId: string, name: string) => prisma.skill.create({ data: { subjectId, name: `${name}-${uid()}`, sortOrder: nx() } }).then((s) => s.id);
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
    const level = await prisma.level.create({ data: { trackId, code: `C-${uid()}`, title: 'Lvl', sortOrder: nx(), status: ContainerStatus.PUBLISHED, createdBy: creatorId } });
    const mod = await prisma.module.create({ data: { levelId: level.id, title: 'Mod', sortOrder: nx(), status: ContainerStatus.PUBLISHED, createdBy: creatorId } });
    return (await prisma.topic.create({ data: { moduleId: mod.id, title: 'Top', sortOrder: nx(), status: ContainerStatus.PUBLISHED, createdBy: creatorId } })).id;
  }
  async function makeLesson(creatorId: string, topicId: string, lessonSkillIds: string[]) {
    const lesson = await prisma.lesson.create({ data: { topicId, slug: `l-${uid()}`, contentKey: `ck-${uid()}`, sortOrder: nx(), status: LessonStatus.PUBLISHED, createdBy: creatorId } });
    const rev = await prisma.lessonRevision.create({ data: { lessonId: lesson.id, version: 1, title: 'V1', status: RevisionStatus.PUBLISHED, createdBy: creatorId, publishedAt: new Date() } });
    await prisma.lesson.update({ where: { id: lesson.id }, data: { publishedRevisionId: rev.id } });
    for (const sid of lessonSkillIds) await prisma.lessonSkill.create({ data: { lessonId: lesson.id, skillId: sid } });
    return { lessonId: lesson.id, revisionId: rev.id };
  }
  const seenCompleted = (userId: string, lessonId: string, revisionId: string) => prisma.learnerLessonCompletion.create({ data: { userId, lessonId, lessonRevisionId: revisionId, completionNo: 1 } });
  const seenProgress = (userId: string, lessonId: string, revisionId: string) => prisma.learnerLessonProgress.create({ data: { userId, lessonId, lessonRevisionId: revisionId, status: 'IN_PROGRESS' } });
  const signal = (userId: string, subjectId: string, skillId: string, type = 'WEAK_SKILL') => prisma.learnerSignal.create({ data: { userId, subjectId, skillId, type, status: 'ACTIVE' as never, evidenceRefs: { schemaVersion: 'x' } } });

  const genRoadmap = (token: string, attemptId: string) => request(server()).post(`/api/roadmaps/diagnostics/${attemptId}/initial`).set('Authorization', `Bearer ${token}`);
  const postToday = (token: string) => request(server()).post('/api/daily-plans/today').set('Authorization', `Bearer ${token}`);
  const getToday = (token: string) => request(server()).get('/api/daily-plans/today').set('Authorization', `Bearer ${token}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const extras = (body: any): any[] => body.items.filter((i: any) => i.kind === 'EXTRA');

  /** Diagnostic (skA weak) + a core lesson C1 (skA, uncompleted → roadmap). Returns ids; caller seeds review candidates. */
  async function base(phone: string) {
    const { token, userId } = await makeLearner(phone);
    const { subjectId, trackId } = await makeSubjectTrack(userId);
    const skA = await makeSkill(subjectId, 'Grammar');
    const skB = await makeSkill(subjectId, 'Reading');
    const intent = await makeIntent(userId, subjectId, trackId);
    await seedDiagnostic(userId, subjectId, [{ skillId: skA, difficulty: 2 }, { skillId: skB, difficulty: 5 }]);
    const attemptId = await driveDiagnostic(token, intent.id);
    const topic = await makeTopic(userId, trackId);
    const C1 = await makeLesson(userId, topic, [skA]); // core roadmap lesson (not completed)
    return { token, userId, subjectId, trackId, skA, skB, attemptId, topic, C1 };
  }

  // ───────────────────────────────────────────────────────────────────────────

  it('§48/§46/§60/§68 same-Topic review candidate → one EXTRA (itemType REVIEW, skill); no ReviewSession; no leak', async () => {
    const s = await base('+998900006001');
    const R = await makeLesson(s.userId, s.topic, [s.skA]); // same Topic
    await seenCompleted(s.userId, R.lessonId, R.revisionId); // encountered → excluded from roadmap, eligible as review
    await genRoadmap(s.token, s.attemptId);
    await signal(s.userId, s.subjectId, s.skA); // ACTIVE WEAK_SKILL → R is a candidate

    const body = (await postToday(s.token)).body;
    expect(body.items[0]).toMatchObject({ kind: 'MUST_DO', itemType: 'LESSON', lesson: { id: s.C1.lessonId } });
    const ex = extras(body);
    expect(ex).toHaveLength(1);
    expect(ex[0]).toMatchObject({ kind: 'EXTRA', itemType: 'REVIEW', lesson: { id: R.lessonId }, skill: { id: s.skA }, state: null });
    // §60 no ReviewSession created by planning; §63 no signal mutation
    expect(await prisma.learnerReviewSession.count({ where: { userId: s.userId } })).toBe(0);
    expect(await prisma.learnerSignal.count({ where: { userId: s.userId, status: 'ACTIVE' } })).toBe(1);
    // §68 no raw evidence leak
    expect(JSON.stringify(body)).not.toMatch(/evidenceRefs|triggerActivityIds|dueAt|basisLastMeasurementAt/);
  });

  it('§49 cross-Topic review candidate is NOT auto-inserted (one-topic focus preserved)', async () => {
    const s = await base('+998900006002');
    const topic2 = await makeTopic(s.userId, s.trackId);
    const R = await makeLesson(s.userId, topic2, [s.skA]); // DIFFERENT Topic
    await seenCompleted(s.userId, R.lessonId, R.revisionId);
    await genRoadmap(s.token, s.attemptId);
    await signal(s.userId, s.subjectId, s.skA);
    expect(extras((await postToday(s.token)).body)).toHaveLength(0);
  });

  it('§50 review candidate already in core is not duplicated; another same-Topic candidate chosen instead', async () => {
    const s = await base('+998900006003');
    // C1 is in core + made a candidate (IN_PROGRESS + signal) → must NOT be duplicated as EXTRA
    await seenProgress(s.userId, s.C1.lessonId, s.C1.revisionId);
    const R = await makeLesson(s.userId, s.topic, [s.skA]);
    await seenCompleted(s.userId, R.lessonId, R.revisionId);
    await genRoadmap(s.token, s.attemptId);
    await signal(s.userId, s.subjectId, s.skA);

    const body = (await postToday(s.token)).body;
    const ex = extras(body);
    expect(ex).toHaveLength(1);
    expect(ex[0].lesson.id).toBe(R.lessonId); // not C1
    expect(body.items.filter((i: { lesson: { id: string } }) => i.lesson.id === s.C1.lessonId)).toHaveLength(1); // C1 once (core only)
  });

  it('§51 many same-Topic candidates → exactly one EXTRA', async () => {
    const s = await base('+998900006004');
    for (let i = 0; i < 4; i++) {
      const R = await makeLesson(s.userId, s.topic, [s.skA]);
      await seenCompleted(s.userId, R.lessonId, R.revisionId);
    }
    await genRoadmap(s.token, s.attemptId);
    await signal(s.userId, s.subjectId, s.skA);
    expect(extras((await postToday(s.token)).body)).toHaveLength(1);
  });

  it('§47/§18 no active review signals → 0 EXTRA', async () => {
    const s = await base('+998900006005');
    const R = await makeLesson(s.userId, s.topic, [s.skA]);
    await seenCompleted(s.userId, R.lessonId, R.revisionId);
    await genRoadmap(s.token, s.attemptId);
    // no signal seeded → R is not a candidate
    expect(extras((await postToday(s.token)).body)).toHaveLength(0);
  });

  it('§59 core done/progress ignores the optional EXTRA', async () => {
    const s = await base('+998900006006');
    const R = await makeLesson(s.userId, s.topic, [s.skA]);
    await seenCompleted(s.userId, R.lessonId, R.revisionId);
    await genRoadmap(s.token, s.attemptId);
    await signal(s.userId, s.subjectId, s.skA);
    await postToday(s.token); // snapshot: C1 core (MUST_DO) + R review EXTRA
    // complete the core lesson AFTER the plan exists (snapshot immutable) → core done, EXTRA still present
    await seenCompleted(s.userId, s.C1.lessonId, s.C1.revisionId);

    const body = (await getToday(s.token)).body;
    expect(extras(body)).toHaveLength(1);
    expect(body.progress.total).toBe(1); // core only (EXTRA excluded)
    expect(body.done).toBe(true); // core complete despite EXTRA present
  });

  it('§56/§29/§57 same-day plan is immutable: new signals/candidates do not change the snapshot', async () => {
    const s = await base('+998900006007');
    await genRoadmap(s.token, s.attemptId);
    const first = (await postToday(s.token)).body; // 0 EXTRA (no candidate yet)
    expect(extras(first)).toHaveLength(0);

    // a review candidate becomes available AFTER the plan exists
    const R = await makeLesson(s.userId, s.topic, [s.skA]);
    await seenCompleted(s.userId, R.lessonId, R.revisionId);
    await signal(s.userId, s.subjectId, s.skA);
    const again = (await postToday(s.token)).body;
    expect(again.id).toBe(first.id);
    expect(extras(again)).toHaveLength(0); // §57 no late EXTRA
  });

  it('§64/§69 GET is read-only; generation writes only DailyPlan/DailyPlanItem', async () => {
    const s = await base('+998900006008');
    const R = await makeLesson(s.userId, s.topic, [s.skA]);
    await seenCompleted(s.userId, R.lessonId, R.revisionId);
    await genRoadmap(s.token, s.attemptId);
    await signal(s.userId, s.subjectId, s.skA);
    const before = { sessions: await prisma.learnerReviewSession.count(), attempts: await prisma.activityAttempt.count(), states: await prisma.learnerSkillState.count(), measures: await prisma.skillMeasurement.count(), rewards: await prisma.rewardGrant.count(), notes: await prisma.notification.count() };

    await postToday(s.token);
    const g1 = (await getToday(s.token)).body;
    const g2 = (await getToday(s.token)).body; // GET twice → identical, no mutation
    expect(g2).toEqual(g1);
    expect(extras(g1)).toHaveLength(1);

    const after = { sessions: await prisma.learnerReviewSession.count(), attempts: await prisma.activityAttempt.count(), states: await prisma.learnerSkillState.count(), measures: await prisma.skillMeasurement.count(), rewards: await prisma.rewardGrant.count(), notes: await prisma.notification.count() };
    expect(after).toEqual(before);
    expect(await prisma.aiEvaluation.count()).toBe(0);
  });

  it('§65 concurrent generation → one CURRENT plan, at most one EXTRA', async () => {
    const s = await base('+998900006009');
    const R = await makeLesson(s.userId, s.topic, [s.skA]);
    await seenCompleted(s.userId, R.lessonId, R.revisionId);
    await genRoadmap(s.token, s.attemptId);
    await signal(s.userId, s.subjectId, s.skA);

    const [a, b] = await Promise.all([postToday(s.token), postToday(s.token)]);
    expect(a.body.id).toBe(b.body.id);
    expect(await prisma.dailyPlan.count({ where: { userId: s.userId, status: 'CURRENT' } })).toBe(1);
    expect(await prisma.dailyPlanItem.count({ where: { dailyPlan: { userId: s.userId }, section: 'EXTRA' } })).toBe(1);
  });

  it('§62 manual cross-topic review remains startable (DailyPlan policy does not restrict ReviewSession)', async () => {
    const s = await base('+998900006010');
    const topic2 = await makeTopic(s.userId, s.trackId);
    const R = await makeLesson(s.userId, topic2, [s.skA]); // cross-topic candidate
    await prisma.activity.create({ data: { lessonRevisionId: R.revisionId, type: ActivityType.PRACTICE, position: 1, payload: { schemaVersion: 'lesson-activity-objective/v1', format: 'single_choice', prompt: 'Q', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], answerKey: { correctOptionIds: ['a'] } }, source: ContentSource.HUMAN } });
    await seenCompleted(s.userId, R.lessonId, R.revisionId);
    await genRoadmap(s.token, s.attemptId);
    await signal(s.userId, s.subjectId, s.skA);
    expect(extras((await postToday(s.token)).body)).toHaveLength(0); // not auto-inserted (cross-topic)

    // §62 but manual ReviewSession start for the cross-topic candidate still works
    const start = await request(server()).post(`/api/review-sessions/me/subjects/${s.subjectId}/skills/${s.skA}/lessons/${R.lessonId}/start`).set('Authorization', `Bearer ${s.token}`);
    expect(start.status).toBe(200);
    expect(start.body.status).toBe('ACTIVE');
  });
});
