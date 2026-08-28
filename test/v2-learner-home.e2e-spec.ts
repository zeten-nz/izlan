import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { ActivityType, ContainerStatus, ContentSource, LessonStatus, RevisionStatus } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createFastifyAdapter } from '../src/bootstrap/http-adapter';
import { PrismaService } from '../src/database/prisma.service';
import { AuthorizationRepository } from '../src/authorization/authorization.repository';
import { AuthExceptionFilter } from '../src/auth/http/auth-exception.filter';
import { SMS_PORT } from '../src/sms/sms.port';
import { bootstrapSystemRoles } from '../src/bootstrap/system-roles';
import { cleanupAuthTables } from './test-db.helper';
import { TestSmsAdapter } from './test-sms.adapter';
import { provisionV2PresentSimple, V2_PRESENT_SIMPLE_SKILL_CODES, V2_PRESENT_SIMPLE_LESSON_KEYS } from '../src/bootstrap/provision-v2-present-simple';

/**
 * V2 Learner first-run home (e2e, izlan_test). Proves the server-authoritative landing decision:
 * not-onboarded → ONBOARDING; onboarded but not placed → PLACEMENT; placed → TODAY (+ resume when a teaching
 * session is open). Own-user isolated, auth-gated, and answer-key-free.
 */
describe('V2 Learner first-run home (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let authz: AuthorizationRepository;
  const sms = new TestSmsAdapter();
  let seq = 0;
  const phone = () => `+99890${String(6300000 + seq++).slice(-7)}`;

  const OBJ_V = 'lesson-activity-objective/v1';
  const MD_V = 'lesson-activity-markdown/v1';
  const md = (markdown: string) => ({ schemaVersion: MD_V, markdown });
  const sc = (prompt: string, correctId: string) => ({
    schemaVersion: OBJ_V, format: 'single_choice', prompt,
    options: [{ id: 'a', text: 'Correct form' }, { id: 'b', text: 'Wrong form' }, { id: 'c', text: 'Also wrong' }],
    answerKey: { correctOptionIds: [correctId] },
  });

  let subjectId = '';
  let trackId = '';

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(SMS_PORT).useValue(sms).compile();
    app = mod.createNestApplication<NestFastifyApplication>(createFastifyAdapter());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AuthExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = mod.get(PrismaService);
    authz = mod.get(AuthorizationRepository);
    await reset();
    ({ subjectId, trackId } = await seedPresentSimpleContent());
    await provisionV2PresentSimple(prisma, { nodeEnv: 'test', allowDevFixture: 'true' });
  }, 120_000);

  afterAll(async () => { await reset(); await app.close(); });

  const srv = () => app.getHttpServer();
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function reset() {
    await prisma.dailyLearningPlan.deleteMany();
    await prisma.xpGrant.deleteMany();
    await prisma.dailyMissionCompletionEvidence.deleteMany();
    await prisma.dailyMissionCompletion.deleteMany();
    await prisma.pointAcquisitionEvent.deleteMany();
    await prisma.masteryEvaluationEvidence.deleteMany();
    await prisma.skillMeasurementEvidenceRef.deleteMany();
    await prisma.masteryEvaluation.deleteMany();
    await prisma.placementDecisionValidation.deleteMany();
    await prisma.skillMeasurement.deleteMany();
    await prisma.roadmapPointProjection.deleteMany();
    await prisma.learnerRoadmapGeneration.deleteMany();
    await prisma.teachingSessionContentPin.deleteMany();
    await prisma.activityAttempt.deleteMany();
    await prisma.teachingSession.deleteMany();
    await prisma.placementDecision.deleteMany();
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

  async function seedPresentSimpleContent(): Promise<{ subjectId: string; trackId: string }> {
    const author = await prisma.user.create({ data: { phone: phone() } });
    const subject = await prisma.subject.create({ data: { slug: 'english-a1-dev', title: 'English — Beginner (A1)', status: ContainerStatus.PUBLISHED, createdBy: author.id } });
    const track = await prisma.track.create({ data: { subjectId: subject.id, slug: 'general-a1-dev', title: 'General English A1', status: ContainerStatus.PUBLISHED, sortOrder: 1, createdBy: author.id } });
    const level = await prisma.level.create({ data: { trackId: track.id, code: 'A1', title: 'A1', status: ContainerStatus.PUBLISHED, sortOrder: 1, createdBy: author.id } });
    const moduleRow = await prisma.module.create({ data: { levelId: level.id, title: 'A1 Foundations', status: ContainerStatus.PUBLISHED, sortOrder: 1, createdBy: author.id } });
    const topic = await prisma.topic.create({ data: { moduleId: moduleRow.id, title: 'Kundalik hayot', status: ContainerStatus.PUBLISHED, sortOrder: 4, createdBy: author.id } });

    for (let i = 0; i < 3; i++) {
      const skill = await prisma.skill.create({ data: { subjectId: subject.id, code: V2_PRESENT_SIMPLE_SKILL_CODES[i], name: V2_PRESENT_SIMPLE_SKILL_CODES[i], sortOrder: 11 + i } });
      const contentKey = V2_PRESENT_SIMPLE_LESSON_KEYS[i];
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
    return { subjectId: subject.id, trackId: track.id };
  }

  /** Register a learner. By default NOT onboarded (no onboardingCompletedAt, no intent). */
  async function registerLearner(): Promise<{ token: string; userId: string }> {
    const ph = phone();
    const r = await request(srv()).post('/api/auth/otp/request').send({ phone: ph });
    const reg = await request(srv()).post('/api/auth/register').send({ challengeId: r.body.challengeId, code: sms.latestCode(), password: 'Passw0rd!123' });
    const user = await prisma.user.findUniqueOrThrow({ where: { phone: ph } });
    return { token: reg.body.accessToken as string, userId: user.id };
  }

  /** Mark onboarding complete + attach a complete (track-carrying) learning intent to the pilot subject. */
  async function onboard(userId: string): Promise<void> {
    await prisma.userProfile.update({ where: { userId }, data: { displayName: 'A', dateOfBirth: new Date('2005-01-01'), timezone: 'Asia/Tashkent', onboardingCompletedAt: new Date() } });
    await prisma.learnerLearningIntent.create({ data: { userId, subjectId, trackId } });
  }

  const home = (token: string) => request(srv()).get('/api/v2/learner/home').set(auth(token));
  const pointId = async () => (await prisma.roadmapPoint.findUniqueOrThrow({ where: { pointKey: 'ENG-A1-PRESENT-SIMPLE' } })).id;

  // ───────────────────────────────────────────────────────────────────────────

  it('LH-01 a brand-new learner (not onboarded) → ONBOARDING, no subject', async () => {
    const { token } = await registerLearner();
    const res = await home(token);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ stage: 'ONBOARDING', onboardingCompleted: false, subject: null, resume: null, policyVersion: 'learner-home-v1' });
  });

  it('LH-02 onboarded with a subject but no placement decision → PLACEMENT with the primary subject', async () => {
    const { token, userId } = await registerLearner();
    await onboard(userId);
    const res = await home(token);
    expect(res.status).toBe(200);
    expect(res.body.stage).toBe('PLACEMENT');
    expect(res.body.onboardingCompleted).toBe(true);
    expect(res.body.subject).toEqual({ id: subjectId, title: 'English — Beginner (A1)' });
    expect(res.body.resume).toBeNull();
  });

  it('LH-03 placement decided via fresh-start → TODAY with subject and no forced diagnostic', async () => {
    const { token, userId } = await registerLearner();
    await onboard(userId);
    const fz = await request(srv()).post(`/api/v2/placement/subjects/${subjectId}/from-zero`).set(auth(token)).send({ clientRequestId: randomUUID() });
    expect(fz.status).toBe(200);
    const res = await home(token);
    expect(res.body.stage).toBe('TODAY');
    expect(res.body.subject.id).toBe(subjectId);
    expect(res.body.resume).toBeNull();
  });

  it('LH-04 an open teaching session surfaces as a TODAY resume action', async () => {
    const { token, userId } = await registerLearner();
    await onboard(userId);
    await request(srv()).post(`/api/v2/placement/subjects/${subjectId}/from-zero`).set(auth(token)).send({ clientRequestId: randomUUID() });
    const rpId = await pointId();
    const start = await request(srv()).post(`/api/v2/roadmap-points/${rpId}/teaching-session/start`).set(auth(token));
    expect(start.status).toBe(200);

    const res = await home(token);
    expect(res.body.stage).toBe('TODAY');
    expect(res.body.resume).toEqual({ sessionId: start.body.id, pointId: rpId, pointTitle: 'Present Simple' });
  });

  it('LH-05 own-user only, auth-gated, no answer-key leak', async () => {
    const a = await registerLearner();
    await onboard(a.userId);
    await request(srv()).post(`/api/v2/placement/subjects/${subjectId}/from-zero`).set(auth(a.token)).send({ clientRequestId: randomUUID() });
    // A second, brand-new learner sees their OWN state (ONBOARDING), never learner A's.
    const b = await registerLearner();
    const bHome = await home(b.token);
    expect(bHome.body.stage).toBe('ONBOARDING');
    // Unauthenticated is rejected.
    expect((await request(srv()).get('/api/v2/learner/home')).status).toBe(401);
    // No answer-key material anywhere in the payload.
    const aHome = await home(a.token);
    expect(JSON.stringify(aHome.body)).not.toMatch(/answerKey|correctOptionIds/);
  });
});
