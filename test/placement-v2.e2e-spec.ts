import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import {
  ActivityType,
  AssessmentPurposeScope,
  ContainerStatus,
  ContentSource,
  LessonStatus,
  PointAcquisitionType,
  RevisionStatus,
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
import { PLACEMENT_ITEM_SCHEMA_VERSION } from '../src/assessment/scoring/item-payload';
import { PLACEMENT_CONFIG_SCHEMA_VERSION, PLACEMENT_ENGINE_VERSION } from '../src/assessment/engine/placement-engine.types';
import { provisionV2EnglishA1Roadmap, A1_POINT_PLAN } from '../src/bootstrap/provision-v2-english-a1-roadmap';

/**
 * Placement V2 + Personalized Roadmap (e2e, izlan_test). Proves: from-zero (no fake evidence), diagnostic ->
 * immutable PlacementDecision -> validation lineage -> VALIDATED acquisition, gaps remain, unassessed not
 * validated, idempotency, 404-safe, no answer-key leak, and continue-into-teaching for an AVAILABLE point.
 */
describe('Placement V2 + Personalized Roadmap (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let authz: AuthorizationRepository;
  const sms = new TestSmsAdapter();
  let seq = 0;
  const phone = () => `+99890${String(6200000 + seq++).slice(-7)}`;

  // The 13 A1 skill codes + their diagnostic item difficulties. Points 1-2 skills get high-difficulty items so
  // a correct answer VALIDATES them; the rest get low-difficulty items so a wrong answer marks them WEAK/gap.
  const ALL_SKILLS = A1_POINT_PLAN.flatMap((p) => p.skillCodes);
  const VALIDATE_SKILLS = new Set([...A1_POINT_PLAN[0].skillCodes, ...A1_POINT_PLAN[1].skillCodes]); // points 1-2

  let subjectId = '';
  let trackId = '';
  let itemSkillById = new Map<string, string>(); // itemId -> skillCode (to answer correctly/incorrectly)

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
    await seedA1Content();
    await provisionV2EnglishA1Roadmap(prisma, { nodeEnv: 'test', allowDevFixture: 'true' });
  }, 120_000);

  afterAll(async () => {
    await reset();
    await app.close();
  });

  const srv = () => app.getHttpServer();
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function reset() {
    await prisma.pointAcquisitionValidationRef.deleteMany();
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
    // assessment
    await prisma.assessmentResponse.deleteMany();
    await prisma.assessmentAttempt.deleteMany();
    await prisma.assessmentVersionItem.deleteMany();
    await prisma.assessmentItem.deleteMany();
    await prisma.assessmentDefinition.updateMany({ data: { currentVersionId: null } });
    await prisma.assessmentDefinitionVersion.deleteMany();
    await prisma.assessmentDefinition.deleteMany();
    // V2 canonical
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
    // base content
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

  async function seedA1Content() {
    const author = await prisma.user.create({ data: { phone: phone() } });
    const subject = await prisma.subject.create({ data: { slug: 'english-a1-dev', title: 'English — Beginner (A1)', status: ContainerStatus.PUBLISHED, createdBy: author.id } });
    const track = await prisma.track.create({ data: { subjectId: subject.id, slug: 'general-a1-dev', title: 'General English A1', status: ContainerStatus.PUBLISHED, sortOrder: 1, createdBy: author.id } });
    const level = await prisma.level.create({ data: { trackId: track.id, code: 'A1', title: 'A1', status: ContainerStatus.PUBLISHED, sortOrder: 1, createdBy: author.id } });
    const moduleRow = await prisma.module.create({ data: { levelId: level.id, title: 'A1 Foundations', status: ContainerStatus.PUBLISHED, sortOrder: 1, createdBy: author.id } });
    const topic = await prisma.topic.create({ data: { moduleId: moduleRow.id, title: 'A1', status: ContainerStatus.PUBLISHED, sortOrder: 1, createdBy: author.id } });
    subjectId = subject.id;
    trackId = track.id;

    // 13 skills.
    const skillIdByCode = new Map<string, string>();
    let so = 1;
    for (const code of ALL_SKILLS) {
      const skill = await prisma.skill.create({ data: { subjectId: subject.id, code, name: code, sortOrder: so++ } });
      skillIdByCode.set(code, skill.id);
    }

    // One lesson per point, mastery activity mapped to ALL the point's skills (so the blueprint + mastery cover them).
    for (const p of A1_POINT_PLAN) {
      const contentKey = p.lessonKeys[0];
      const lesson = await prisma.lesson.create({ data: { topicId: topic.id, contentKey, slug: contentKey.toLowerCase(), sortOrder: p.sortOrder, status: LessonStatus.PUBLISHED, createdBy: author.id } });
      const rev = await prisma.lessonRevision.create({ data: { lessonId: lesson.id, version: 1, title: contentKey, status: RevisionStatus.PUBLISHED, createdBy: author.id, publishedBy: author.id, publishedAt: new Date() } });
      await prisma.lesson.update({ where: { id: lesson.id }, data: { publishedRevisionId: rev.id } });
      for (const code of p.skillCodes) await prisma.lessonSkill.create({ data: { lessonId: lesson.id, skillId: skillIdByCode.get(code)! } });
      const acts: { type: ActivityType; position: number; payload: object }[] = [
        { type: ActivityType.EXPLANATION, position: 0, payload: { schemaVersion: 'lesson-activity-markdown/v1', markdown: '## Learn' } },
        { type: ActivityType.MINI_QUESTION, position: 1, payload: obj('Recognize?', 'a') },
        { type: ActivityType.PRACTICE, position: 2, payload: obj('Practice?', 'a') },
        { type: ActivityType.MASTERY_TEST, position: 3, payload: obj('Mastery?', 'a') },
      ];
      for (const a of acts) {
        const activity = await prisma.activity.create({ data: { lessonRevisionId: rev.id, type: a.type, position: a.position, source: ContentSource.HUMAN, payload: a.payload } });
        if (a.type !== ActivityType.EXPLANATION) for (const code of p.skillCodes) await prisma.activitySkill.create({ data: { activityId: activity.id, skillId: skillIdByCode.get(code)! } });
      }
    }

    // DIAGNOSTIC definition + one item per skill (difficulty 6 for validate-skills, 1 for others).
    const def = await prisma.assessmentDefinition.create({ data: { subjectId: subject.id, purposeScope: AssessmentPurposeScope.DIAGNOSTIC, title: 'English A1 Placement', status: ContainerStatus.PUBLISHED, createdBy: author.id } });
    const config = { schemaVersion: PLACEMENT_CONFIG_SCHEMA_VERSION, engine: PLACEMENT_ENGINE_VERSION, selection: { startDifficulty: 3, stepUp: 1, stepDown: 1 }, coverage: { itemsPerSkill: 1 }, stopping: { maxItems: ALL_SKILLS.length }, profileScale: { minDifficulty: 1, maxDifficulty: 6 } };
    const version = await prisma.assessmentDefinitionVersion.create({ data: { definitionId: def.id, versionNo: 1, config: config as object, status: RevisionStatus.PUBLISHED, createdBy: author.id, publishedAt: new Date() } });
    await prisma.assessmentDefinition.update({ where: { id: def.id }, data: { currentVersionId: version.id } });
    itemSkillById = new Map();
    for (const code of ALL_SKILLS) {
      const difficulty = VALIDATE_SKILLS.has(code) ? 6 : 1;
      const item = await prisma.assessmentItem.create({ data: { definitionId: def.id, type: ActivityType.MINI_QUESTION, payload: pItem(`Q ${code}`, 'a') as object, skillId: skillIdByCode.get(code)!, difficulty, status: RevisionStatus.PUBLISHED, source: ContentSource.HUMAN } });
      await prisma.assessmentVersionItem.create({ data: { versionId: version.id, itemId: item.id } });
      itemSkillById.set(item.id, code);
    }
  }

  const obj = (prompt: string, correctId: string) => ({ schemaVersion: 'lesson-activity-objective/v1', format: 'single_choice', prompt, options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], answerKey: { correctOptionIds: [correctId] } });
  const pItem = (prompt: string, correctId: string) => ({ schemaVersion: PLACEMENT_ITEM_SCHEMA_VERSION, format: 'single_choice', prompt, options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], answerKey: { correctOptionIds: [correctId] } });

  async function makeLearner(): Promise<{ token: string; userId: string }> {
    const ph = phone();
    const r = await request(srv()).post('/api/auth/otp/request').send({ phone: ph });
    const reg = await request(srv()).post('/api/auth/register').send({ challengeId: r.body.challengeId, code: sms.latestCode(), password: 'Passw0rd!123' });
    const user = await prisma.user.findUnique({ where: { phone: ph } });
    // The DIAGNOSTIC start gate requires a completed onboarding profile (validateIntent → OnboardingIncompleteError).
    await prisma.userProfile.update({ where: { userId: user!.id }, data: { displayName: 'L', timezone: 'Asia/Tashkent', onboardingCompletedAt: new Date() } });
    return { token: reg.body.accessToken as string, userId: user!.id };
  }

  async function makeLearnerWithIntent() {
    const l = await makeLearner();
    const intent = await prisma.learnerLearningIntent.create({ data: { userId: l.userId, subjectId, trackId } });
    return { ...l, intentId: intent.id };
  }

  /** Run the diagnostic to completion, answering correctly for validate-skills and wrong otherwise. Returns attemptId. */
  async function runDiagnostic(token: string, intentId: string): Promise<string> {
    const start = await request(srv()).post('/api/assessments/placement/start').set(auth(token)).send({ learningIntentId: intentId });
    expect(start.status).toBe(200);
    const attemptId = start.body.attemptId as string;
    let item = start.body.item as { id: string } | null;
    let guard = 0;
    while (item && guard++ < 50) {
      const code = itemSkillById.get(item.id);
      const answer = code && VALIDATE_SKILLS.has(code) ? { selectedOptionId: 'a' } : { selectedOptionId: 'b' };
      const res = await request(srv()).post(`/api/assessments/attempts/${attemptId}/responses`).set(auth(token)).send({ itemId: item.id, answer });
      expect(res.status).toBe(200);
      item = res.body.item;
    }
    return attemptId;
  }

  it('PV2-01: from-zero creates a FRESH_START decision with NO validated points and NO fake evidence', async () => {
    const l = await makeLearnerWithIntent();
    const res = await request(srv()).post(`/api/v2/placement/subjects/${subjectId}/from-zero`).set(auth(l.token)).send({ clientRequestId: randomUUID() });
    expect(res.status).toBe(200);
    expect(res.body.decisionType).toBe('FRESH_START');
    expect(res.body.summary.validatedCount).toBe(0);
    expect(res.body.points.every((p: { outcome: string }) => p.outcome === 'AVAILABLE')).toBe(true);
    // No fake evidence / validations / acquisitions.
    expect(await prisma.skillMeasurement.count({ where: { userId: l.userId } })).toBe(0);
    expect(await prisma.placementDecisionValidation.count()).toBe(0);
    expect(await prisma.pointAcquisitionEvent.count({ where: { userId: l.userId } })).toBe(0);
    expect(await prisma.learnerLessonCompletion.count({ where: { userId: l.userId } })).toBe(0);
    // Roadmap: first point AVAILABLE, later points LOCKED by prerequisites.
    const roadmap = await request(srv()).get(`/api/v2/roadmap/subjects/${subjectId}`).set(auth(l.token));
    const byKey = (k: string) => roadmap.body.points.find((p: { pointKey: string }) => p.pointKey === k);
    expect(byKey('ENG-A1-GREETINGS-INTRO').availability).toBe('AVAILABLE');
    expect(byKey('ENG-A1-VERB-BE').availability).toBe('LOCKED');
  });

  it('PV2-02: from-zero is idempotent by clientRequestId', async () => {
    const l = await makeLearnerWithIntent();
    const crid = randomUUID();
    const a = await request(srv()).post(`/api/v2/placement/subjects/${subjectId}/from-zero`).set(auth(l.token)).send({ clientRequestId: crid });
    const b = await request(srv()).post(`/api/v2/placement/subjects/${subjectId}/from-zero`).set(auth(l.token)).send({ clientRequestId: crid });
    expect(a.body.decisionId).toBe(b.body.decisionId);
    expect(await prisma.placementDecision.count({ where: { userId: l.userId } })).toBe(1);
  });

  it('PV2-03..08: diagnostic → immutable decision, validation lineage, gaps, idempotency, continue-into-teaching', async () => {
    const l = await makeLearnerWithIntent();
    const attemptId = await runDiagnostic(l.token, l.intentId);

    const fin = await request(srv()).post(`/api/v2/placement/diagnostics/${attemptId}/finalize`).set(auth(l.token));
    expect(fin.status).toBe(200);
    // Points 1-2 validated (their skills answered correctly at high difficulty); points 3-5 weak.
    expect(fin.body.summary.validatedCount).toBe(2);
    expect(fin.body.summary.weakCount).toBe(3);
    const p1 = fin.body.points.find((p: { pointKey: string }) => p.pointKey === 'ENG-A1-GREETINGS-INTRO');
    const p3 = fin.body.points.find((p: { pointKey: string }) => p.pointKey === 'ENG-A1-PERSONAL-INFO');
    expect(p1.outcome).toBe('VALIDATED');
    expect(p3.outcome).toBe('WEAK');
    expect(fin.body.recommendedStart.roadmapPointId).toBe(p3.roadmapPointId); // first gap
    // Domains: Grammar + Vocabulary measured; Reading/Listening/... not assessed. Never faked.
    const grammar = fin.body.domains.find((d: { code: string }) => d.code === 'GRAMMAR');
    const listening = fin.body.domains.find((d: { code: string }) => d.code === 'LISTENING');
    expect(grammar.state).toBe('MEASURED');
    expect(listening.state).toBe('NOT_ASSESSED');
    expect(listening.bandBp).toBeNull();
    expect(JSON.stringify(fin.body)).not.toContain('answerKey');

    // Immutable PlacementDecision + validation lineage.
    const decision = await prisma.placementDecision.findFirstOrThrow({ where: { userId: l.userId } });
    expect(decision.sourceAttemptId).toBe(attemptId);
    const validations = await prisma.placementDecisionValidation.findMany({ where: { placementDecisionId: decision.id } });
    expect(validations.length).toBe(2); // points 1-2
    expect(validations.every((v) => v.roadmapPointId !== null && v.roadmapPointRevisionId !== null)).toBe(true); // point-target pins revision
    const events = await prisma.pointAcquisitionEvent.findMany({ where: { userId: l.userId, acquisitionType: PointAcquisitionType.VALIDATED } });
    expect(events.length).toBe(2);
    expect(events.every((e) => e.placementDecisionId === decision.id && e.masteryEvaluationId === null)).toBe(true); // VALIDATED != LEARNED
    const refs = await prisma.pointAcquisitionValidationRef.findMany({ where: { pointAcquisitionEventId: { in: events.map((e) => e.id) } } });
    expect(refs.length).toBe(2); // each VALIDATED event pins its exact validation
    const validationIds = new Set(validations.map((v) => v.id));
    expect(refs.every((r) => validationIds.has(r.placementDecisionValidationId))).toBe(true);

    // No fake completion / teaching / XP for validated points.
    expect(await prisma.learnerLessonCompletion.count({ where: { userId: l.userId } })).toBe(0);
    expect(await prisma.teachingSession.count({ where: { userId: l.userId } })).toBe(0);

    // Roadmap reflects VALIDATED + gaps; the recommended point is AVAILABLE to start.
    const roadmap = await request(srv()).get(`/api/v2/roadmap/subjects/${subjectId}`).set(auth(l.token));
    const rByKey = (k: string) => roadmap.body.points.find((p: { pointKey: string }) => p.pointKey === k);
    expect(rByKey('ENG-A1-GREETINGS-INTRO').validated).toBe(true);
    expect(rByKey('ENG-A1-GREETINGS-INTRO').acquisition).toBe('VALIDATED');
    expect(rByKey('ENG-A1-PERSONAL-INFO').availability).toBe('AVAILABLE'); // prereqs (points 1-2) validated
    expect(rByKey('ENG-A1-FAMILY-POSSESSION').availability).toBe('LOCKED'); // its prereq (point 3) not yet acquired

    // Idempotent finalize → same decision, no duplicate lineage.
    const again = await request(srv()).post(`/api/v2/placement/diagnostics/${attemptId}/finalize`).set(auth(l.token));
    expect(again.body.decisionId).toBe(fin.body.decisionId);
    expect(await prisma.placementDecision.count({ where: { userId: l.userId } })).toBe(1);
    expect(await prisma.pointAcquisitionEvent.count({ where: { userId: l.userId } })).toBe(2);

    // Continue into the existing V2 teaching flow for the AVAILABLE recommended point.
    const startTeach = await request(srv()).post(`/api/v2/roadmap-points/${p3.roadmapPointId}/teaching-session/start`).set(auth(l.token));
    expect(startTeach.status).toBe(200);
    expect(startTeach.body.id).toBeTruthy();
  });

  it('PV2-09: another user cannot finalize placement on someone else\'s attempt (404-safe)', async () => {
    const owner = await makeLearnerWithIntent();
    const attemptId = await runDiagnostic(owner.token, owner.intentId);
    const other = await makeLearner();
    const res = await request(srv()).post(`/api/v2/placement/diagnostics/${attemptId}/finalize`).set(auth(other.token));
    expect(res.status).toBe(404);
  });
});
