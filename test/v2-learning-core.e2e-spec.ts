import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import {
  ActivityType,
  ContainerStatus,
  ContentSource,
  LessonStatus,
  PointAcquisitionType,
  RevisionStatus,
  SkillMeasurementSource,
} from '@prisma/client';
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
 * V2 Learning Core vertical slice (e2e, izlan_test). Proves the full Present Simple LEARNED journey:
 * provision → roadmap → start/resume (pinned revisions) → objective attempts (idempotent) → evidence lineage
 * → recompute → mastery evaluation (exact evidence) → LEARNED acquisition → projection reflects LEARNED.
 */
describe('V2 Learning Core — Present Simple LEARNED journey (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let authz: AuthorizationRepository;
  const sms = new TestSmsAdapter();
  let seq = 0;
  const phone = () => `+99890${String(6100000 + seq++).slice(-7)}`;

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
    subjectId = await seedPresentSimpleContent();
    // Provision the canonical V2 point on top of the seeded content.
    await provisionV2PresentSimple(prisma, { nodeEnv: 'test', allowDevFixture: 'true' });
  }, 120_000);

  afterAll(async () => {
    await reset();
    await app.close();
  });

  const srv = () => app.getHttpServer();

  async function reset() {
    // V2 learner facts (child → parent). skill_measurement RESTRICTs teaching_session + expectation revision,
    // so it (and everything referencing it) must be deleted before those.
    await prisma.pointAcquisitionEvent.deleteMany();
    await prisma.masteryEvaluationEvidence.deleteMany();
    await prisma.skillMeasurementEvidenceRef.deleteMany();
    await prisma.masteryEvaluation.deleteMany();
    await prisma.skillMeasurement.deleteMany();
    await prisma.roadmapPointProjection.deleteMany();
    await prisma.learnerRoadmapGeneration.deleteMany();
    await prisma.teachingSessionContentPin.deleteMany();
    await prisma.activityAttempt.deleteMany();
    await prisma.teachingSession.deleteMany();
    await prisma.learnerSkillState.deleteMany();
    await prisma.learnerSignal.deleteMany();
    await prisma.learnerLearningIntent.deleteMany();
    // V2 canonical (null circular pointers first).
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
    // Base content.
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

  /** Seed the minimal REAL Present Simple content (subject english-a1-dev, Level A1, 3 skills, lessons 010/011/012). */
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
      const skill = await prisma.skill.create({ data: { subjectId: subject.id, code, name: code, sortOrder: 11 + i } });
      const lesson = await prisma.lesson.create({ data: { topicId: topic.id, contentKey, slug: contentKey.toLowerCase(), sortOrder: 10 + i, status: LessonStatus.PUBLISHED, createdBy: author.id } });
      const rev = await prisma.lessonRevision.create({ data: { lessonId: lesson.id, version: 1, title: contentKey, status: RevisionStatus.PUBLISHED, createdBy: author.id, publishedBy: author.id, publishedAt: new Date() } });
      await prisma.lesson.update({ where: { id: lesson.id }, data: { publishedRevisionId: rev.id } });
      await prisma.lessonSkill.create({ data: { lessonId: lesson.id, skillId: skill.id } });
      // 4 activities: explanation (view), mini-question (recognition), practice (production), mastery-test (mastery).
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

  async function makeLearner(): Promise<{ token: string; userId: string }> {
    const ph = phone();
    const r = await request(srv()).post('/api/auth/otp/request').send({ phone: ph });
    const reg = await request(srv()).post('/api/auth/register').send({ challengeId: r.body.challengeId, code: sms.latestCode(), password: 'Passw0rd!123' });
    const user = await prisma.user.findUnique({ where: { phone: ph } });
    return { token: reg.body.accessToken as string, userId: user!.id };
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('V2-LC-01: provisions the pilot idempotently (no duplicate point/blueprint/requirement)', async () => {
    const again = await provisionV2PresentSimple(prisma, { nodeEnv: 'test', allowDevFixture: 'true' });
    const points = await prisma.roadmapPoint.count({ where: { pointKey: 'ENG-A1-PRESENT-SIMPLE' } });
    const blueprints = await prisma.teachingBlueprint.count();
    const requirements = await prisma.masteryRequirement.count();
    expect(points).toBe(1);
    expect(blueprints).toBe(1);
    expect(requirements).toBe(1);
    expect(again.stageCount).toBeGreaterThanOrEqual(4);
    expect(again.bindingCount).toBeGreaterThanOrEqual(6);
  });

  it('V2-LC-02: learner opens the A1 roadmap and sees the Present Simple point (not learned)', async () => {
    const { token } = await makeLearner();
    const res = await request(srv()).get(`/api/v2/roadmap/subjects/${subjectId}`).set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.generation).not.toBeNull();
    const point = res.body.points.find((p: { pointKey: string }) => p.pointKey === 'ENG-A1-PRESENT-SIMPLE');
    expect(point).toBeDefined();
    expect(point.title).toBe('Present Simple');
    expect(point.learned).toBe(false);
    expect(point.availability).toBe('AVAILABLE');
  });

  it('V2-LC-03..11: full teaching journey → LEARNED, with pinned revisions, evidence lineage, idempotency, projection', async () => {
    const { token, userId } = await makeLearner();
    const pointRow = await prisma.roadmapPoint.findUniqueOrThrow({ where: { pointKey: 'ENG-A1-PRESENT-SIMPLE' } });

    // Start the session.
    const start = await request(srv()).post(`/api/v2/roadmap-points/${pointRow.id}/teaching-session/start`).set(auth(token));
    expect(start.status).toBe(200);
    const sessionId = start.body.id as string;
    const pinnedBlueprintRev = start.body.blueprintRevisionId as string;
    const pinnedPointRev = start.body.roadmapPointRevisionId as string;
    expect(start.body.stages.length).toBeGreaterThanOrEqual(4);
    // No answer key leaks anywhere in the session view.
    expect(JSON.stringify(start.body)).not.toContain('answerKey');
    expect(JSON.stringify(start.body)).not.toContain('correctOptionIds');

    // Resume pins the SAME revisions (no repin).
    const resume = await request(srv()).get(`/api/v2/teaching-sessions/${sessionId}`).set(auth(token));
    expect(resume.body.blueprintRevisionId).toBe(pinnedBlueprintRev);
    expect(resume.body.roadmapPointRevisionId).toBe(pinnedPointRev);
    const startAgain = await request(srv()).post(`/api/v2/roadmap-points/${pointRow.id}/teaching-session/start`).set(auth(token));
    expect(startAgain.body.id).toBe(sessionId);
    expect(startAgain.body.blueprintRevisionId).toBe(pinnedBlueprintRev);

    // Collect the mastery-stage activities from the session view.
    const stages = resume.body.stages as { stageType: string; activities: { id: string; kind: string }[] }[];
    const masteryStage = stages.find((s) => s.stageType === 'mastery');
    expect(masteryStage).toBeDefined();
    const masteryActs = masteryStage!.activities.filter((a) => a.kind === 'OBJECTIVE');
    expect(masteryActs.length).toBe(3);

    // Answer each mastery activity correctly (option 'a').
    for (const a of masteryActs) {
      const crid = cryptoUuid();
      const submit = await request(srv())
        .post(`/api/v2/teaching-sessions/${sessionId}/activities/${a.id}/attempts`)
        .set(auth(token))
        .send({ clientRequestId: crid, answer: { selectedOptionId: 'a' } });
      expect(submit.status).toBe(200);
      expect(submit.body.isCorrect).toBe(true);
      expect(submit.body.deterministicScore).toBe(10000);
      expect(JSON.stringify(submit.body)).not.toContain('answerKey');

      // Idempotent replay: same clientRequestId + same answer → same attempt, no new row.
      const replay = await request(srv())
        .post(`/api/v2/teaching-sessions/${sessionId}/activities/${a.id}/attempts`)
        .set(auth(token))
        .send({ clientRequestId: crid, answer: { selectedOptionId: 'a' } });
      expect(replay.status).toBe(200);
      expect(replay.body.attemptId).toBe(submit.body.attemptId);
      // Same id, DIFFERENT answer → 409 conflict.
      const conflict = await request(srv())
        .post(`/api/v2/teaching-sessions/${sessionId}/activities/${a.id}/attempts`)
        .set(auth(token))
        .send({ clientRequestId: crid, answer: { selectedOptionId: 'b' } });
      expect(conflict.status).toBe(409);
    }

    // An incorrect answer yields useful remediation (no answer key).
    const wrongCrid = cryptoUuid();
    const wrong = await request(srv())
      .post(`/api/v2/teaching-sessions/${sessionId}/activities/${masteryActs[0].id}/attempts`)
      .set(auth(token))
      .send({ clientRequestId: wrongCrid, answer: { selectedOptionId: 'b' } });
    expect(wrong.body.isCorrect).toBe(false);
    expect(typeof wrong.body.remediation).toBe('string');
    expect(wrong.body.remediation.length).toBeGreaterThan(0);

    // Run mastery check → SATISFIED + LEARNED.
    const mastery = await request(srv()).post(`/api/v2/teaching-sessions/${sessionId}/mastery-check`).set(auth(token));
    expect(mastery.status).toBe(200);
    expect(mastery.body.outcome).toBe('SATISFIED');
    expect(mastery.body.satisfied).toBe(true);
    expect(mastery.body.learned).toBe(true);
    expect(mastery.body.acquisitionId).toBeTruthy();

    // Evidence lineage: TEACHING_MASTERY measurements exist, each with evidence refs to attempts.
    const measurements = await prisma.skillMeasurement.findMany({ where: { userId, source: SkillMeasurementSource.TEACHING_MASTERY, teachingSessionId: sessionId } });
    expect(measurements.length).toBe(3);
    const refs = await prisma.skillMeasurementEvidenceRef.findMany({ where: { skillMeasurementId: { in: measurements.map((m) => m.id) } } });
    expect(refs.length).toBeGreaterThanOrEqual(3);
    expect(refs.every((r) => r.activityAttemptId !== null)).toBe(true);

    // LearnerSkillState recomputed through the single writer.
    const states = await prisma.learnerSkillState.findMany({ where: { userId } });
    expect(states.length).toBe(3);
    expect(states.every((s) => s.masteryScoreBp >= 8000)).toBe(true);

    // MasteryEvaluation pins the EXACT evidence set.
    const evaluation = await prisma.masteryEvaluation.findFirstOrThrow({ where: { userId, roadmapPointId: pointRow.id } });
    expect(evaluation.outcome).toBe('SATISFIED');
    const evEvidence = await prisma.masteryEvaluationEvidence.findMany({ where: { masteryEvaluationId: evaluation.id } });
    expect(new Set(evEvidence.map((e) => e.skillMeasurementId))).toEqual(new Set(measurements.map((m) => m.id)));

    // Exactly ONE LEARNED acquisition event.
    const events = await prisma.pointAcquisitionEvent.findMany({ where: { userId, roadmapPointId: pointRow.id, acquisitionType: PointAcquisitionType.LEARNED } });
    expect(events.length).toBe(1);
    expect(events[0].masteryEvaluationId).toBe(evaluation.id);
    expect(events[0].placementDecisionId).toBeNull(); // LEARNED != VALIDATED

    // No fake lesson completion was created.
    expect(await prisma.learnerLessonCompletion.count({ where: { userId } })).toBe(0);

    // Re-running mastery check is idempotent (no second acquisition).
    const again = await request(srv()).post(`/api/v2/teaching-sessions/${sessionId}/mastery-check`).set(auth(token));
    expect(again.body.learned).toBe(true);
    expect(await prisma.pointAcquisitionEvent.count({ where: { userId, roadmapPointId: pointRow.id } })).toBe(1);

    // Roadmap now reflects LEARNED.
    const roadmap = await request(srv()).get(`/api/v2/roadmap/subjects/${subjectId}`).set(auth(token));
    const point = roadmap.body.points.find((p: { pointKey: string }) => p.pointKey === 'ENG-A1-PRESENT-SIMPLE');
    expect(point.learned).toBe(true);
    expect(point.acquisition).toBe('LEARNED');
  });

  it('V2-LC-12: another user cannot see or act on the session (404-safe)', async () => {
    const owner = await makeLearner();
    const pointRow = await prisma.roadmapPoint.findUniqueOrThrow({ where: { pointKey: 'ENG-A1-PRESENT-SIMPLE' } });
    const start = await request(srv()).post(`/api/v2/roadmap-points/${pointRow.id}/teaching-session/start`).set(auth(owner.token));
    const sessionId = start.body.id as string;

    const other = await makeLearner();
    const get = await request(srv()).get(`/api/v2/teaching-sessions/${sessionId}`).set(auth(other.token));
    expect(get.status).toBe(404);
    const masteryActId = (start.body.stages.find((s: { stageType: string }) => s.stageType === 'mastery').activities[0]).id;
    const submit = await request(srv())
      .post(`/api/v2/teaching-sessions/${sessionId}/activities/${masteryActId}/attempts`)
      .set(auth(other.token))
      .send({ clientRequestId: cryptoUuid(), answer: { selectedOptionId: 'a' } });
    expect(submit.status).toBe(404);
  });
});

function cryptoUuid(): string {
  // Node crypto (available in the test runtime).
  return require('crypto').randomUUID();
}
