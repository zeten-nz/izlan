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
import { bootstrapSystemRoles } from '../src/bootstrap/system-roles';
import { cleanupAuthTables } from './test-db.helper';
import { TestSmsAdapter } from './test-sms.adapter';
import { LESSON_ACTIVITY_OBJECTIVE_SCHEMA_VERSION } from '../src/lesson-execution/activity/objective-activity-payload';

describe('Review session (e2e, izlan_test)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  const sms = new TestSmsAdapter();
  let n = 0;
  let so = 0;
  const uid = () => `${Date.now()}-${n++}`;
  const nx = () => so++;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(SMS_PORT).useValue(sms).compile();
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
  beforeEach(async () => { await reset(); sms.clear(); });

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
  async function makeSubjectTrack(creatorId: string) {
    const s = await prisma.subject.create({ data: { slug: `s-${uid()}`, title: 'English', status: ContainerStatus.PUBLISHED, sortOrder: nx(), createdBy: creatorId } });
    const t = await prisma.track.create({ data: { subjectId: s.id, slug: `t-${uid()}`, title: 'IELTS', status: ContainerStatus.PUBLISHED, sortOrder: nx(), createdBy: creatorId } });
    return { subjectId: s.id, trackId: t.id };
  }
  const makeSkill = (subjectId: string, name: string) => prisma.skill.create({ data: { subjectId, name: `${name}-${uid()}`, sortOrder: nx() } }).then((s) => s.id);
  async function makeTopic(creatorId: string, trackId: string) {
    const level = await prisma.level.create({ data: { trackId, code: `C-${uid()}`, title: 'Lvl', sortOrder: nx(), status: ContainerStatus.PUBLISHED, createdBy: creatorId } });
    const mod = await prisma.module.create({ data: { levelId: level.id, title: 'Mod', sortOrder: nx(), status: ContainerStatus.PUBLISHED, createdBy: creatorId } });
    return (await prisma.topic.create({ data: { moduleId: mod.id, title: 'Top', sortOrder: nx(), status: ContainerStatus.PUBLISHED, createdBy: creatorId } })).id;
  }
  async function makeLesson(creatorId: string, topicId: string, lessonSkillIds: string[] = [], title = 'Lesson') {
    const lesson = await prisma.lesson.create({ data: { topicId, slug: `l-${uid()}`, sortOrder: nx(), status: LessonStatus.PUBLISHED, createdBy: creatorId } });
    const rev = await prisma.lessonRevision.create({ data: { lessonId: lesson.id, version: 1, title, status: RevisionStatus.PUBLISHED, createdBy: creatorId, publishedAt: new Date() } });
    await prisma.lesson.update({ where: { id: lesson.id }, data: { publishedRevisionId: rev.id } });
    for (const sid of lessonSkillIds) await prisma.lessonSkill.create({ data: { lessonId: lesson.id, skillId: sid } });
    return { lessonId: lesson.id, revisionId: rev.id };
  }
  const objPayload = () => ({ schemaVersion: LESSON_ACTIVITY_OBJECTIVE_SCHEMA_VERSION, format: 'single_choice', prompt: 'Q', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], answerKey: { correctOptionIds: ['a'] } });
  const makeActivity = (revisionId: string, position: number, type: ActivityType = ActivityType.PRACTICE, skillIds: string[] = []) =>
    prisma.activity.create({ data: { lessonRevisionId: revisionId, type, position, payload: objPayload(), source: ContentSource.HUMAN } }).then(async (a) => {
      for (const sid of skillIds) await prisma.activitySkill.create({ data: { activityId: a.id, skillId: sid } });
      return a.id;
    });
  async function publishV2(creatorId: string, lessonId: string) {
    await prisma.lessonRevision.updateMany({ where: { lessonId, status: RevisionStatus.PUBLISHED }, data: { status: RevisionStatus.ARCHIVED } });
    const v2 = await prisma.lessonRevision.create({ data: { lessonId, version: 2, title: 'V2', status: RevisionStatus.PUBLISHED, createdBy: creatorId, publishedAt: new Date() } });
    await prisma.lesson.update({ where: { id: lessonId }, data: { publishedRevisionId: v2.id } });
    return v2.id;
  }
  const seenProgress = (userId: string, lessonId: string, revisionId: string) => prisma.learnerLessonProgress.create({ data: { userId, lessonId, lessonRevisionId: revisionId, status: 'IN_PROGRESS' } });
  const seenCompleted = (userId: string, lessonId: string, revisionId: string) => prisma.learnerLessonCompletion.create({ data: { userId, lessonId, lessonRevisionId: revisionId, completionNo: 1 } });
  const signal = (userId: string, subjectId: string, skillId: string, type = 'WEAK_SKILL', status = 'ACTIVE', evidenceRefs: object = { schemaVersion: 'weak-skill-signal/v1' }) =>
    prisma.learnerSignal.create({ data: { userId, subjectId, skillId, type, status: status as never, evidenceRefs } });

  const startReview = (token: string, subjectId: string, skillId: string, lessonId: string) =>
    request(server()).post(`/api/review-sessions/me/subjects/${subjectId}/skills/${skillId}/lessons/${lessonId}/start`).set('Authorization', `Bearer ${token}`);
  const getReview = (token: string, sessionId: string) => request(server()).get(`/api/review-sessions/${sessionId}`).set('Authorization', `Bearer ${token}`);
  const submitReview = (token: string, sessionId: string, activityId: string, correct: boolean, rid = randomUUID()) =>
    request(server()).post(`/api/review-sessions/${sessionId}/activities/${activityId}/attempts`).set('Authorization', `Bearer ${token}`).send({ clientRequestId: rid, answer: { selectedOptionId: correct ? 'a' : 'b' } });
  const completeReview = (token: string, sessionId: string) => request(server()).post(`/api/review-sessions/${sessionId}/complete`).set('Authorization', `Bearer ${token}`);
  const submitNormal = (token: string, lessonId: string, activityId: string, correct: boolean) =>
    request(server()).post(`/api/lesson-executions/${lessonId}/activities/${activityId}/attempts`).set('Authorization', `Bearer ${token}`).send({ clientRequestId: randomUUID(), answer: { selectedOptionId: correct ? 'a' : 'b' } });
  const completeNormal = (token: string, lessonId: string) => request(server()).post(`/api/lesson-executions/${lessonId}/complete`).set('Authorization', `Bearer ${token}`);

  /** Learner + subject + skill + topic; a candidate lesson requires signal + encountered + mapping (per test). */
  async function base(phone: string) {
    const { token, userId } = await makeLearner(phone);
    const { subjectId, trackId } = await makeSubjectTrack(userId);
    const skA = await makeSkill(subjectId, 'Grammar');
    const skB = await makeSkill(subjectId, 'Vocab');
    const topic = await makeTopic(userId, trackId);
    return { token, userId, subjectId, trackId, skA, skB, topic };
  }

  // ───────────────────────────────────────────────────────────────────────────

  it('§65/§67 pins the ENCOUNTERED (completion) revision, not the current published one', async () => {
    const s = await base('+998900004001');
    const L = await makeLesson(s.userId, s.topic, [s.skA]);
    await makeActivity(L.revisionId, 1, ActivityType.PRACTICE); // v1 objective (LessonSkill fallback)
    await seenCompleted(s.userId, L.lessonId, L.revisionId); // encountered v1
    const v2 = await publishV2(s.userId, L.lessonId); // current is now v2
    await signal(s.userId, s.subjectId, s.skA);

    const res = await startReview(s.token, s.subjectId, s.skA, L.lessonId);
    expect(res.status).toBe(200);
    expect(res.body.lessonRevisionId).toBe(L.revisionId); // pinned v1, NOT v2
    expect(res.body.lessonRevisionId).not.toBe(v2);
    expect(res.body.status).toBe('ACTIVE');
  });

  it('§66 pins the progress revision when there is no completion', async () => {
    const s = await base('+998900004002');
    const L = await makeLesson(s.userId, s.topic, [s.skA]);
    await makeActivity(L.revisionId, 1);
    await seenProgress(s.userId, L.lessonId, L.revisionId); // encountered v3 (this v1 here)
    await publishV2(s.userId, L.lessonId);
    await signal(s.userId, s.subjectId, s.skA);
    expect((await startReview(s.token, s.subjectId, s.skA, L.lessonId)).body.lessonRevisionId).toBe(L.revisionId);
  });

  it('§68/§24 skill-specific selection: ActivitySkill(target) + zero-ActivitySkill fallback; other-skill excluded', async () => {
    const s = await base('+998900004003');
    const L = await makeLesson(s.userId, s.topic, [s.skA]); // LessonSkill Grammar
    const A = await makeActivity(L.revisionId, 1, ActivityType.PRACTICE, [s.skA]); // ActivitySkill Grammar
    const B = await makeActivity(L.revisionId, 2, ActivityType.PRACTICE, [s.skB]); // ActivitySkill Vocab
    const C = await makeActivity(L.revisionId, 3, ActivityType.PRACTICE); // no ActivitySkill → Grammar fallback
    await seenCompleted(s.userId, L.lessonId, L.revisionId);
    await signal(s.userId, s.subjectId, s.skA);

    const res = await startReview(s.token, s.subjectId, s.skA, L.lessonId);
    expect(res.body.activities.map((a: { id: string }) => a.id)).toEqual([A, C]); // B (Vocab) excluded
    expect(res.body.activities.map((a: { position: number }) => a.position)).toEqual([1, 2]); // snapshot 1-based
    expect(JSON.stringify(res.body)).not.toMatch(/answerKey|correctOptionIds/); // §89 no key leak
    void B;
  });

  it('§70/§26 direct-trigger selected activity is ordered first', async () => {
    const s = await base('+998900004004');
    const L = await makeLesson(s.userId, s.topic, [s.skA]);
    const A = await makeActivity(L.revisionId, 1, ActivityType.PRACTICE, [s.skA]);
    const B = await makeActivity(L.revisionId, 2, ActivityType.PRACTICE, [s.skA]);
    await seenCompleted(s.userId, L.lessonId, L.revisionId);
    await signal(s.userId, s.subjectId, s.skA); // WEAK_SKILL for candidate
    await prisma.learnerSignal.create({ data: { userId: s.userId, subjectId: s.subjectId, skillId: s.skA, type: 'REPEATED_MISTAKE', status: 'ACTIVE', evidenceRefs: { schemaVersion: 'repeated-mistake-signal/v1', triggerActivityIds: [B], triggerAttemptIds: ['x'] } } });

    const ids = (await startReview(s.token, s.subjectId, s.skA, L.lessonId)).body.activities.map((a: { id: string }) => a.id);
    expect(ids).toEqual([B, A]); // B direct-trigger first, then A by position
  });

  it('§72 no reviewable objective activity for the skill → REVIEW_SESSION_NO_REVIEWABLE_ACTIVITY', async () => {
    const s = await base('+998900004005');
    const L = await makeLesson(s.userId, s.topic, [s.skA]);
    await makeActivity(L.revisionId, 1, ActivityType.TEXT); // view-only, not objective
    await makeActivity(L.revisionId, 2, ActivityType.PRACTICE, [s.skB]); // objective but Vocab-only
    await seenCompleted(s.userId, L.lessonId, L.revisionId);
    await signal(s.userId, s.subjectId, s.skA);
    const res = await startReview(s.token, s.subjectId, s.skA, L.lessonId);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('REVIEW_SESSION_NO_REVIEWABLE_ACTIVITY');
    expect(await prisma.learnerReviewSession.count({ where: { userId: s.userId } })).toBe(0);
  });

  it('§63/§64 candidate revalidation on NEW start; ACTIVE session survives later signal resolution (resume)', async () => {
    const s = await base('+998900004006');
    const L = await makeLesson(s.userId, s.topic, [s.skA]);
    await makeActivity(L.revisionId, 1, ActivityType.PRACTICE, [s.skA]);
    await seenCompleted(s.userId, L.lessonId, L.revisionId);
    const sig = await signal(s.userId, s.subjectId, s.skA);
    const started = await startReview(s.token, s.subjectId, s.skA, L.lessonId);
    const sessionId = started.body.id;

    // resolve signal AFTER start → resume still returns the same session (§64)
    await prisma.learnerSignal.update({ where: { id: sig.id }, data: { status: 'RESOLVED', resolvedAt: new Date() } });
    expect((await startReview(s.token, s.subjectId, s.skA, L.lessonId)).body.id).toBe(sessionId); // §64 resume
    expect((await getReview(s.token, sessionId)).status).toBe(200);

    // §63 a brand-NEW intent with no active signal is rejected (use a fresh lesson to force NEW)
    const L2 = await makeLesson(s.userId, s.topic, [s.skA]);
    await makeActivity(L2.revisionId, 1, ActivityType.PRACTICE, [s.skA]);
    await seenCompleted(s.userId, L2.lessonId, L2.revisionId); // no active signal now (sig resolved)
    const rej = await startReview(s.token, s.subjectId, s.skA, L2.lessonId);
    expect(rej.status).toBe(409);
    expect(rej.body.code).toBe('REVIEW_CANDIDATE_NOT_AVAILABLE');
  });

  it('§73/§83 snapshot immutability + start idempotency', async () => {
    const s = await base('+998900004007');
    const L = await makeLesson(s.userId, s.topic, [s.skA]);
    const A = await makeActivity(L.revisionId, 1, ActivityType.PRACTICE, [s.skA]);
    await seenCompleted(s.userId, L.lessonId, L.revisionId);
    await signal(s.userId, s.subjectId, s.skA);
    const first = await startReview(s.token, s.subjectId, s.skA, L.lessonId);

    // change mappings AFTER start; add a new activity
    const B = await makeActivity(L.revisionId, 2, ActivityType.PRACTICE, [s.skA]);
    const again = await startReview(s.token, s.subjectId, s.skA, L.lessonId); // idempotent
    expect(again.body.id).toBe(first.body.id);
    expect(again.body.activities.map((a: { id: string }) => a.id)).toEqual([A]); // snapshot unchanged (B not added)
    expect((await getReview(s.token, first.body.id)).body.activities.map((a: { id: string }) => a.id)).toEqual([A]);
    void B;
  });

  it('§74/§75/§76/§77 submit correct/incorrect + review provenance; arbitrary + cross-revision rejected; normal progress untouched', async () => {
    const s = await base('+998900004008');
    const L = await makeLesson(s.userId, s.topic, [s.skA]);
    const A = await makeActivity(L.revisionId, 1, ActivityType.PRACTICE, [s.skA]);
    const other = await makeActivity(L.revisionId, 2, ActivityType.PRACTICE, [s.skB]); // not selected for Grammar
    await seenProgress(s.userId, L.lessonId, L.revisionId);
    await signal(s.userId, s.subjectId, s.skA);
    const sessionId = (await startReview(s.token, s.subjectId, s.skA, L.lessonId)).body.id;

    const ok = await submitReview(s.token, sessionId, A, true);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ activityId: A, isCorrect: true, deterministicScore: 10000, reviewSessionId: sessionId });
    const att = await prisma.activityAttempt.findFirst({ where: { userId: s.userId, activityId: A } });
    expect(att!.reviewSessionId).toBe(sessionId);
    expect(att!.learningSessionId).toBeNull();

    // normal LessonProgress unchanged by review submit
    const prog = await prisma.learnerLessonProgress.findUnique({ where: { userId_lessonId: { userId: s.userId, lessonId: L.lessonId } } });
    expect(prog!.completedActivities).toBeNull();
    expect(prog!.lastActivityId).toBeNull();

    // §76 arbitrary (not-in-snapshot) activity rejected
    expect((await submitReview(s.token, sessionId, other, true)).body.code).toBe('REVIEW_SESSION_ACTIVITY_NOT_AVAILABLE');
    // §77 activity from another revision rejected (not in snapshot)
    const v2 = await publishV2(s.userId, L.lessonId);
    const v2act = await makeActivity(v2, 1, ActivityType.PRACTICE, [s.skA]);
    expect((await submitReview(s.token, sessionId, v2act, true)).body.code).toBe('REVIEW_SESSION_ACTIVITY_NOT_AVAILABLE');
  });

  it('§78 CRITICAL: review attempt does NOT satisfy normal LessonCompletion', async () => {
    const s = await base('+998900004009');
    const L = await makeLesson(s.userId, s.topic, [s.skA]);
    const A = await makeActivity(L.revisionId, 1, ActivityType.PRACTICE, [s.skA]);
    await seenProgress(s.userId, L.lessonId, L.revisionId); // normal IN_PROGRESS
    await signal(s.userId, s.subjectId, s.skA);
    const sessionId = (await startReview(s.token, s.subjectId, s.skA, L.lessonId)).body.id;
    await submitReview(s.token, sessionId, A, true); // review-attempt A (not normal)

    const done = await completeNormal(s.token, L.lessonId);
    expect(done.status).toBe(409);
    expect(done.body.code).toBe('LESSON_NOT_READY_FOR_COMPLETION'); // A still missing for NORMAL completion
    expect(await prisma.learnerLessonCompletion.count({ where: { userId: s.userId } })).toBe(0);
  });

  it('§79 CRITICAL: lesson-mastery-v1 uses normal evidence only (review score excluded)', async () => {
    const s = await base('+998900004010');
    const L = await makeLesson(s.userId, s.topic, [s.skA]);
    const M = await makeActivity(L.revisionId, 1, ActivityType.MASTERY_TEST, [s.skA]);
    await seenProgress(s.userId, L.lessonId, L.revisionId);
    await signal(s.userId, s.subjectId, s.skA);

    await submitNormal(s.token, L.lessonId, M, false); // normal mastery attempt WRONG → 0
    const sessionId = (await startReview(s.token, s.subjectId, s.skA, L.lessonId)).body.id;
    await submitReview(s.token, sessionId, M, true); // review mastery attempt CORRECT → 10000 (must be ignored)

    const done = await completeNormal(s.token, L.lessonId);
    expect(done.status).toBe(200);
    const m = await prisma.skillMeasurement.findFirst({ where: { userId: s.userId, source: 'LESSON_MASTERY', skillId: s.skA } });
    expect(m!.scoreBp).toBe(0); // normal 0, NOT review 10000
    const completion = await prisma.learnerLessonCompletion.findFirst({ where: { userId: s.userId, lessonId: L.lessonId } });
    expect(completion!.masteryBestScore).toBe(0); // cache also normal-only
  });

  it('§80 normal attempt does NOT satisfy review completion (needs review-linked attempt)', async () => {
    const s = await base('+998900004011');
    const L = await makeLesson(s.userId, s.topic, [s.skA]);
    const A = await makeActivity(L.revisionId, 1, ActivityType.PRACTICE, [s.skA]);
    await seenProgress(s.userId, L.lessonId, L.revisionId);
    await signal(s.userId, s.subjectId, s.skA);
    await submitNormal(s.token, L.lessonId, A, true); // normal attempt (reviewSessionId null)
    const sessionId = (await startReview(s.token, s.subjectId, s.skA, L.lessonId)).body.id;

    const res = await completeReview(s.token, sessionId);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('REVIEW_SESSION_NOT_READY');
  });

  it('§81/§82/§50 review completes when all selected attempted; correctness irrelevant; no LessonCompletion/SkillMeasurement', async () => {
    const s = await base('+998900004012');
    const L = await makeLesson(s.userId, s.topic, [s.skA]);
    const A = await makeActivity(L.revisionId, 1, ActivityType.PRACTICE, [s.skA]);
    const B = await makeActivity(L.revisionId, 2, ActivityType.PRACTICE, [s.skA]);
    await seenProgress(s.userId, L.lessonId, L.revisionId); // encountered via progress (no completion row)
    await signal(s.userId, s.subjectId, s.skA);
    const sessionId = (await startReview(s.token, s.subjectId, s.skA, L.lessonId)).body.id;

    expect((await completeReview(s.token, sessionId)).body.code).toBe('REVIEW_SESSION_NOT_READY'); // nothing attempted
    await submitReview(s.token, sessionId, A, false); // wrong
    await submitReview(s.token, sessionId, B, false); // wrong
    const done = await completeReview(s.token, sessionId);
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('COMPLETED');
    expect(done.body.completedAt).not.toBeNull();
    // idempotent
    expect((await completeReview(s.token, sessionId)).body.status).toBe('COMPLETED');
    // 1.9C: review completion normalizes into REVIEW_MASTERY (+ merged state), NOT LessonCompletion / lesson-mastery.
    expect(await prisma.learnerLessonCompletion.count({ where: { userId: s.userId } })).toBe(0);
    expect(await prisma.skillMeasurement.count({ where: { userId: s.userId, source: 'LESSON_MASTERY' } })).toBe(0); // review isolation intact
    expect(await prisma.skillMeasurement.count({ where: { userId: s.userId, source: 'REVIEW_MASTERY' } })).toBe(1); // one review milestone (idempotent)
  });

  it('§85 completed session → a new episode starts while candidate still valid', async () => {
    const s = await base('+998900004013');
    const L = await makeLesson(s.userId, s.topic, [s.skA]);
    const A = await makeActivity(L.revisionId, 1, ActivityType.PRACTICE, [s.skA]);
    await seenCompleted(s.userId, L.lessonId, L.revisionId);
    await signal(s.userId, s.subjectId, s.skA);
    const s1 = (await startReview(s.token, s.subjectId, s.skA, L.lessonId)).body.id;
    await submitReview(s.token, s1, A, false); // wrong → merged mastery stays low → WEAK_SKILL candidate remains valid
    await completeReview(s.token, s1);

    const s2 = (await startReview(s.token, s.subjectId, s.skA, L.lessonId)).body.id; // new episode
    expect(s2).not.toBe(s1);
    expect((await prisma.learnerReviewSession.findUnique({ where: { id: s1 } }))!.status).toBe('COMPLETED');
    expect(await prisma.learnerReviewSession.count({ where: { userId: s.userId, lessonId: L.lessonId } })).toBe(2);
  });

  it('§84/§86/§87 concurrent start/attempt/complete converge (one session, one attempt, one transition)', async () => {
    const s = await base('+998900004014');
    const L = await makeLesson(s.userId, s.topic, [s.skA]);
    const A = await makeActivity(L.revisionId, 1, ActivityType.PRACTICE, [s.skA]);
    await seenCompleted(s.userId, L.lessonId, L.revisionId);
    await signal(s.userId, s.subjectId, s.skA);

    const [a, b] = await Promise.all([startReview(s.token, s.subjectId, s.skA, L.lessonId), startReview(s.token, s.subjectId, s.skA, L.lessonId)]);
    expect(a.body.id).toBe(b.body.id); // §84 one session
    expect(await prisma.learnerReviewSession.count({ where: { userId: s.userId, status: 'ACTIVE' } })).toBe(1);
    const sessionId = a.body.id;

    const rid = randomUUID();
    await Promise.all([submitReview(s.token, sessionId, A, true, rid), submitReview(s.token, sessionId, A, true, rid)]); // §86 same reqId
    expect(await prisma.activityAttempt.count({ where: { userId: s.userId, activityId: A } })).toBe(1);

    const [c, d] = await Promise.all([completeReview(s.token, sessionId), completeReview(s.token, sessionId)]); // §87
    expect([c.status, d.status]).toEqual([200, 200]);
    expect(await prisma.learnerReviewSession.count({ where: { id: sessionId, status: 'COMPLETED' } })).toBe(1);
  });

  it('§88/§90 IDOR + full side-effect boundary + 401/404', async () => {
    const s = await base('+998900004015');
    const L = await makeLesson(s.userId, s.topic, [s.skA]);
    const A = await makeActivity(L.revisionId, 1, ActivityType.PRACTICE, [s.skA]);
    await seenCompleted(s.userId, L.lessonId, L.revisionId);
    await signal(s.userId, s.subjectId, s.skA);
    const before = { roadmaps: await prisma.learnerRoadmap.count(), plans: await prisma.dailyPlan.count(), rewards: await prisma.rewardGrant.count(), notes: await prisma.notification.count(), completions: await prisma.learnerLessonCompletion.count() };
    const sessionId = (await startReview(s.token, s.subjectId, s.skA, L.lessonId)).body.id;
    await submitReview(s.token, sessionId, A, true);
    await completeReview(s.token, sessionId);

    // 1.9C boundary (§82): review MAY write REVIEW_MASTERY + LearnerSkillState (via LearningProgress) + signals
    // (recovery, via LearnerSignals). It must NOT touch these, and never lesson mastery:
    expect(await prisma.learnerRoadmap.count()).toBe(before.roadmaps);
    expect(await prisma.dailyPlan.count()).toBe(before.plans);
    expect(await prisma.rewardGrant.count()).toBe(before.rewards);
    expect(await prisma.notification.count()).toBe(before.notes);
    expect(await prisma.learnerLessonCompletion.count()).toBe(before.completions);
    expect(await prisma.aiEvaluation.count()).toBe(0);
    expect(await prisma.skillMeasurement.count({ where: { source: 'LESSON_MASTERY' } })).toBe(0); // review isolation

    // §88 IDOR
    const attacker = await makeLearner('+998900004016');
    expect((await getReview(attacker.token, sessionId)).status).toBe(404);
    expect((await submitReview(attacker.token, sessionId, A, true)).status).toBe(404);
    expect((await completeReview(attacker.token, sessionId)).status).toBe(404);
    expect((await request(server()).get(`/api/review-sessions/${sessionId}`)).status).toBe(401);
  });
});
