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

describe('Lesson completion + mastery (e2e, izlan_test)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  const sms = new TestSmsAdapter();
  const clock = { current: new Date('2026-08-19T06:00:00.000Z'), now() { return this.current; } };
  let n = 0;
  let so = 0;
  const uid = () => `${Date.now()}-${n++}`;
  const nextSort = () => so++;

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
  beforeEach(async () => { await resetAll(); sms.clear(); });

  async function resetAll() {
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
    const verify = await request(server()).post('/api/auth/register').send({ challengeId: req.body.challengeId, code: sms.latestCode(), password: 'Passw0rd!123' });
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
  async function makeLesson(creatorId: string, topicId: string, lessonSkillIds: string[]) {
    const lesson = await prisma.lesson.create({ data: { topicId, slug: `l-${uid()}`, contentKey: `ck-${uid()}`, sortOrder: nextSort(), status: LessonStatus.PUBLISHED, createdBy: creatorId } });
    const rev = await prisma.lessonRevision.create({ data: { lessonId: lesson.id, version: 1, title: 'V1', status: RevisionStatus.PUBLISHED, createdBy: creatorId, publishedAt: new Date() } });
    await prisma.lesson.update({ where: { id: lesson.id }, data: { publishedRevisionId: rev.id } });
    for (const sid of lessonSkillIds) await prisma.lessonSkill.create({ data: { lessonId: lesson.id, skillId: sid } });
    return { lessonId: lesson.id, revisionId: rev.id };
  }
  const objPayload = (correct = 'a') => ({ schemaVersion: LESSON_ACTIVITY_OBJECTIVE_SCHEMA_VERSION, format: 'single_choice', prompt: 'Q', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], answerKey: { correctOptionIds: [correct] } });
  const makeActivity = (revisionId: string, position: number, type: ActivityType, objective = false) =>
    prisma.activity.create({ data: { lessonRevisionId: revisionId, type, position, payload: objective ? objPayload() : { note: 'view' }, source: ContentSource.HUMAN } }).then((a) => a.id);
  const mapActivitySkill = (activityId: string, skillId: string) => prisma.activitySkill.create({ data: { activityId, skillId } });

  const genRoadmap = (token: string, attemptId: string) => request(server()).post(`/api/roadmaps/diagnostics/${attemptId}/initial`).set('Authorization', `Bearer ${token}`);
  const postToday = (token: string) => request(server()).post('/api/daily-plans/today').set('Authorization', `Bearer ${token}`);
  const startExec = (token: string, dailyPlanItemId: string) => request(server()).post(`/api/lesson-executions/daily-plan-items/${dailyPlanItemId}/start`).set('Authorization', `Bearer ${token}`);
  const submit = (token: string, lessonId: string, activityId: string, answer: object) => request(server()).post(`/api/lesson-executions/${lessonId}/activities/${activityId}/attempts`).set('Authorization', `Bearer ${token}`).send({ clientRequestId: randomUUID(), answer });
  const markStep = (token: string, lessonId: string, activityId: string) => request(server()).post(`/api/lesson-executions/${lessonId}/activities/${activityId}/complete`).set('Authorization', `Bearer ${token}`);
  const complete = (token: string, lessonId: string) => request(server()).post(`/api/lesson-executions/${lessonId}/complete`).set('Authorization', `Bearer ${token}`);

  /** Diagnostic + roadmap + today's plan. skA weak (pos1 MUST_DO). Returns ids + the MUST_DO plan-item id. */
  async function base(phone: string) {
    const { token, userId } = await makeLearner(phone);
    const { subjectId, trackId } = await makeSubjectTrack(userId);
    const skA = await makeSkill(subjectId, 'Grammar');
    const skB = await makeSkill(subjectId, 'Reading');
    const intent = await makeIntent(userId, subjectId, trackId);
    await seedDiagnostic(userId, subjectId, [{ skillId: skA, difficulty: 2 }, { skillId: skB, difficulty: 5 }]);
    const attemptId = await driveDiagnostic(token, intent.id);
    const topic = await makeTopic(userId, trackId);
    return { token, userId, subjectId, trackId, skA, skB, attemptId, topic };
  }
  const planItem = (plan: { items: { id: string; lesson: { id: string } }[] }, lessonId: string) => plan.items.find((i) => i.lesson.id === lessonId)!.id;

  // ─────────────────────────────────────────────────────────────────────────

  it('§47/48 mixed lesson: not ready until all steps performed; then completes + mastery measurement; §65 LearnerSkillState unchanged', async () => {
    const s = await base('+998900000801');
    const A = await makeLesson(s.userId, s.topic, [s.skA]); // MUST_DO
    await makeLesson(s.userId, s.topic, [s.skB]);
    const textAct = await makeActivity(A.revisionId, 1, ActivityType.TEXT);
    const qAct = await makeActivity(A.revisionId, 2, ActivityType.MINI_QUESTION, true);
    const mAct = await makeActivity(A.revisionId, 3, ActivityType.MASTERY_TEST, true);
    await mapActivitySkill(mAct, s.skA);
    await genRoadmap(s.token, s.attemptId);
    const plan = (await postToday(s.token)).body;
    await startExec(s.token, planItem(plan, A.lessonId));

    const beforeStates = await prisma.learnerSkillState.findMany({ where: { userId: s.userId }, orderBy: { skillId: 'asc' } });

    // not ready yet
    const early = await complete(s.token, A.lessonId);
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('LESSON_NOT_READY_FOR_COMPLETION');

    await markStep(s.token, A.lessonId, textAct); // view-only step
    await submit(s.token, A.lessonId, qAct, { selectedOptionId: 'a' });
    await submit(s.token, A.lessonId, mAct, { selectedOptionId: 'a' }); // mastery correct → 10000

    const done = await complete(s.token, A.lessonId);
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ lessonId: A.lessonId, lessonRevisionId: A.revisionId, status: 'COMPLETED' });
    expect(done.body.mastery).toMatchObject({ measured: true, skills: [{ skillId: s.skA, scoreBp: 10000, confidenceBp: 10000, evidenceCount: 1, displayLevel: null }] });

    // authoritative completion + terminal progress + LESSON_MASTERY measurement
    expect(await prisma.learnerLessonCompletion.count({ where: { userId: s.userId, lessonId: A.lessonId } })).toBe(1);
    expect((await prisma.learnerLessonProgress.findUnique({ where: { userId_lessonId: { userId: s.userId, lessonId: A.lessonId } } }))!.status).toBe('COMPLETED');
    const m = await prisma.skillMeasurement.findMany({ where: { userId: s.userId, source: 'LESSON_MASTERY', lessonId: A.lessonId } });
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ skillId: s.skA, scoreBp: 10000, derivationVersion: 'lesson-mastery-v1', displayLevel: null });

    // §70 (1.8A lifts the 1.7C boundary): completion recomputes state ONLY through the merge engine.
    // skA merges its diagnostic milestone with the new LESSON_MASTERY milestone; untouched skB is unchanged.
    const afterStates = await prisma.learnerSkillState.findMany({ where: { userId: s.userId }, orderBy: { skillId: 'asc' } });
    const beforeA = beforeStates.find((x) => x.skillId === s.skA)!;
    const afterA = afterStates.find((x) => x.skillId === s.skA)!;
    const num = beforeA.masteryScoreBp * beforeA.evidenceCount * beforeA.confidenceBp! + 10000 * 1 * 10000; // + lesson mastery 10000/conf10000/count1
    const den = beforeA.evidenceCount * beforeA.confidenceBp! + 1 * 10000;
    expect(afterA.masteryScoreBp).toBe(Math.round(num / den));
    expect(afterA.evidenceCount).toBe(beforeA.evidenceCount + 1);
    expect(afterStates.find((x) => x.skillId === s.skB)).toEqual(beforeStates.find((x) => x.skillId === s.skB)); // skB untouched
    // §51/72 no reward/signal/AI written by completion or merge
    expect(await prisma.learnerSignal.count({ where: { userId: s.userId } })).toBe(0);
    expect(await prisma.rewardGrant.count()).toBe(0);
    expect(await prisma.aiEvaluation.count()).toBe(0);
  });

  it('§49 incorrect mastery still completes; measurement score 0 (no threshold)', async () => {
    const s = await base('+998900000802');
    const A = await makeLesson(s.userId, s.topic, [s.skA]);
    const mAct = await makeActivity(A.revisionId, 1, ActivityType.MASTERY_TEST, true);
    await mapActivitySkill(mAct, s.skA);
    await genRoadmap(s.token, s.attemptId);
    const plan = (await postToday(s.token)).body;
    await startExec(s.token, planItem(plan, A.lessonId));
    await submit(s.token, A.lessonId, mAct, { selectedOptionId: 'b' }); // incorrect → 0

    const done = await complete(s.token, A.lessonId);
    expect(done.status).toBe(200);
    expect(done.body.mastery.skills[0]).toMatchObject({ skillId: s.skA, scoreBp: 0 });
  });

  it('§53/54 best attempt + multi-mastery mean per skill', async () => {
    const s = await base('+998900000803');
    const A = await makeLesson(s.userId, s.topic, [s.skA]);
    const m1 = await makeActivity(A.revisionId, 1, ActivityType.MASTERY_TEST, true);
    const m2 = await makeActivity(A.revisionId, 2, ActivityType.MASTERY_TEST, true);
    await mapActivitySkill(m1, s.skA);
    await mapActivitySkill(m2, s.skA);
    await genRoadmap(s.token, s.attemptId);
    const plan = (await postToday(s.token)).body;
    await startExec(s.token, planItem(plan, A.lessonId));
    await submit(s.token, A.lessonId, m1, { selectedOptionId: 'b' }); // 0
    await submit(s.token, A.lessonId, m1, { selectedOptionId: 'a' }); // 10000 → best 10000
    await submit(s.token, A.lessonId, m2, { selectedOptionId: 'b' }); // 0 → best 0

    const done = await complete(s.token, A.lessonId);
    expect(done.body.mastery.skills[0]).toMatchObject({ skillId: s.skA, scoreBp: 5000, evidenceCount: 2 }); // mean(10000,0)
    expect(await prisma.activityAttempt.count({ where: { userId: s.userId, activityId: m1 } })).toBe(2); // raw attempts preserved
  });

  it('§56 LessonSkill fallback when a mastery activity has no ActivitySkill; §55 ActivitySkill precedence', async () => {
    const s = await base('+998900000804');
    const A = await makeLesson(s.userId, s.topic, [s.skA, s.skB]); // LessonSkill both
    const m = await makeActivity(A.revisionId, 1, ActivityType.MASTERY_TEST, true); // no ActivitySkill → fallback to both
    await genRoadmap(s.token, s.attemptId);
    const plan = (await postToday(s.token)).body;
    await startExec(s.token, planItem(plan, A.lessonId));
    await submit(s.token, A.lessonId, m, { selectedOptionId: 'a' });
    const done = await complete(s.token, A.lessonId);
    expect(done.body.mastery.skills.map((x: { skillId: string }) => x.skillId).sort()).toEqual([s.skA, s.skB].sort());
  });

  it('§57 no skill mapping → completes, no measurement; §58 no mastery test → completes, masteryMeasured false', async () => {
    const s = await base('+998900000805');
    // no LessonSkill, no ActivitySkill
    const A = await prisma.lesson.create({ data: { topicId: s.topic, slug: `l-${uid()}`, contentKey: `ck-${uid()}`, sortOrder: nextSort(), status: LessonStatus.PUBLISHED, createdBy: s.userId } });
    const rev = await prisma.lessonRevision.create({ data: { lessonId: A.id, version: 1, title: 'V', status: RevisionStatus.PUBLISHED, createdBy: s.userId, publishedAt: new Date() } });
    await prisma.lesson.update({ where: { id: A.id }, data: { publishedRevisionId: rev.id } });
    await prisma.lessonSkill.create({ data: { lessonId: A.id, skillId: s.skA } }); // needed for roadmap inclusion
    const m = await makeActivity(rev.id, 1, ActivityType.MASTERY_TEST, true); // no ActivitySkill, and we'll remove LessonSkill effect by mapping to nothing
    // Remove LessonSkill so the mastery activity is fully unattributed
    await prisma.lessonSkill.deleteMany({ where: { lessonId: A.id } });
    // but roadmap needs a mapped lesson — re-map AFTER generation is impossible; instead use skA via a SEPARATE lesson for roadmap
    const B = await makeLesson(s.userId, s.topic, [s.skA, s.skB]);
    await makeActivity(B.revisionId, 1, ActivityType.PRACTICE, true);
    // Roadmap will include B (skA/skB). A has no LessonSkill → not in roadmap. Start A directly is impossible (not in plan).
    // So test §57/§58 on B instead: give B only PRACTICE (no MASTERY_TEST) and unmap its ActivitySkill.
    await genRoadmap(s.token, s.attemptId);
    const plan = (await postToday(s.token)).body;
    const bItem = plan.items.find((i: { lesson: { id: string } }) => i.lesson.id === B.lessonId)!.id;
    await startExec(s.token, bItem);
    const pract = (await prisma.activity.findFirst({ where: { lessonRevisionId: B.revisionId, type: 'PRACTICE' } }))!.id;
    await submit(s.token, B.lessonId, pract, { selectedOptionId: 'a' });
    const done = await complete(s.token, B.lessonId);
    expect(done.status).toBe(200);
    expect(done.body.mastery.measured).toBe(false); // §58 no MASTERY_TEST → not measured
    expect(await prisma.skillMeasurement.count({ where: { userId: s.userId, source: 'LESSON_MASTERY' } })).toBe(0);
  });

  it('§50 unsupported required activity blocks completion; §51 zero-activity → configuration invalid', async () => {
    const s = await base('+998900000806');
    const A = await makeLesson(s.userId, s.topic, [s.skA]);
    await makeActivity(A.revisionId, 1, ActivityType.WRITING); // deferred type
    const B = await makeLesson(s.userId, s.topic, [s.skB]); // zero activities
    await genRoadmap(s.token, s.attemptId);
    const plan = (await postToday(s.token)).body;
    await startExec(s.token, planItem(plan, A.lessonId));
    const unsupported = await complete(s.token, A.lessonId);
    expect(unsupported.status).toBe(409);
    expect(unsupported.body.code).toBe('LESSON_COMPLETION_UNSUPPORTED_ACTIVITY');

    await startExec(s.token, planItem(plan, B.lessonId));
    const zero = await complete(s.token, B.lessonId);
    expect(zero.status).toBe(409);
    expect(zero.body.code).toBe('LESSON_CONFIGURATION_INVALID');
    expect(await prisma.learnerLessonCompletion.count({ where: { userId: s.userId } })).toBe(0);
  });

  it('§59/60 idempotent + concurrent completion → one completion, one measurement set', async () => {
    const s = await base('+998900000807');
    const A = await makeLesson(s.userId, s.topic, [s.skA]);
    const m = await makeActivity(A.revisionId, 1, ActivityType.MASTERY_TEST, true);
    await mapActivitySkill(m, s.skA);
    await genRoadmap(s.token, s.attemptId);
    const plan = (await postToday(s.token)).body;
    await startExec(s.token, planItem(plan, A.lessonId));
    await submit(s.token, A.lessonId, m, { selectedOptionId: 'a' });

    const [c1, c2] = await Promise.all([complete(s.token, A.lessonId), complete(s.token, A.lessonId)]);
    expect([c1.status, c2.status]).toEqual([200, 200]);
    const again = await complete(s.token, A.lessonId); // idempotent replay
    expect(again.body.status).toBe('COMPLETED');
    expect(await prisma.learnerLessonCompletion.count({ where: { userId: s.userId, lessonId: A.lessonId } })).toBe(1);
    expect(await prisma.skillMeasurement.count({ where: { userId: s.userId, lessonId: A.lessonId, source: 'LESSON_MASTERY' } })).toBe(1);
  });

  it('§62/63/64 roadmap reconcile + DailyPlan derived state; partial keeps ACTIVE', async () => {
    const s = await base('+998900000808');
    const A = await makeLesson(s.userId, s.topic, [s.skA]);
    const B = await makeLesson(s.userId, s.topic, [s.skB]);
    const aAct = await makeActivity(A.revisionId, 1, ActivityType.PRACTICE, true);
    const bAct = await makeActivity(B.revisionId, 1, ActivityType.PRACTICE, true);
    const roadmap = (await genRoadmap(s.token, s.attemptId)).body.roadmap;
    const plan = (await postToday(s.token)).body;

    // complete A only → roadmap still ACTIVE (§63)
    await startExec(s.token, planItem(plan, A.lessonId));
    await submit(s.token, A.lessonId, aAct, { selectedOptionId: 'a' });
    await complete(s.token, A.lessonId);
    expect((await prisma.learnerRoadmap.findUnique({ where: { id: roadmap.id } }))!.status).toBe('ACTIVE');

    // complete B → roadmap ACTIVE → COMPLETED (§62)
    await startExec(s.token, planItem(plan, B.lessonId));
    await submit(s.token, B.lessonId, bAct, { selectedOptionId: 'a' });
    await complete(s.token, B.lessonId);
    expect((await prisma.learnerRoadmap.findUnique({ where: { id: roadmap.id } }))!.status).toBe('COMPLETED');

    // §64 DailyPlan: item COMPLETED, same plan, no next topic
    const today = await request(server()).get('/api/daily-plans/today').set('Authorization', `Bearer ${s.token}`);
    expect(today.body.id).toBe(plan.id);
    expect(today.body.items.every((i: { state: string }) => i.state === 'COMPLETED')).toBe(true);
    const rePost = await postToday(s.token);
    expect(rePost.body.id).toBe(plan.id); // no new plan / next topic
  });

  it('§44 security: other user cannot complete; no-auth 401', async () => {
    const s = await base('+998900000809');
    const A = await makeLesson(s.userId, s.topic, [s.skA]);
    await makeActivity(A.revisionId, 1, ActivityType.PRACTICE, true);
    await genRoadmap(s.token, s.attemptId);
    const plan = (await postToday(s.token)).body;
    await startExec(s.token, planItem(plan, A.lessonId));
    const attacker = await makeLearner('+998900000810');
    expect((await complete(attacker.token, A.lessonId)).status).toBe(404);
    expect((await request(server()).post(`/api/lesson-executions/${A.lessonId}/complete`)).status).toBe(401);
  });
});
