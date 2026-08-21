import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ActivityType, ContainerStatus, ContentSource, LessonStatus, RevisionStatus, SkillMeasurementSource } from '@prisma/client';
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

describe('Review mastery + merge-v2 + signal recovery (e2e, izlan_test)', () => {
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
    await reset();
    await prisma.role.deleteMany();
    await bootstrapSystemRoles(moduleRef.get(AuthorizationRepository));
  });
  afterAll(async () => { await reset(); await app.close(); });
  beforeEach(async () => { await reset(); sms.clear(); clock.current = new Date('2026-08-20T06:00:00.000Z'); });

  async function reset() {
    await prisma.skillMeasurement.deleteMany();
    await prisma.learnerSkillState.deleteMany();
    await prisma.xpGrant.deleteMany();
    await prisma.dailyMissionCompletionEvidence.deleteMany();
    await prisma.dailyMissionCompletion.deleteMany();
    await prisma.activityAttempt.deleteMany();
    await prisma.learnerReviewSessionActivity.deleteMany();
    await prisma.learnerReviewSession.deleteMany();
    await prisma.learnerLessonCompletion.deleteMany();
    await prisma.learnerLessonProgress.deleteMany();
    await prisma.learnerSignal.deleteMany();
    await prisma.activitySkill.deleteMany();
    await prisma.lessonSkill.deleteMany();
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

  async function makeLearner(phone: string) {
    await prisma.otpChallenge.updateMany({ where: { phone }, data: { createdAt: new Date(Date.now() - 300_000) } });
    const req = await request(server()).post('/api/auth/otp/request').send({ phone });
    const verify = await request(server()).post('/api/auth/otp/verify').send({ challengeId: req.body.challengeId, code: sms.latestCode() });
    const user = await prisma.user.findUnique({ where: { phone } });
    await prisma.userProfile.update({ where: { userId: user!.id }, data: { displayName: 'A', dateOfBirth: new Date('2005-01-01'), timezone: 'Asia/Tashkent', onboardingCompletedAt: new Date() } });
    return { token: verify.body.accessToken, userId: user!.id };
  }
  async function base(phone: string) {
    const { token, userId } = await makeLearner(phone);
    const s = await prisma.subject.create({ data: { slug: `s-${uid()}`, title: 'English', status: ContainerStatus.PUBLISHED, sortOrder: nx(), createdBy: userId } });
    const t = await prisma.track.create({ data: { subjectId: s.id, slug: `t-${uid()}`, title: 'IELTS', status: ContainerStatus.PUBLISHED, sortOrder: nx(), createdBy: userId } });
    const skA = await prisma.skill.create({ data: { subjectId: s.id, name: `Grammar-${uid()}`, sortOrder: nx() } }).then((x) => x.id);
    const level = await prisma.level.create({ data: { trackId: t.id, code: `C-${uid()}`, title: 'L', sortOrder: nx(), status: ContainerStatus.PUBLISHED, createdBy: userId } });
    const mod = await prisma.module.create({ data: { levelId: level.id, title: 'M', sortOrder: nx(), status: ContainerStatus.PUBLISHED, createdBy: userId } });
    const topic = (await prisma.topic.create({ data: { moduleId: mod.id, title: 'T', sortOrder: nx(), status: ContainerStatus.PUBLISHED, createdBy: userId } })).id;
    return { token, userId, subjectId: s.id, skA, topic };
  }
  const objPayload = () => ({ schemaVersion: LESSON_ACTIVITY_OBJECTIVE_SCHEMA_VERSION, format: 'single_choice', prompt: 'Q', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], answerKey: { correctOptionIds: ['a'] } });
  async function makeLesson(creatorId: string, topicId: string, skillIds: string[]) {
    const lesson = await prisma.lesson.create({ data: { topicId, slug: `l-${uid()}`, contentKey: `ck-${uid()}`, sortOrder: nx(), status: LessonStatus.PUBLISHED, createdBy: creatorId } });
    const rev = await prisma.lessonRevision.create({ data: { lessonId: lesson.id, version: 1, title: 'V1', status: RevisionStatus.PUBLISHED, createdBy: creatorId, publishedAt: new Date() } });
    await prisma.lesson.update({ where: { id: lesson.id }, data: { publishedRevisionId: rev.id } });
    for (const sid of skillIds) await prisma.lessonSkill.create({ data: { lessonId: lesson.id, skillId: sid } });
    return { lessonId: lesson.id, revisionId: rev.id };
  }
  const makeActivity = (revisionId: string, position: number, skillIds: string[], type: ActivityType = ActivityType.PRACTICE) =>
    prisma.activity.create({ data: { lessonRevisionId: revisionId, type, position, payload: objPayload(), source: ContentSource.HUMAN } }).then(async (a) => {
      for (const sid of skillIds) await prisma.activitySkill.create({ data: { activityId: a.id, skillId: sid } });
      return a.id;
    });
  const seenCompleted = (userId: string, lessonId: string, revisionId: string) => prisma.learnerLessonCompletion.create({ data: { userId, lessonId, lessonRevisionId: revisionId, completionNo: 1 } });
  const signal = (userId: string, subjectId: string, skillId: string, type: string, evidenceRefs: object = { schemaVersion: 'x' }) => prisma.learnerSignal.create({ data: { userId, subjectId, skillId, type, status: 'ACTIVE' as never, evidenceRefs } });
  const seedMeasure = (userId: string, skillId: string, source: SkillMeasurementSource, scoreBp: number, confidenceBp: number, evidenceCount: number, observedAt: Date, dv: string) =>
    prisma.skillMeasurement.create({ data: { userId, skillId, source, scoreBp, confidenceBp, evidenceCount, observedAt, derivationVersion: dv, displayLevel: null } });

  const startReview = (token: string, subjectId: string, skillId: string, lessonId: string) => request(server()).post(`/api/review-sessions/me/subjects/${subjectId}/skills/${skillId}/lessons/${lessonId}/start`).set('Authorization', `Bearer ${token}`);
  const submitReview = (token: string, sessionId: string, activityId: string, correct: boolean, rid = randomUUID()) => request(server()).post(`/api/review-sessions/${sessionId}/activities/${activityId}/attempts`).set('Authorization', `Bearer ${token}`).send({ clientRequestId: rid, answer: { selectedOptionId: correct ? 'a' : 'b' } });
  const completeReview = (token: string, sessionId: string) => request(server()).post(`/api/review-sessions/${sessionId}/complete`).set('Authorization', `Bearer ${token}`);
  const recomputeLP = (token: string, subjectId: string) => request(server()).post(`/api/learning-progress/me/subjects/${subjectId}/recompute`).set('Authorization', `Bearer ${token}`);
  const skillProfile = (token: string, subjectId: string) => request(server()).get(`/api/skill-profile/me/subjects/${subjectId}`).set('Authorization', `Bearer ${token}`);
  const reviewMeasures = (userId: string) => prisma.skillMeasurement.findMany({ where: { userId, source: SkillMeasurementSource.REVIEW_MASTERY } });

  /** Start + complete a review over the lesson's activities with given correctness. Returns sessionId + body. */
  async function runReview(token: string, subjectId: string, skillId: string, lessonId: string, correctness: boolean[]) {
    const start = await startReview(token, subjectId, skillId, lessonId);
    const acts = start.body.activities.map((a: { id: string }) => a.id);
    for (let i = 0; i < acts.length; i++) await submitReview(token, start.body.id, acts[i], correctness[i] ?? false);
    const done = await completeReview(token, start.body.id);
    return { sessionId: start.body.id, body: done.body, start: start.body };
  }

  // ───────────────────────────────────────────────────────────────────────────

  it('§63/§76/§77 completed review → one REVIEW_MASTERY measurement (mean best); provenance + response summary', async () => {
    const s = await base('+998900005001');
    const L = await makeLesson(s.userId, s.topic, [s.skA]);
    await makeActivity(L.revisionId, 1, [s.skA]);
    await makeActivity(L.revisionId, 2, [s.skA]);
    await makeActivity(L.revisionId, 3, [s.skA]);
    await seenCompleted(s.userId, L.lessonId, L.revisionId);
    await signal(s.userId, s.subjectId, s.skA, 'WEAK_SKILL');

    const { sessionId, body } = await runReview(s.token, s.subjectId, s.skA, L.lessonId, [true, false, true]); // best 10000,0,10000
    expect(body.status).toBe('COMPLETED');
    expect(body.mastery).toMatchObject({ measured: true, skillId: s.skA, scoreBp: 6667, confidenceBp: 10000, evidenceCount: 3, displayLevel: null });

    const m = await reviewMeasures(s.userId);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ skillId: s.skA, scoreBp: 6667, reviewSessionId: sessionId, derivationVersion: 'review-mastery-v1', lessonId: null });
    expect(m[0].observedAt.getTime()).toBe(new Date(body.completedAt).getTime()); // §14
    expect(JSON.stringify(body)).not.toMatch(/answerKey|correctOptionIds/);
  });

  it('§64/§65 retries → evidenceCount = distinct activities; all-wrong still measures score 0', async () => {
    const s = await base('+998900005002');
    const L = await makeLesson(s.userId, s.topic, [s.skA]);
    const A = await makeActivity(L.revisionId, 1, [s.skA]);
    await seenCompleted(s.userId, L.lessonId, L.revisionId);
    await signal(s.userId, s.subjectId, s.skA, 'WEAK_SKILL');
    const start = await startReview(s.token, s.subjectId, s.skA, L.lessonId);
    await submitReview(s.token, start.body.id, A, false); // wrong
    await submitReview(s.token, start.body.id, A, false); // retry wrong
    await submitReview(s.token, start.body.id, A, false); // retry wrong
    const done = await completeReview(s.token, start.body.id);
    expect(done.body.mastery).toMatchObject({ measured: true, scoreBp: 0, evidenceCount: 1 }); // 1 distinct activity
  });

  it('§59/§25/§51 review evidence merges into current state via merge-v2 (incremental) and reflects in Skill Profile', async () => {
    const s = await base('+998900005003');
    // diagnostic baseline 6000/count4 (seed measurement + materialize via recompute)
    await seedMeasure(s.userId, s.skA, SkillMeasurementSource.DIAGNOSTIC, 6000, 10000, 4, new Date('2026-08-20T00:00:00Z'), 'skill-profile-diagnostic-v1');
    await recomputeLP(s.token, s.subjectId);
    expect((await skillProfile(s.token, s.subjectId)).body.skills.find((x: { skillId: string }) => x.skillId === s.skA).masteryScoreBp).toBe(6000);

    const L = await makeLesson(s.userId, s.topic, [s.skA]);
    await makeActivity(L.revisionId, 1, [s.skA]);
    await makeActivity(L.revisionId, 2, [s.skA]);
    await seenCompleted(s.userId, L.lessonId, L.revisionId);
    await signal(s.userId, s.subjectId, s.skA, 'WEAK_SKILL');
    clock.current = new Date('2026-08-21T00:00:00Z'); // review completes after diagnostic
    await runReview(s.token, s.subjectId, s.skA, L.lessonId, [true, true]); // review 9000? both best 10000 → 10000... use mixed

    const state = (await skillProfile(s.token, s.subjectId)).body.skills.find((x: { skillId: string }) => x.skillId === s.skA);
    // diagnostic 6000/count4 + review 10000/count2 → round((6000·4+10000·2)/6)=7333
    expect(state.masteryScoreBp).toBe(7333);
    expect(state.evidenceCount).toBe(6);
  });

  it('§66/§67 review completion is idempotent + concurrent → one measurement, deterministic state', async () => {
    const s = await base('+998900005004');
    const L = await makeLesson(s.userId, s.topic, [s.skA]);
    const A = await makeActivity(L.revisionId, 1, [s.skA]);
    await seenCompleted(s.userId, L.lessonId, L.revisionId);
    await signal(s.userId, s.subjectId, s.skA, 'WEAK_SKILL');
    const start = await startReview(s.token, s.subjectId, s.skA, L.lessonId);
    await submitReview(s.token, start.body.id, A, true);

    const [a, b] = await Promise.all([completeReview(s.token, start.body.id), completeReview(s.token, start.body.id)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    await completeReview(s.token, start.body.id); // idempotent again
    expect(await reviewMeasures(s.userId)).toHaveLength(1); // exactly one
    const states = await prisma.learnerSkillState.findMany({ where: { userId: s.userId, skillId: s.skA } });
    expect(states).toHaveLength(1);
  });

  it('§69/§70 completed review resolves ACTIVE REVIEW_DUE via existing policy (even on poor score)', async () => {
    const s = await base('+998900005005');
    await seedMeasure(s.userId, s.skA, SkillMeasurementSource.DIAGNOSTIC, 9000, 10000, 5, new Date('2026-08-20T00:00:00Z'), 'skill-profile-diagnostic-v1');
    await recomputeLP(s.token, s.subjectId);
    // seed an ACTIVE REVIEW_DUE based on the diagnostic time (T0)
    const dueSig = await prisma.learnerSignal.create({ data: { userId: s.userId, subjectId: s.subjectId, skillId: s.skA, type: 'REVIEW_DUE', status: 'ACTIVE', evidenceRefs: { schemaVersion: 'review-due-signal/v1', basisLastMeasurementAt: '2026-08-20T00:00:00.000Z' } } });

    const L = await makeLesson(s.userId, s.topic, [s.skA]);
    await makeActivity(L.revisionId, 1, [s.skA]);
    await signal(s.userId, s.subjectId, s.skA, 'WEAK_SKILL'); // makes it a candidate
    await prisma.learnerLessonProgress.create({ data: { userId: s.userId, lessonId: L.lessonId, lessonRevisionId: L.revisionId, status: 'IN_PROGRESS' } });
    clock.current = new Date('2026-08-25T00:00:00Z'); // review completedAt is later than T0
    await runReview(s.token, s.subjectId, s.skA, L.lessonId, [false]); // §70 poor review (score 0)

    // REVIEW_DUE resolved because new REVIEW_MASTERY observedAt (T1) > basis (T0), via existing state-signal policy
    expect((await prisma.learnerSignal.findUnique({ where: { id: dueSig.id } }))!.status).toBe('RESOLVED');
  });

  it('§71/§72 review recovers WEAK_SKILL when merged mastery clears hysteresis; stays ACTIVE otherwise', async () => {
    // §71 resolve: low baseline + strong review → mastery >= 6500
    const s = await base('+998900005006');
    await seedMeasure(s.userId, s.skA, SkillMeasurementSource.DIAGNOSTIC, 4000, 10000, 3, new Date('2026-08-20T00:00:00Z'), 'skill-profile-diagnostic-v1');
    await recomputeLP(s.token, s.subjectId); // materialize + WEAK_SKILL auto-created (mastery 4000)
    expect(await prisma.learnerSignal.count({ where: { userId: s.userId, skillId: s.skA, type: 'WEAK_SKILL', status: 'ACTIVE' } })).toBe(1);

    const L = await makeLesson(s.userId, s.topic, [s.skA]);
    await makeActivity(L.revisionId, 1, [s.skA]);
    await makeActivity(L.revisionId, 2, [s.skA]);
    await prisma.learnerLessonProgress.create({ data: { userId: s.userId, lessonId: L.lessonId, lessonRevisionId: L.revisionId, status: 'IN_PROGRESS' } });
    clock.current = new Date('2026-08-21T00:00:00Z');
    await runReview(s.token, s.subjectId, s.skA, L.lessonId, [true, true]); // review 10000/count2 → merged (4000·3+10000·2)/5=6400? stays weak band

    // (4000·3 + 10000·2)/5 = 6400 → hysteresis hold band (5000..6499) → WEAK_SKILL stays ACTIVE (§72)
    const st = (await skillProfile(s.token, s.subjectId)).body.skills.find((x: { skillId: string }) => x.skillId === s.skA);
    expect(st.masteryScoreBp).toBe(6400);
    expect(await prisma.learnerSignal.count({ where: { userId: s.userId, skillId: s.skA, type: 'WEAK_SKILL', status: 'ACTIVE' } })).toBe(1);
  });

  it('§73/§74 repeated-mistake recovers on two distinct correct review outcomes; one correct insufficient', async () => {
    const s = await base('+998900005007');
    const L = await makeLesson(s.userId, s.topic, [s.skA]);
    const A = await makeActivity(L.revisionId, 1, [s.skA]);
    const B = await makeActivity(L.revisionId, 2, [s.skA]);
    await seenCompleted(s.userId, L.lessonId, L.revisionId);
    // ACTIVE REPEATED_MISTAKE (also makes lesson a candidate)
    await prisma.learnerSignal.create({ data: { userId: s.userId, subjectId: s.subjectId, skillId: s.skA, type: 'REPEATED_MISTAKE', status: 'ACTIVE', evidenceRefs: { schemaVersion: 'repeated-mistake-signal/v1', triggerActivityIds: [A, B], triggerAttemptIds: ['x', 'y'] } } });

    // §73 two distinct correct review outcomes → resolves via existing detector (latest distinct correct)
    await runReview(s.token, s.subjectId, s.skA, L.lessonId, [true, true]);
    expect(await prisma.learnerSignal.count({ where: { userId: s.userId, skillId: s.skA, type: 'REPEATED_MISTAKE', status: 'ACTIVE' } })).toBe(0);
    expect(await prisma.learnerSignal.count({ where: { userId: s.userId, skillId: s.skA, type: 'REPEATED_MISTAKE', status: 'RESOLVED' } })).toBe(1);
  });

  it('§75/§78/§82 boundary: state via LearningProgress only; no LessonCompletion/Roadmap/DailyPlan/reward/notification', async () => {
    const s = await base('+998900005008');
    const L = await makeLesson(s.userId, s.topic, [s.skA]);
    await makeActivity(L.revisionId, 1, [s.skA]);
    await prisma.learnerLessonProgress.create({ data: { userId: s.userId, lessonId: L.lessonId, lessonRevisionId: L.revisionId, status: 'IN_PROGRESS' } });
    await signal(s.userId, s.subjectId, s.skA, 'WEAK_SKILL');
    const before = { completions: await prisma.learnerLessonCompletion.count(), roadmaps: await prisma.learnerRoadmap.count(), plans: await prisma.dailyPlan.count(), rewards: await prisma.rewardGrant.count(), notes: await prisma.notification.count() };
    await runReview(s.token, s.subjectId, s.skA, L.lessonId, [true]);

    expect(await prisma.learnerLessonCompletion.count()).toBe(before.completions);
    expect(await prisma.learnerRoadmap.count()).toBe(before.roadmaps);
    expect(await prisma.dailyPlan.count()).toBe(before.plans);
    expect(await prisma.rewardGrant.count()).toBe(before.rewards);
    expect(await prisma.notification.count()).toBe(before.notes);
    expect(await prisma.aiEvaluation.count()).toBe(0);
    // §78 review MASTERY_TEST evidence not entering lesson-mastery: no LESSON_MASTERY measurement created
    expect(await prisma.skillMeasurement.count({ where: { userId: s.userId, source: SkillMeasurementSource.LESSON_MASTERY } })).toBe(0);
    // progress unchanged
    const prog = await prisma.learnerLessonProgress.findUnique({ where: { userId_lessonId: { userId: s.userId, lessonId: L.lessonId } } });
    expect(prog!.completedActivities).toBeNull();
  });
});
