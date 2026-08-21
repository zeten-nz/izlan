import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ActivityAttemptStatus, ActivityType, AssessmentPurposeScope, ContainerStatus, ContentSource, LessonStatus, RevisionStatus } from '@prisma/client';
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

describe('Learner signals — repeated mistake (e2e, izlan_test)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  const sms = new TestSmsAdapter();
  const clock = { current: new Date('2026-08-20T06:00:00.000Z'), now() { return this.current; } };
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
  beforeEach(async () => { await resetAll(); sms.clear(); clock.current = new Date('2026-08-20T06:00:00.000Z'); });

  async function resetAll() {
    await prisma.learnerSignal.deleteMany();
    await prisma.skillMeasurement.deleteMany();
    await prisma.learnerSkillState.deleteMany();
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
  async function makeLesson(creatorId: string, topicId: string, lessonSkillIds: string[]) {
    const lesson = await prisma.lesson.create({ data: { topicId, slug: `l-${uid()}`, contentKey: `ck-${uid()}`, sortOrder: nextSort(), status: LessonStatus.PUBLISHED, createdBy: creatorId } });
    const rev = await prisma.lessonRevision.create({ data: { lessonId: lesson.id, version: 1, title: 'V1', status: RevisionStatus.PUBLISHED, createdBy: creatorId, publishedAt: new Date() } });
    await prisma.lesson.update({ where: { id: lesson.id }, data: { publishedRevisionId: rev.id } });
    for (const sid of lessonSkillIds) await prisma.lessonSkill.create({ data: { lessonId: lesson.id, skillId: sid } });
    return { lessonId: lesson.id, revisionId: rev.id };
  }
  const objPayload = () => ({ schemaVersion: LESSON_ACTIVITY_OBJECTIVE_SCHEMA_VERSION, format: 'single_choice', prompt: 'Q', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], answerKey: { correctOptionIds: ['a'] } });
  const makeActivity = (revisionId: string, position: number, type: ActivityType = ActivityType.PRACTICE) =>
    prisma.activity.create({ data: { lessonRevisionId: revisionId, type, position, payload: type === ActivityType.PRACTICE || type === ActivityType.MINI_QUESTION || type === ActivityType.MASTERY_TEST ? objPayload() : { note: 'x' }, source: ContentSource.HUMAN } }).then((a) => a.id);
  const mapAS = (activityId: string, skillId: string) => prisma.activitySkill.create({ data: { activityId, skillId } });

  const genRoadmap = (token: string, attemptId: string) => request(server()).post(`/api/roadmaps/diagnostics/${attemptId}/initial`).set('Authorization', `Bearer ${token}`);
  const postToday = (token: string) => request(server()).post('/api/daily-plans/today').set('Authorization', `Bearer ${token}`);
  const startExec = (token: string, dailyPlanItemId: string) => request(server()).post(`/api/lesson-executions/daily-plan-items/${dailyPlanItemId}/start`).set('Authorization', `Bearer ${token}`);
  const submit = (token: string, lessonId: string, activityId: string, correct: boolean, rid = randomUUID()) => {
    clock.current = new Date(clock.current.getTime() + 60_000); // advance 1 min per attempt → distinct submittedAt (same local day), models real submission time (attempts stamp clock.now())
    return request(server()).post(`/api/lesson-executions/${lessonId}/activities/${activityId}/attempts`).set('Authorization', `Bearer ${token}`).send({ clientRequestId: rid, answer: { selectedOptionId: correct ? 'a' : 'b' } });
  };
  const listSignals = (token: string, subjectId: string) => request(server()).get(`/api/learner-signals/me/subjects/${subjectId}`).set('Authorization', `Bearer ${token}`);
  const reconcile = (token: string, subjectId: string) => request(server()).post(`/api/learner-signals/me/subjects/${subjectId}/reconcile`).set('Authorization', `Bearer ${token}`);
  const activeCount = (userId: string, skillId?: string) => prisma.learnerSignal.count({ where: { userId, status: 'ACTIVE', type: 'REPEATED_MISTAKE', ...(skillId ? { skillId } : {}) } });

  /** Diagnostic + roadmap + started MUST_DO lesson A (mapped to skA). Returns ids + started lesson. */
  async function startedLesson(phone: string, activityCount = 6) {
    const { token, userId } = await makeLearner(phone);
    const { subjectId, trackId } = await makeSubjectTrack(userId);
    const skA = await makeSkill(subjectId, 'Grammar');
    const skB = await makeSkill(subjectId, 'Reading');
    const intent = await makeIntent(userId, subjectId, trackId);
    await seedDiagnostic(userId, subjectId, [{ skillId: skA, difficulty: 2 }, { skillId: skB, difficulty: 5 }]);
    const attemptId = await driveDiagnostic(token, intent.id);
    const topic = await makeTopic(userId, trackId);
    const A = await makeLesson(userId, topic, [skA]);
    const acts: string[] = [];
    for (let i = 1; i <= activityCount; i++) acts.push(await makeActivity(A.revisionId, i));
    await genRoadmap(token, attemptId);
    const plan = (await postToday(token)).body;
    const item = plan.items.find((x: { lesson: { id: string } }) => x.lesson.id === A.lessonId)!.id;
    await startExec(token, item);
    return { token, userId, subjectId, trackId, skA, skB, topic, lessonId: A.lessonId, revisionId: A.revisionId, acts };
  }

  // ───────────────────────────────────────────────────────────────────────────

  it('§44/§53/§64/§66 three distinct wrong → ACTIVE signal; read API returns it; only LearnerSignal changes', async () => {
    const s = await startedLesson('+998900001001');
    for (const a of s.acts.slice(0, 3)) await mapAS(a, s.skA);
    const before = { states: await prisma.learnerSkillState.count({ where: { userId: s.userId } }), roadmaps: await prisma.learnerRoadmap.count(), plans: await prisma.dailyPlan.count() };

    await submit(s.token, s.lessonId, s.acts[0], false);
    await submit(s.token, s.lessonId, s.acts[1], false);
    expect(await activeCount(s.userId)).toBe(0); // only two distinct wrong yet
    await submit(s.token, s.lessonId, s.acts[2], false); // third distinct wrong → trigger

    expect(await activeCount(s.userId, s.skA)).toBe(1);
    const list = await listSignals(s.token, s.subjectId);
    expect(list.status).toBe(200);
    expect(list.body.signals).toHaveLength(1);
    expect(list.body.signals[0]).toMatchObject({ type: 'REPEATED_MISTAKE', status: 'ACTIVE', skill: { id: s.skA } });
    expect(JSON.stringify(list.body)).not.toMatch(/answerKey|correctOptionIds|selectedOptionId|triggerAttemptIds/); // §65 no raw evidence leak

    // §66 side-effect boundary — nothing but LearnerSignal changed
    expect(await prisma.learnerSkillState.count({ where: { userId: s.userId } })).toBe(before.states);
    expect(await prisma.learnerRoadmap.count()).toBe(before.roadmaps);
    expect(await prisma.dailyPlan.count()).toBe(before.plans);
    expect(await prisma.learnerLessonCompletion.count({ where: { userId: s.userId } })).toBe(0);
    expect(await prisma.rewardGrant.count()).toBe(0);
    expect(await prisma.aiEvaluation.count()).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('§45/§46/§47 retries + latest-outcome + mixed do NOT trigger', async () => {
    const s = await startedLesson('+998900001002');
    for (const a of s.acts.slice(0, 3)) await mapAS(a, s.skA);
    // §45 same Activity three wrong retries → 1 distinct outcome, never triggers
    await submit(s.token, s.lessonId, s.acts[0], false);
    await submit(s.token, s.lessonId, s.acts[0], false);
    await submit(s.token, s.lessonId, s.acts[0], false);
    expect(await activeCount(s.userId)).toBe(0);
    // §46 latest outcome wins: acts[0] flips to correct BEFORE a 3rd distinct wrong ever co-exists
    await submit(s.token, s.lessonId, s.acts[0], true); // acts[0] latest now correct (overrides earlier wrongs)
    // §47 mixed: two more distinct wrong, but acts[0] stays correct → most-recent-3 never all wrong
    await submit(s.token, s.lessonId, s.acts[1], false);
    await submit(s.token, s.lessonId, s.acts[2], false);
    expect(await activeCount(s.userId)).toBe(0);
  });

  it('§49/§50/§51 recovery resolves; correct retries stay active; recurrence = new episode', async () => {
    const s = await startedLesson('+998900001003', 8);
    for (const a of s.acts) await mapAS(a, s.skA);
    await submit(s.token, s.lessonId, s.acts[0], false);
    await submit(s.token, s.lessonId, s.acts[1], false);
    await submit(s.token, s.lessonId, s.acts[2], false); // ACTIVE
    expect(await activeCount(s.userId, s.skA)).toBe(1);

    // §50 one distinct correct (with a retry) → still active
    await submit(s.token, s.lessonId, s.acts[3], true);
    await submit(s.token, s.lessonId, s.acts[3], true);
    expect(await activeCount(s.userId, s.skA)).toBe(1);

    // §49 second distinct correct → RESOLVED
    await submit(s.token, s.lessonId, s.acts[4], true);
    expect(await activeCount(s.userId, s.skA)).toBe(0);
    expect(await prisma.learnerSignal.count({ where: { userId: s.userId, status: 'RESOLVED' } })).toBe(1);

    // §51 recurrence: three later distinct wrong → NEW active episode, old stays RESOLVED
    await submit(s.token, s.lessonId, s.acts[5], false);
    await submit(s.token, s.lessonId, s.acts[6], false);
    await submit(s.token, s.lessonId, s.acts[7], false);
    expect(await activeCount(s.userId, s.skA)).toBe(1);
    expect(await prisma.learnerSignal.count({ where: { userId: s.userId, skillId: s.skA } })).toBe(2); // one RESOLVED + one ACTIVE
  });

  it('§52 different skills independent — only the 3-wrong skill activates', async () => {
    const s = await startedLesson('+998900001004');
    for (const a of s.acts.slice(0, 3)) await mapAS(a, s.skA);
    await mapAS(s.acts[3], s.skB);
    await submit(s.token, s.lessonId, s.acts[0], false);
    await submit(s.token, s.lessonId, s.acts[1], false);
    await submit(s.token, s.lessonId, s.acts[2], false);
    await submit(s.token, s.lessonId, s.acts[3], false); // only one distinct wrong for skB
    expect(await activeCount(s.userId, s.skA)).toBe(1);
    expect(await activeCount(s.userId, s.skB)).toBe(0);
  });

  it('§54 LessonSkill fallback (no ActivitySkill) attributes to the lesson skill', async () => {
    const s = await startedLesson('+998900001005'); // acts have NO ActivitySkill; lesson maps skA
    await submit(s.token, s.lessonId, s.acts[0], false);
    await submit(s.token, s.lessonId, s.acts[1], false);
    await submit(s.token, s.lessonId, s.acts[2], false);
    expect(await activeCount(s.userId, s.skA)).toBe(1);
  });

  it('§55 no skill mapping → no signal (raw attempts remain)', async () => {
    const s = await startedLesson('+998900001006'); // started; acts have NO ActivitySkill
    await prisma.lessonSkill.deleteMany({ where: { lessonId: s.lessonId } }); // remove the only attribution (LessonSkill)
    for (const a of s.acts.slice(0, 3)) await submit(s.token, s.lessonId, a, false);
    expect(await prisma.learnerSignal.count({ where: { userId: s.userId } })).toBe(0); // unattributed → no signal
    expect(await prisma.activityAttempt.count({ where: { userId: s.userId, activityId: { in: s.acts.slice(0, 3) } } })).toBe(3); // raw attempts remain
  });

  it('§57 cross-subject mapping → no signal', async () => {
    const s = await startedLesson('+998900001007');
    const otherSubject = await prisma.subject.create({ data: { slug: `s-${uid()}`, title: 'Other', status: ContainerStatus.PUBLISHED, sortOrder: nextSort(), createdBy: s.userId } });
    const foreignSkill = await makeSkill(otherSubject.id, 'Foreign');
    for (const a of s.acts.slice(0, 3)) await mapAS(a, foreignSkill); // activity in subject X mapped to skill in subject Y
    await submit(s.token, s.lessonId, s.acts[0], false);
    await submit(s.token, s.lessonId, s.acts[1], false);
    await submit(s.token, s.lessonId, s.acts[2], false);
    expect(await prisma.learnerSignal.count({ where: { userId: s.userId } })).toBe(0); // subject scope blocks it
  });

  it('§58 unsupported-type attempts do not participate in the detector', async () => {
    const s = await startedLesson('+998900001008');
    for (const a of s.acts.slice(0, 2)) await mapAS(a, s.skA);
    await submit(s.token, s.lessonId, s.acts[0], false);
    await submit(s.token, s.lessonId, s.acts[1], false); // two eligible distinct wrong
    // A LISTENING activity + a directly-inserted SUBMITTED attempt (submit API would reject the type).
    const listening = await makeActivity(s.revisionId, 90, ActivityType.LISTENING);
    await mapAS(listening, s.skA);
    await prisma.activityAttempt.create({ data: { userId: s.userId, activityId: listening, lessonRevisionId: s.revisionId, attemptNo: 1, status: ActivityAttemptStatus.SUBMITTED, isCorrect: false, submittedAt: new Date() } });
    const rec = await reconcile(s.token, s.subjectId);
    expect(rec.body.signals).toHaveLength(0); // LISTENING excluded → only 2 eligible distinct → no trigger
  });

  it('§59/§60 network retry idempotent + concurrent trigger → exactly one ACTIVE signal', async () => {
    const s = await startedLesson('+998900001009');
    for (const a of s.acts.slice(0, 4)) await mapAS(a, s.skA);
    await submit(s.token, s.lessonId, s.acts[0], false);
    await submit(s.token, s.lessonId, s.acts[1], false);
    const rid = randomUUID();
    const third = await submit(s.token, s.lessonId, s.acts[2], false, rid); // triggers ACTIVE
    expect(third.status).toBe(200);
    expect(await activeCount(s.userId, s.skA)).toBe(1);
    // §59 replay same clientRequestId → same attempt, evaluation reruns, still one signal
    await submit(s.token, s.lessonId, s.acts[2], false, rid);
    expect(await activeCount(s.userId, s.skA)).toBe(1);
    // §60 concurrent evaluations (two fresh distinct wrong submitted in parallel) → still one ACTIVE
    await Promise.all([submit(s.token, s.lessonId, s.acts[3], false), reconcile(s.token, s.subjectId)]);
    expect(await activeCount(s.userId, s.skA)).toBe(1);
  });

  it('§62/§63 reconcile creates missed signal + resolves on recovery evidence', async () => {
    const s = await startedLesson('+998900001010', 6);
    for (const a of s.acts) await mapAS(a, s.skA);
    // Seed three distinct wrong via direct attempts (bypass the submit auto-eval / fault path).
    for (let i = 0; i < 3; i++) await prisma.activityAttempt.create({ data: { userId: s.userId, activityId: s.acts[i], lessonRevisionId: s.revisionId, attemptNo: 1, status: ActivityAttemptStatus.SUBMITTED, isCorrect: false, submittedAt: new Date(Date.now() + i * 1000) } });
    expect(await activeCount(s.userId, s.skA)).toBe(0); // no auto-eval happened

    const r1 = await reconcile(s.token, s.subjectId);
    expect(r1.body.signals).toHaveLength(1); // §62 created
    const r2 = await reconcile(s.token, s.subjectId);
    expect(r2.body.signals).toHaveLength(1); // idempotent, no duplicate
    expect(await activeCount(s.userId, s.skA)).toBe(1);

    // §63 seed two distinct correct (newer) → reconcile resolves
    for (let i = 3; i < 5; i++) await prisma.activityAttempt.create({ data: { userId: s.userId, activityId: s.acts[i], lessonRevisionId: s.revisionId, attemptNo: 1, status: ActivityAttemptStatus.SUBMITTED, isCorrect: true, submittedAt: new Date(Date.now() + 10_000 + i * 1000) } });
    const r3 = await reconcile(s.token, s.subjectId);
    expect(r3.body.signals).toHaveLength(0);
    expect(await prisma.learnerSignal.count({ where: { userId: s.userId, status: 'RESOLVED' } })).toBe(1);
  });

  it('§64 security: read/reconcile own-user only; no auth → 401; bad id → 400', async () => {
    const s = await startedLesson('+998900001011');
    for (const a of s.acts.slice(0, 3)) await mapAS(a, s.skA);
    for (let i = 0; i < 3; i++) await submit(s.token, s.lessonId, s.acts[i], false);
    expect(await activeCount(s.userId, s.skA)).toBe(1);

    const attacker = await makeLearner('+998900001012');
    expect((await listSignals(attacker.token, s.subjectId)).body.signals).toEqual([]); // never sees victim's signals
    expect((await reconcile(attacker.token, s.subjectId)).body.signals).toEqual([]);
    expect(await activeCount(s.userId, s.skA)).toBe(1); // attacker's reconcile did not touch victim
    expect((await request(server()).get(`/api/learner-signals/me/subjects/${s.subjectId}`)).status).toBe(401);
    expect((await request(server()).get(`/api/learner-signals/me/subjects/not-a-uuid`).set('Authorization', `Bearer ${attacker.token}`)).status).toBe(400);
  });
});
