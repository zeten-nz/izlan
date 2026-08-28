import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { ActivityType, ContainerStatus, ContentSource, LessonStatus, PointAcquisitionType, RevisionStatus, SkillMeasurementSource, SignalStatus } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createFastifyAdapter } from '../src/bootstrap/http-adapter';
import { PrismaService } from '../src/database/prisma.service';
import { AuthorizationRepository } from '../src/authorization/authorization.repository';
import { AuthExceptionFilter } from '../src/auth/http/auth-exception.filter';
import { SMS_PORT } from '../src/sms/sms.port';
import { Clock } from '../src/common/clock';
import { bootstrapSystemRoles } from '../src/bootstrap/system-roles';
import { cleanupAuthTables } from './test-db.helper';
import { TestSmsAdapter } from './test-sms.adapter';
import { provisionV2PresentSimple, V2_PRESENT_SIMPLE_SKILL_CODES, V2_PRESENT_SIMPLE_LESSON_KEYS } from '../src/bootstrap/provision-v2-present-simple';

/**
 * Review & Adaptation V2 (e2e, izlan_test). Proves the closed adaptive loop on the Present Simple pilot:
 * teaching/review evidence → mistake interpretation (signal) → roadmap Attention → review/repair experience →
 * new evidence → recomputed competence → resolved/retained signal — while historical LEARNED acquisition and
 * append-only evidence stay immutable, and the next-useful-action adapts without rewriting history.
 */
describe('Review & Adaptation V2 — closed loop (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let authz: AuthorizationRepository;
  const sms = new TestSmsAdapter();
  const clock = { current: new Date(), now(): Date { return this.current; } };
  let seq = 0;
  const phone = () => `+99890${String(6300000 + seq++).slice(-7)}`;

  const OBJ_V = 'lesson-activity-objective/v1';
  const MD_V = 'lesson-activity-markdown/v1';
  const md = (markdown: string) => ({ schemaVersion: MD_V, markdown });
  const sc = (prompt: string, correctId: string) => ({
    schemaVersion: OBJ_V,
    format: 'single_choice',
    prompt,
    options: [{ id: 'a', text: 'Correct form' }, { id: 'b', text: 'Wrong form' }, { id: 'c', text: 'Also wrong' }],
    answerKey: { correctOptionIds: [correctId] },
  });

  let subjectId = '';
  let pointId = '';

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_PORT).useValue(sms)
      .overrideProvider(Clock).useValue(clock)
      .compile();
    app = mod.createNestApplication<NestFastifyApplication>(createFastifyAdapter());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AuthExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = mod.get(PrismaService);
    authz = mod.get(AuthorizationRepository);
    await reset();
    subjectId = await seedPresentSimpleContent();
    await provisionV2PresentSimple(prisma, { nodeEnv: 'test', allowDevFixture: 'true' });
    pointId = (await prisma.roadmapPoint.findUniqueOrThrow({ where: { pointKey: 'ENG-A1-PRESENT-SIMPLE' } })).id;
  }, 120_000);

  afterAll(async () => {
    await reset();
    await app.close();
  });

  beforeEach(() => {
    clock.current = new Date(); // real-now by default → nothing is retention-due unless a test advances time
  });

  const srv = () => app.getHttpServer();
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function reset() {
    await prisma.pointAcquisitionEvent.deleteMany();
    await prisma.masteryEvaluationEvidence.deleteMany();
    await prisma.skillMeasurementEvidenceRef.deleteMany();
    await prisma.masteryEvaluation.deleteMany();
    await prisma.skillMeasurement.deleteMany();
    await prisma.roadmapPointProjection.deleteMany();
    await prisma.learnerRoadmapGeneration.deleteMany();
    await prisma.teachingSessionContentPin.deleteMany();
    // Review-session submits feed daily missions (which may grant XP); the completion-evidence RESTRICTs
    // activity_attempt, and xp/reward grants reference the completion — clear that chain before the attempts.
    await prisma.xpGrant.deleteMany();
    await prisma.rewardGrant.deleteMany();
    await prisma.dailyMissionCompletionEvidence.deleteMany();
    await prisma.dailyMissionCompletion.deleteMany();
    await prisma.activityAttempt.deleteMany();
    await prisma.teachingSession.deleteMany();
    await prisma.learnerReviewSessionActivity.deleteMany();
    await prisma.learnerReviewSession.deleteMany();
    await prisma.learnerSkillState.deleteMany();
    await prisma.learnerSignal.deleteMany();
    await prisma.learnerLearningIntent.deleteMany();
    await prisma.teachingBlueprintContentBinding.deleteMany();
    await prisma.teachingBlueprintStage.deleteMany();
    await prisma.masteryRequirementSkillExpectation.deleteMany();
    await prisma.masteryRequirement.updateMany({ data: { currentRevisionId: null } });
    await prisma.masteryRequirementRevision.deleteMany();
    await prisma.masteryRequirement.deleteMany();
    await prisma.teachingBlueprint.updateMany({ data: { publishedRevisionId: null } });
    await prisma.teachingBlueprintRevision.deleteMany();
    await prisma.teachingBlueprint.deleteMany();
    await prisma.roadmapPointSkillExpectation.deleteMany();
    await prisma.roadmapPointPrerequisite.deleteMany();
    await prisma.roadmapPoint.updateMany({ data: { publishedRevisionId: null } });
    await prisma.roadmapPointRevision.deleteMany();
    await prisma.roadmapPoint.deleteMany();
    await prisma.skillLevelExpectation.updateMany({ data: { currentRevisionId: null } });
    await prisma.skillLevelExpectationRevision.deleteMany();
    await prisma.skillLevelExpectation.deleteMany();
    await prisma.skill.updateMany({ data: { primaryDomainId: null } });
    await prisma.subjectDomain.deleteMany();
    await prisma.activitySkill.deleteMany();
    await prisma.activity.deleteMany();
    await prisma.lessonSkill.deleteMany();
    await prisma.lessonPrerequisite.deleteMany();
    await prisma.lesson.updateMany({ data: { publishedRevisionId: null } });
    await prisma.lessonRevision.deleteMany();
    await prisma.lesson.deleteMany();
    await prisma.topic.deleteMany();
    await prisma.module.deleteMany();
    await prisma.level.deleteMany();
    await prisma.track.deleteMany();
    await prisma.skill.deleteMany();
    await prisma.subjectAssignment.deleteMany();
    await prisma.subject.deleteMany();
    await cleanupAuthTables(prisma);
    await bootstrapSystemRoles(authz);
  }

  async function seedPresentSimpleContent(): Promise<string> {
    const author = await prisma.user.create({ data: { phone: phone() } });
    const subject = await prisma.subject.create({ data: { slug: 'english-a1-dev', title: 'English — Beginner (A1)', status: ContainerStatus.PUBLISHED, createdBy: author.id } });
    const track = await prisma.track.create({ data: { subjectId: subject.id, slug: 'general-a1-dev', title: 'General English A1', status: ContainerStatus.PUBLISHED, sortOrder: 1, createdBy: author.id } });
    const level = await prisma.level.create({ data: { trackId: track.id, code: 'A1', title: 'A1', status: ContainerStatus.PUBLISHED, sortOrder: 1, createdBy: author.id } });
    const moduleRow = await prisma.module.create({ data: { levelId: level.id, title: 'A1 Foundations', status: ContainerStatus.PUBLISHED, sortOrder: 1, createdBy: author.id } });
    const topic = await prisma.topic.create({ data: { moduleId: moduleRow.id, title: 'Kundalik hayot', status: ContainerStatus.PUBLISHED, sortOrder: 4, createdBy: author.id } });

    for (let i = 0; i < 3; i++) {
      const code = V2_PRESENT_SIMPLE_SKILL_CODES[i];
      const contentKey = V2_PRESENT_SIMPLE_LESSON_KEYS[i];
      const skill = await prisma.skill.create({ data: { subjectId: subject.id, code, name: presentSimpleSkillName(i), sortOrder: 11 + i } });
      const lesson = await prisma.lesson.create({ data: { topicId: topic.id, contentKey, slug: contentKey.toLowerCase(), sortOrder: 10 + i, status: LessonStatus.PUBLISHED, createdBy: author.id } });
      const rev = await prisma.lessonRevision.create({ data: { lessonId: lesson.id, version: 1, title: contentKey, status: RevisionStatus.PUBLISHED, createdBy: author.id, publishedBy: author.id, publishedAt: new Date() } });
      await prisma.lesson.update({ where: { id: lesson.id }, data: { publishedRevisionId: rev.id } });
      await prisma.lessonSkill.create({ data: { lessonId: lesson.id, skillId: skill.id } });
      const acts: { type: ActivityType; position: number; payload: object }[] = [
        { type: ActivityType.EXPLANATION, position: 0, payload: md('## Present Simple\n\nWe use it for habits and facts.') },
        { type: ActivityType.MINI_QUESTION, position: 1, payload: sc('Recognition: which is present simple?', 'a') },
        { type: ActivityType.PRACTICE, position: 2, payload: sc('Guided: complete the sentence', 'a') },
        { type: ActivityType.MASTERY_TEST, position: 3, payload: sc('Mastery: choose the correct form', 'a') },
      ];
      for (const a of acts) {
        const activity = await prisma.activity.create({ data: { lessonRevisionId: rev.id, type: a.type, position: a.position, source: ContentSource.HUMAN, payload: a.payload } });
        if (a.type !== ActivityType.EXPLANATION) await prisma.activitySkill.create({ data: { activityId: activity.id, skillId: skill.id } });
      }
    }
    return subject.id;
  }

  const presentSimpleSkillName = (i: number) => ['Present Simple — affirmative', 'Present Simple — negative', 'Present Simple — questions'][i];

  async function makeLearner(): Promise<{ token: string; userId: string }> {
    const ph = phone();
    const r = await request(srv()).post('/api/auth/otp/request').send({ phone: ph });
    const reg = await request(srv()).post('/api/auth/register').send({ challengeId: r.body.challengeId, code: sms.latestCode(), password: 'Passw0rd!123' });
    const user = await prisma.user.findUnique({ where: { phone: ph } });
    await prisma.userProfile.update({ where: { userId: user!.id }, data: { onboardingCompletedAt: new Date(), timezone: 'Asia/Tashkent' } });
    return { token: reg.body.accessToken as string, userId: user!.id };
  }

  /** Teach the Present Simple point to LEARNED by answering its mastery activities correctly. Returns sessionId. */
  async function teachToLearned(token: string): Promise<string> {
    const start = await request(srv()).post(`/api/v2/roadmap-points/${pointId}/teaching-session/start`).set(auth(token));
    const sessionId = start.body.id as string;
    const stages = start.body.stages as { stageType: string; activities: { id: string; kind: string }[] }[];
    const mastery = stages.find((s) => s.stageType === 'mastery')!.activities.filter((a) => a.kind === 'OBJECTIVE');
    for (const a of mastery) {
      await request(srv()).post(`/api/v2/teaching-sessions/${sessionId}/activities/${a.id}/attempts`).set(auth(token)).send({ clientRequestId: randomUUID(), answer: { selectedOptionId: 'a' } });
    }
    const check = await request(srv()).post(`/api/v2/teaching-sessions/${sessionId}/mastery-check`).set(auth(token));
    expect(check.body.learned).toBe(true);
    return sessionId;
  }

  /** The 3 objective activities attributed to the affirmative skill (lesson 010): mini-question, practice, mastery. */
  async function affirmativeSkillActivityIds(): Promise<{ skillId: string; activityIds: string[] }> {
    const skill = await prisma.skill.findFirstOrThrow({ where: { subjectId, code: V2_PRESENT_SIMPLE_SKILL_CODES[0] } });
    const rows = await prisma.activitySkill.findMany({ where: { skillId: skill.id }, select: { activityId: true } });
    return { skillId: skill.id, activityIds: rows.map((r) => r.activityId) };
  }

  async function submitTeaching(token: string, sessionId: string, activityId: string, optionId: string) {
    return request(srv()).post(`/api/v2/teaching-sessions/${sessionId}/activities/${activityId}/attempts`).set(auth(token)).send({ clientRequestId: randomUUID(), answer: { selectedOptionId: optionId } });
  }

  const pointOf = (roadmapBody: { points: Array<{ pointKey: string }> }) => roadmapBody.points.find((p) => p.pointKey === 'ENG-A1-PRESENT-SIMPLE') as Record<string, unknown>;

  // ─────────────────────────────────────────────────────────────

  it('RA-01: one wrong answer never creates a repeated-mistake signal (one wrong ≠ weakness)', async () => {
    const { token, userId } = await makeLearner();
    await teachToLearned(token);
    const { activityIds } = await affirmativeSkillActivityIds();

    // A fresh repair/re-practice session, then a SINGLE wrong answer.
    const start = await request(srv()).post(`/api/v2/roadmap-points/${pointId}/teaching-session/start`).set(auth(token));
    await submitTeaching(token, start.body.id, activityIds[0], 'b'); // one wrong

    expect(await prisma.learnerSignal.count({ where: { userId, type: 'REPEATED_MISTAKE', status: SignalStatus.ACTIVE } })).toBe(0);
    const roadmap = await request(srv()).get(`/api/v2/roadmap/subjects/${subjectId}`).set(auth(token));
    expect(pointOf(roadmap.body).attention).toBe('NONE'); // learned, no attention yet
    expect(pointOf(roadmap.body).learned).toBe(true);
  });

  it('RA-02: repeated failures → REPEATED_MISTAKE → point REPAIR_REQUIRED; LEARNED survives; dedup single active signal', async () => {
    const { token, userId } = await makeLearner();
    await teachToLearned(token);
    const learnedEventBefore = await prisma.pointAcquisitionEvent.findFirstOrThrow({ where: { userId, roadmapPointId: pointId, acquisitionType: PointAcquisitionType.LEARNED } });
    const { skillId, activityIds } = await affirmativeSkillActivityIds();

    const start = await request(srv()).post(`/api/v2/roadmap-points/${pointId}/teaching-session/start`).set(auth(token));
    const sessionId = start.body.id as string;
    // Three DISTINCT wrong answers on the affirmative skill's activities → misconception pattern.
    for (const aid of activityIds) await submitTeaching(token, sessionId, aid, 'b');

    // Exactly one ACTIVE REPEATED_MISTAKE signal for the skill (dedup via uq_learner_signal_active).
    const signals = await prisma.learnerSignal.findMany({ where: { userId, skillId, type: 'REPEATED_MISTAKE', status: SignalStatus.ACTIVE } });
    expect(signals.length).toBe(1);

    // Roadmap point now shows REPAIR_REQUIRED (repair ≠ review), with a learner-facing reason + skill.
    const roadmap = await request(srv()).get(`/api/v2/roadmap/subjects/${subjectId}`).set(auth(token));
    const point = pointOf(roadmap.body);
    expect(point.attention).toBe('REPAIR_REQUIRED');
    expect(point.attentionReason).toBe('REPEATED_MISTAKE');
    expect((point.attentionSkill as { name: string }).name).toBe('Present Simple — affirmative');
    expect(point.learned).toBe(true); // acquisition unchanged

    // Historical LEARNED acquisition is intact (not deleted / rewritten).
    const learnedAfter = await prisma.pointAcquisitionEvent.findMany({ where: { userId, roadmapPointId: pointId, acquisitionType: PointAcquisitionType.LEARNED } });
    expect(learnedAfter.length).toBe(1);
    expect(learnedAfter[0].id).toBe(learnedEventBefore.id);

    // Duplicate processing (re-submit a wrong answer) does not create a second active signal.
    await submitTeaching(token, sessionId, activityIds[0], 'b');
    expect(await prisma.learnerSignal.count({ where: { userId, skillId, type: 'REPEATED_MISTAKE', status: SignalStatus.ACTIVE } })).toBe(1);

    // Focus/next-action recommends REPAIR (not the next numeric point).
    const focus = await request(srv()).get(`/api/v2/roadmap/subjects/${subjectId}/focus`).set(auth(token));
    expect(focus.body.action).toBe('REPAIR');
    expect(focus.body.point.pointKey).toBe('ENG-A1-PRESENT-SIMPLE');
    expect(focus.body.reason).toBe('REPEATED_MISTAKE');
  });

  it('RA-03: REVIEW_DUE (retention) is distinct from REPAIR; focus recommends REVIEW', async () => {
    const { token } = await makeLearner();
    await teachToLearned(token);

    // Before time passes: no attention.
    let roadmap = await request(srv()).get(`/api/v2/roadmap/subjects/${subjectId}`).set(auth(token));
    expect(pointOf(roadmap.body).attention).toBe('NONE');

    // Advance the clock well past the retention interval → REVIEW_DUE (no misconception → not REPAIR).
    clock.current = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    roadmap = await request(srv()).get(`/api/v2/roadmap/subjects/${subjectId}`).set(auth(token));
    const point = pointOf(roadmap.body);
    expect(point.attention).toBe('REVIEW_DUE');
    expect(point.attentionReason).toBe('RETENTION_DUE');
    expect(point.learned).toBe(true);

    const focus = await request(srv()).get(`/api/v2/roadmap/subjects/${subjectId}/focus`).set(auth(token));
    expect(focus.body.action).toBe('REVIEW');
  });

  it('RA-04: point review pins the exact revision, yields REVIEW_MASTERY evidence via the single writer, and clears REVIEW_DUE', async () => {
    const { token, userId } = await makeLearner();
    await teachToLearned(token);
    const { skillId } = await affirmativeSkillActivityIds();
    const stateBefore = await prisma.learnerSkillState.findFirstOrThrow({ where: { userId, skillId } });

    clock.current = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // retention due
    expect(pointOf((await request(srv()).get(`/api/v2/roadmap/subjects/${subjectId}`).set(auth(token))).body).attention).toBe('REVIEW_DUE');

    // Start a point-scoped review (reuses the review-session aggregate).
    const startReview = await request(srv()).post(`/api/v2/roadmap-points/${pointId}/review/skills/${skillId}/start`).set(auth(token));
    expect(startReview.status).toBe(200);
    const sessionId = startReview.body.id as string;
    expect(JSON.stringify(startReview.body)).not.toContain('answerKey');

    // It pinned the EXACT encountered lesson revision (the affirmative lesson's published revision).
    const affirmativeLesson = await prisma.lesson.findFirstOrThrow({ where: { contentKey: V2_PRESENT_SIMPLE_LESSON_KEYS[0] } });
    expect(startReview.body.lessonRevisionId).toBe(affirmativeLesson.publishedRevisionId);

    // Answer every selected review activity (correctly) via the existing review-session runner, then complete.
    const sess = await request(srv()).get(`/api/review-sessions/${sessionId}`).set(auth(token));
    for (const a of sess.body.activities as { id: string }[]) {
      await request(srv()).post(`/api/review-sessions/${sessionId}/activities/${a.id}/attempts`).set(auth(token)).send({ clientRequestId: randomUUID(), answer: { selectedOptionId: 'a' } });
    }
    const complete = await request(srv()).post(`/api/review-sessions/${sessionId}/complete`).set(auth(token));
    expect(complete.status).toBe(200);
    clock.current = new Date(); // the review happened "now" → clock returns to the present for the freshness read

    // A traceable REVIEW_MASTERY measurement exists, pinned to the review session (append-only evidence).
    const reviewMeasure = await prisma.skillMeasurement.findMany({ where: { userId, skillId, source: SkillMeasurementSource.REVIEW_MASTERY, reviewSessionId: sessionId } });
    expect(reviewMeasure.length).toBe(1);

    // LearnerSkillState changed only through the single writer (lastMeasurementAt advanced past the review).
    const stateAfter = await prisma.learnerSkillState.findFirstOrThrow({ where: { userId, skillId } });
    expect(stateAfter.lastMeasurementAt!.getTime()).toBeGreaterThan(stateBefore.lastMeasurementAt!.getTime());

    // Retention refreshed → REVIEW_DUE cleared even under the advanced clock (lastMeasurementAt is now recent).
    const point = pointOf((await request(srv()).get(`/api/v2/roadmap/subjects/${subjectId}`).set(auth(token))).body);
    expect(point.attention).toBe('NONE');
  });

  it('RA-05: repair via teaching resolves the misconception; competence recomputed; history preserved; generation not rewritten', async () => {
    const { token, userId } = await makeLearner();
    await teachToLearned(token);
    const genBefore = (await request(srv()).get(`/api/v2/roadmap/subjects/${subjectId}`).set(auth(token))).body.generation.id;
    const { skillId, activityIds } = await affirmativeSkillActivityIds();

    // Trigger REPAIR.
    const s1 = await request(srv()).post(`/api/v2/roadmap-points/${pointId}/teaching-session/start`).set(auth(token));
    for (const aid of activityIds) await submitTeaching(token, s1.body.id, aid, 'b');
    expect(pointOf((await request(srv()).get(`/api/v2/roadmap/subjects/${subjectId}`).set(auth(token))).body).attention).toBe('REPAIR_REQUIRED');

    // Repair = go back through the teaching flow (not a re-quiz): answer the affirmative activities correctly.
    const s2 = await request(srv()).post(`/api/v2/roadmap-points/${pointId}/teaching-session/start`).set(auth(token));
    // two most-recent DISTINCT correct outcomes resolve the misconception (recovery rule)
    await submitTeaching(token, s2.body.id, activityIds[1], 'a');
    await submitTeaching(token, s2.body.id, activityIds[0], 'a');
    await submitTeaching(token, s2.body.id, activityIds[2], 'a');

    expect(await prisma.learnerSignal.count({ where: { userId, skillId, type: 'REPEATED_MISTAKE', status: SignalStatus.ACTIVE } })).toBe(0);
    const roadmapAfter = await request(srv()).get(`/api/v2/roadmap/subjects/${subjectId}`).set(auth(token));
    expect(pointOf(roadmapAfter.body).attention).toBe('NONE');
    // History preserved: still exactly one LEARNED event, and the SAME roadmap generation (no rewrite).
    expect(await prisma.pointAcquisitionEvent.count({ where: { userId, roadmapPointId: pointId, acquisitionType: PointAcquisitionType.LEARNED } })).toBe(1);
    expect(roadmapAfter.body.generation.id).toBe(genBefore);
  });

  it('RA-06: another user cannot start a review on someone else\'s point (404-safe); focus for a fresh learner is CONTINUE', async () => {
    const { skillId } = await affirmativeSkillActivityIds();
    const stranger = await makeLearner(); // never acquired the point
    const res = await request(srv()).post(`/api/v2/roadmap-points/${pointId}/review/skills/${skillId}/start`).set(auth(stranger.token));
    expect(res.status).toBe(404); // not acquired → not reviewable, indistinguishable from non-existent

    const focus = await request(srv()).get(`/api/v2/roadmap/subjects/${subjectId}/focus`).set(auth(stranger.token));
    expect(focus.body.action).toBe('CONTINUE'); // next useful action is to learn the available point
    expect(focus.body.point.pointKey).toBe('ENG-A1-PRESENT-SIMPLE');
  });
});
