import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createFastifyAdapter } from '../src/bootstrap/http-adapter';
import { PrismaService } from '../src/database/prisma.service';
import { AuthorizationRepository } from '../src/authorization/authorization.repository';
import { AuthExceptionFilter } from '../src/auth/http/auth-exception.filter';
import { SMS_PORT } from '../src/sms/sms.port';
import { Clock } from '../src/common/clock';
import { Argon2PasswordHasher } from '../src/auth/password/password-hasher';
import { bootstrapSystemRoles } from '../src/bootstrap/system-roles';
import { runRuntimeFixture } from '../src/bootstrap/seed-runtime';
import { ImportService } from '../src/content-import/import.service';
import { SubjectService } from '../src/content-authoring/subject.service';
import { HierarchyService } from '../src/content-authoring/hierarchy.service';
import { HierarchyPublishService } from '../src/content-authoring/publish/hierarchy-publish.service';
import { PublicationService } from '../src/content-authoring/publish/publication.service';
import { RevisionService } from '../src/content-authoring/revision.service';
import { ActivityService } from '../src/content-authoring/activity.service';
import { SkillMappingService } from '../src/content-authoring/skill-mapping.service';
import { PointAuthoringService } from '../src/point-authoring/point-authoring.service';
import { provisionEnglishA1 } from '../src/bootstrap/provision-english-a1';
import { provisionV2EnglishA1Roadmap } from '../src/bootstrap/provision-v2-english-a1-roadmap';
import { provisionA1Curriculum } from '../src/bootstrap/provision-v2-a1-curriculum';
import { CURRICULUM_POINT_PLAN } from '../src/content-import/pilot/english-a1-curriculum';
import { cleanupAuthTables, cleanupAssessmentTables, cleanupRoadmapContent } from './test-db.helper';
import { TestSmsAdapter } from './test-sms.adapter';

const SEED_ENV = { nodeEnv: 'test', allowDevFixture: 'true', adminPassword: 'DemoAdmin!123', learnerPassword: 'DemoLearner!123' };
const PROV_ENV = { nodeEnv: 'test', allowDevFixture: 'true' };
const SUBJECT_SLUG = 'english-a1-dev';

/**
 * A1 foundation curriculum (e2e, izlan_test). Proves the expansion was authored through the REAL workflow (each new
 * point published only via draft → readiness → APPROVED review → publish) and that a fresh learner then progresses
 * through MULTIPLE new points via the generic V2 product — one new point per local day, LEARNED persistence, and
 * repair on a non-Present-Simple point — with no answer-key leakage and no silent placement validation.
 */
describe('A1 foundation curriculum (e2e, izlan_test)', () => {
  let app: NestFastifyApplication;
  let mod: TestingModule;
  let prisma: PrismaService;
  let authz: AuthorizationRepository;
  const sms = new TestSmsAdapter();
  const clock = { current: new Date('2026-09-01T06:00:00.000Z'), now() { return this.current; } };

  const deps = () => ({
    prisma,
    subjects: mod.get(SubjectService, { strict: false }),
    hierarchy: mod.get(HierarchyService, { strict: false }),
    importer: mod.get(ImportService, { strict: false }),
    hierarchyPublish: mod.get(HierarchyPublishService, { strict: false }),
    publication: mod.get(PublicationService, { strict: false }),
    revisions: mod.get(RevisionService, { strict: false }),
    activities: mod.get(ActivityService, { strict: false }),
    mappings: mod.get(SkillMappingService, { strict: false }),
    points: mod.get(PointAuthoringService, { strict: false }),
  });

  async function wipe() {
    await prisma.pointAcquisitionEvent.deleteMany();
    await prisma.masteryEvaluationEvidence.deleteMany();
    await prisma.skillMeasurementEvidenceRef.deleteMany();
    await prisma.masteryEvaluation.deleteMany();
    await prisma.placementDecisionValidation.deleteMany();
    await prisma.dailyLearningPlan.deleteMany();
    await prisma.learnerReviewSessionActivity.deleteMany();
    await prisma.learnerReviewSession.deleteMany();
    await prisma.skillMeasurement.deleteMany();
    await prisma.xpGrant.deleteMany();
    await prisma.rewardGrant.deleteMany();
    await prisma.aiEvaluation.deleteMany();
    await prisma.dailyMissionCompletionEvidence.deleteMany();
    await prisma.dailyMissionCompletion.deleteMany();
    await prisma.activityAttempt.deleteMany();
    await prisma.teachingSessionContentPin.deleteMany();
    await prisma.teachingSession.deleteMany();
    await prisma.roadmapPointProjection.deleteMany();
    await prisma.learnerRoadmapGeneration.deleteMany();
    await prisma.placementDecision.deleteMany();
    await prisma.learnerSkillState.deleteMany();
    await prisma.learnerSignal.deleteMany();
    await prisma.dailyPlanItem.deleteMany();
    await prisma.dailyPlan.deleteMany();
    // V2 quality artifacts + content graph (reference point/blueprint/lesson revisions + activities/skills — must be
    // torn down BEFORE the shared helpers delete activities/skills). Child → parent, circular pointers nulled first.
    await prisma.contentReview.deleteMany();
    await prisma.contentSourceProvenance.deleteMany();
    await prisma.evidenceIntegrityScope.deleteMany();
    await prisma.evidenceIntegrityDecision.deleteMany();
    await prisma.contentQualityIssue.deleteMany();
    await prisma.sourceReference.deleteMany();
    await prisma.contentQualityPolicyVersion.deleteMany();
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
    await cleanupRoadmapContent(prisma);
    await cleanupAssessmentTables(prisma);
    await prisma.staffAudit.deleteMany();
    await prisma.learnerLearningIntent.deleteMany();
    await prisma.subjectAssignment.deleteMany();
    await prisma.track.deleteMany();
    await prisma.subject.deleteMany();
    await cleanupAuthTables(prisma);
  }

  beforeAll(async () => {
    mod = await Test.createTestingModule({ imports: [AppModule] })
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

    await wipe();
    await bootstrapSystemRoles(authz);
    await runRuntimeFixture({ prisma, authz, hasher: new Argon2PasswordHasher() }, SEED_ENV);
    await provisionEnglishA1(deps(), PROV_ENV);
    await provisionV2EnglishA1Roadmap(prisma, PROV_ENV);
    provisionResult = await provisionA1Curriculum(deps(), PROV_ENV);
  }, 240_000);

  afterAll(async () => { await wipe(); await app.close(); });

  let provisionResult: Awaited<ReturnType<typeof provisionA1Curriculum>>;
  const subjectId = async () => (await prisma.subject.findUniqueOrThrow({ where: { slug: SUBJECT_SLUG } })).id;

  // ─────────────────────────────────────────────────────────────────────────

  it('CUR-E2E-01 authored 16 new points, each PUBLISHED via the real workflow (published blueprint + mastery + APPROVED review)', async () => {
    expect(provisionResult.pointsPublished).toBe(16);
    expect(provisionResult.lessonsPublished).toBe(16);

    for (const spec of CURRICULUM_POINT_PLAN) {
      const point = await prisma.roadmapPoint.findUniqueOrThrow({
        where: { pointKey: spec.pointKey },
        include: { publishedRevision: { include: { skillExpectations: true, prerequisites: true } }, teachingBlueprint: true, masteryRequirement: true },
      });
      // Point + all three bundle parts are PUBLISHED with a current published revision.
      expect(point.status).toBe('PUBLISHED');
      expect(point.publishedRevisionId).toBeTruthy();
      expect(point.teachingBlueprint?.publishedRevisionId).toBeTruthy();
      expect(point.masteryRequirement?.currentRevisionId).toBeTruthy();
      expect(point.publishedRevision!.skillExpectations.length).toBeGreaterThanOrEqual(1);

      // The publish was gated by an APPROVED ContentReview (not a raw insert).
      const approved = await prisma.contentReview.count({ where: { roadmapPointRevisionId: point.publishedRevisionId!, outcome: 'APPROVED' } });
      expect(approved).toBeGreaterThanOrEqual(1);

      // Blueprint has ≥1 EVIDENCE binding, and the mastery gate's skill IS mapped on that evidence activity.
      const evidenceBindings = await prisma.teachingBlueprintContentBinding.findMany({
        where: { role: 'EVIDENCE', stage: { blueprintRevisionId: point.teachingBlueprint!.publishedRevisionId! } },
        select: { activityId: true },
      });
      expect(evidenceBindings.length).toBeGreaterThanOrEqual(1);
      const evidenceSkillIds = new Set((await prisma.activitySkill.findMany({ where: { activityId: { in: evidenceBindings.map((b) => b.activityId!) } }, select: { skillId: true } })).map((r) => r.skillId));
      const skill = await prisma.skill.findUniqueOrThrow({ where: { subjectId_code: { subjectId: await subjectId(), code: spec.skillCode } } });
      expect(evidenceSkillIds.has(skill.id)).toBe(true);
    }
  });

  it('CUR-E2E-02 the prerequisite graph BRANCHES off "the verb to be" — ≥2 new points become available together', async () => {
    const verbBe = await prisma.roadmapPoint.findUniqueOrThrow({ where: { pointKey: 'ENG-A1-VERB-BE' } });
    // Count published new points whose (published) prerequisite set is exactly {VERB-BE}.
    let branchOffVerbBe = 0;
    for (const spec of CURRICULUM_POINT_PLAN) {
      const point = await prisma.roadmapPoint.findUniqueOrThrow({ where: { pointKey: spec.pointKey }, include: { publishedRevision: { include: { prerequisites: true } } } });
      const prereqIds = point.publishedRevision!.prerequisites.map((p) => p.prerequisitePointId);
      if (prereqIds.length === 1 && prereqIds[0] === verbBe.id) branchOffVerbBe++;
    }
    expect(branchOffVerbBe).toBeGreaterThanOrEqual(2); // multiple points unlock at once
  });

  it('CUR-E2E-03 honest mastery: gates are recognition/controlled-production/reading-comprehension only (never free-production)', async () => {
    const ALLOWED = new Set(['recognition', 'controlled-production', 'reading-comprehension']);
    for (const spec of CURRICULUM_POINT_PLAN) {
      const point = await prisma.roadmapPoint.findUniqueOrThrow({ where: { pointKey: spec.pointKey }, include: { masteryRequirement: true } });
      const gate = await prisma.masteryRequirementSkillExpectation.findFirstOrThrow({ where: { requirementRevisionId: point.masteryRequirement!.currentRevisionId! } });
      const kinds = gate.requiredEvidenceKinds as string[];
      expect(kinds).not.toContain('free-production'); // objective items never claim free/independent production
      expect(kinds.every((k) => ALLOWED.has(k))).toBe(true);
      if ((spec.masteryEvidenceKinds ?? []).includes('reading-comprehension')) {
        // A READING point: reading-comprehension ONLY (a grammar-recognition activity cannot satisfy it), independence 1.
        expect(kinds).toEqual(['reading-comprehension']);
        expect(gate.minIndependence).toBe(1);
      } else if (spec.masteryMinIndependence === 2) {
        // A structured-production point: recognition can no longer satisfy it — controlled-production @ independence 2.
        expect(kinds).toEqual(['controlled-production']);
        expect(gate.minIndependence).toBe(2);
      } else {
        expect(kinds).toContain('recognition');
      }
    }
  });

  // ─────────────────────────── real learner journey ───────────────────────────

  const srv = () => app.getHttpServer();
  let learnerSeq = 0;
  const A = (r: request.Test, token: string) => r.set('Authorization', `Bearer ${token}`);
  const pointId = async (key: string) => (await prisma.roadmapPoint.findUniqueOrThrow({ where: { pointKey: key } })).id;

  /** Register + onboard + fresh-start placement → a learner who can reach Today/Roadmap for the A1 subject. */
  async function makeLearner(): Promise<{ token: string; userId: string }> {
    const phone = `+99890${String(7900000 + learnerSeq++).slice(-7)}`;
    const otp = await request(srv()).post('/api/auth/otp/request').send({ phone });
    const reg = await request(srv()).post('/api/auth/register').send({ challengeId: otp.body.challengeId, code: sms.latestCode(), password: 'LearnerPass!123' });
    const token = reg.body.accessToken as string;
    const user = await prisma.user.findUniqueOrThrow({ where: { phone } });
    await A(request(srv()).patch('/api/profile/me'), token).send({ displayName: 'QA', dateOfBirth: '2004-01-01', timezone: 'Asia/Tashkent' });
    const sid = await subjectId();
    const track = (await A(request(srv()).get(`/api/onboarding/subjects/${sid}/tracks`), token)).body[0];
    await A(request(srv()).put('/api/onboarding/learning-intent'), token).send({ subjectId: sid, trackId: track.id });
    await A(request(srv()).post('/api/onboarding/complete'), token).send({});
    await A(request(srv()).post(`/api/v2/placement/subjects/${sid}/from-zero`), token).send({ clientRequestId: randomUUID() });
    return { token, userId: user.id };
  }

  /** The correct answer for an objective activity (read from the server-side answerKey — never exposed to the client). */
  async function correctAnswer(activityId: string): Promise<Record<string, unknown>> {
    const a = await prisma.activity.findUniqueOrThrow({ where: { id: activityId }, select: { payload: true } });
    const payload = a.payload as { format?: string; answerKey?: { correctOptionIds?: string[]; correctOrder?: string[] }; blanks?: Record<string, { accepted: string[] }> };
    // Structured production formats carry their own answer shapes (the PREP-PLACE dogfood is taught this way).
    if (payload.format === 'sentence_order') return { orderedTokenIds: payload.answerKey!.correctOrder };
    if (payload.format === 'fill_blank') {
      const blanks: Record<string, string> = {};
      for (const id of Object.keys(payload.blanks!)) blanks[id] = payload.blanks![id].accepted[0];
      return { blanks };
    }
    const ids = payload.answerKey?.correctOptionIds ?? [];
    return payload.format === 'multiple_choice' ? { selectedOptionIds: ids } : { selectedOptionId: ids[0] };
  }

  /** Learn a point through the REAL teaching flow: answer every objective activity correctly, then mastery-check → LEARNED. */
  async function learnPoint(token: string, key: string): Promise<void> {
    const pid = await pointId(key);
    const start = await A(request(srv()).post(`/api/v2/roadmap-points/${pid}/teaching-session/start`), token);
    expect(start.status).toBe(200);
    const sessionId = start.body.id as string;
    const stages = start.body.stages as { activities: { id: string; kind: string }[] }[];
    for (const stage of stages) {
      for (const act of stage.activities) {
        if (act.kind !== 'OBJECTIVE') continue;
        await A(request(srv()).post(`/api/v2/teaching-sessions/${sessionId}/activities/${act.id}/attempts`), token).send({ clientRequestId: randomUUID(), answer: await correctAnswer(act.id) });
      }
    }
    const check = await A(request(srv()).post(`/api/v2/teaching-sessions/${sessionId}/mastery-check`), token);
    expect(check.body.learned).toBe(true);
  }

  const roadmap = async (token: string) => (await A(request(srv()).get(`/api/v2/roadmap/subjects/${await subjectId()}`), token)).body;
  const genToday = (token: string) => A(request(srv()).post('/api/v2/daily/me/today'), token);
  const getToday = (token: string) => A(request(srv()).get('/api/v2/daily/me/today'), token);

  it('CUR-E2E-04 fresh-start placement does NOT silently validate the new authored points (they stay learnable, not VALIDATED)', async () => {
    const { token } = await makeLearner();
    const rm = await roadmap(token);
    const points: { pointKey: string; acquisition: string | null; validated: boolean }[] = rm.points;
    for (const spec of CURRICULUM_POINT_PLAN) {
      const p = points.find((x) => x.pointKey === spec.pointKey);
      expect(p).toBeDefined();
      expect(p!.acquisition).toBeNull(); // never VALIDATED by adjacent grammar
      expect(p!.validated).toBe(false);
    }
    expect(JSON.stringify(rm)).not.toMatch(/answerKey|correctOptionIds/);
  });

  it('CUR-E2E-05 after learning "to be", MULTIPLE new points become available; daily plans exactly ONE per local day', async () => {
    const { token, userId } = await makeLearner();
    await learnPoint(token, 'ENG-A1-GREETINGS-INTRO');
    await learnPoint(token, 'ENG-A1-VERB-BE');

    // Branch unlocked: ≥2 unlearned AVAILABLE points (real multi-point availability, not a synthetic graph).
    const rm = await roadmap(token);
    const availableUnlearned = (rm.points as { availability: string; learned: boolean; validated: boolean; pointKey: string }[]).filter((p) => p.availability === 'AVAILABLE' && !p.learned && !p.validated);
    expect(availableUnlearned.length).toBeGreaterThanOrEqual(2);
    expect(availableUnlearned.map((p) => p.pointKey)).toEqual(expect.arrayContaining(['ENG-A1-ARTICLES']));

    // Daily picks exactly ONE main new point; a same-day repeat is idempotent (generationNo stays 1).
    const day1 = await genToday(token);
    expect(day1.body.action.type).toBe('LEARN');
    const mainKey = day1.body.mainGoal.pointKey as string;
    expect((await genToday(token)).body.generationNo).toBe(1);
    expect((await prisma.dailyLearningPlan.count({ where: { userId, status: 'CURRENT' } }))).toBe(1);

    // Finish the main point → SAME local day stays DONE for new curriculum (one-new-point-per-day; no next point unlocks today).
    await learnPoint(token, mainKey);
    const after = await getToday(token);
    expect(after.body.progress.mainGoalDone).toBe(true);
    expect(after.body.action.type).toBe('DONE');
    expect(after.body.done).toBe(true);

    // Next local day → a NEW plan selects a DIFFERENT next point.
    clock.current = new Date('2026-09-02T06:00:00.000Z');
    const day2 = await genToday(token);
    expect(day2.body.localDate).toBe('2026-09-02');
    expect(day2.body.action.type).toBe('LEARN');
    expect(day2.body.mainGoal.pointKey).not.toBe(mainKey);
    clock.current = new Date('2026-09-01T06:00:00.000Z');
  });

  it('CUR-E2E-06 a learner can enter a Content-Studio-authored point (Articles) and LEARN it — LEARNED acquisition persists', async () => {
    const { token, userId } = await makeLearner();
    await learnPoint(token, 'ENG-A1-GREETINGS-INTRO');
    await learnPoint(token, 'ENG-A1-VERB-BE');
    await learnPoint(token, 'ENG-A1-ARTICLES'); // a NEW point, not an old pilot point

    const articles = await pointId('ENG-A1-ARTICLES');
    const learned = await prisma.pointAcquisitionEvent.findMany({ where: { userId, roadmapPointId: articles, acquisitionType: 'LEARNED' } });
    expect(learned.length).toBe(1); // durable LEARNED acquisition
    const rm = await roadmap(token);
    const p = (rm.points as { pointKey: string; learned: boolean; acquisition: string }[]).find((x) => x.pointKey === 'ENG-A1-ARTICLES')!;
    expect(p.learned).toBe(true);
    expect(p.acquisition).toBe('LEARNED');
  });

  it('CUR-E2E-08 a wave-2 STRUCTURED point (Demonstratives) is learned via structured production → honest controlled-production@2 evidence', async () => {
    const { token, userId } = await makeLearner();
    await learnPoint(token, 'ENG-A1-GREETINGS-INTRO');
    await learnPoint(token, 'ENG-A1-VERB-BE');
    await learnPoint(token, 'ENG-A1-DEMONSTRATIVES'); // controlled-production@2; learnPoint answers structured items

    const demo = await pointId('ENG-A1-DEMONSTRATIVES');
    const learned = await prisma.pointAcquisitionEvent.findMany({ where: { userId, roadmapPointId: demo, acquisitionType: 'LEARNED' } });
    expect(learned.length).toBe(1); // recognition-only could NOT have satisfied this gate

    // The evidence recorded is honest structured production — controlled-production at independence 2.
    const sid = await subjectId();
    const skill = await prisma.skill.findUniqueOrThrow({ where: { subjectId_code: { subjectId: sid, code: 'ENG-A1-DEMONSTRATIVES' } } });
    const measurement = await prisma.skillMeasurement.findFirstOrThrow({ where: { userId, skillId: skill.id, source: 'TEACHING_MASTERY' }, orderBy: { createdAt: 'desc' } });
    expect(measurement.evidenceKind).toBe('controlled-production');
    expect(measurement.independenceLevel).toBe(2);
  });

  it('CUR-E2E-09 a wave-3 READING point (Jobs) is learned via reading activities → honest reading-comprehension@1 evidence (distinct from grammar recognition)', async () => {
    const { token, userId } = await makeLearner();
    await learnPoint(token, 'ENG-A1-GREETINGS-INTRO');
    await learnPoint(token, 'ENG-A1-VERB-BE');
    await learnPoint(token, 'ENG-A1-JOBS'); // reading-comprehension@1; a grammar-recognition activity could NOT satisfy this gate

    const jobs = await pointId('ENG-A1-JOBS');
    const learned = await prisma.pointAcquisitionEvent.findMany({ where: { userId, roadmapPointId: jobs, acquisitionType: 'LEARNED' } });
    expect(learned.length).toBe(1);

    const sid = await subjectId();
    const skill = await prisma.skill.findUniqueOrThrow({ where: { subjectId_code: { subjectId: sid, code: 'ENG-A1-JOBS-VOCAB' } } });
    // Full lineage: reading ActivityAttempt → SkillMeasurementEvidenceRef → SkillMeasurement (reading-comprehension) → MasteryEvaluation.
    const measurement = await prisma.skillMeasurement.findFirstOrThrow({ where: { userId, skillId: skill.id, source: 'TEACHING_MASTERY' }, orderBy: { createdAt: 'desc' } });
    expect(measurement.evidenceKind).toBe('reading-comprehension'); // NOT 'recognition' — reading is semantically distinct
    expect(measurement.independenceLevel).toBe(1);
    const refs = await prisma.skillMeasurementEvidenceRef.count({ where: { skillMeasurementId: measurement.id } });
    expect(refs).toBeGreaterThanOrEqual(1);
  });

  it('CUR-E2E-10 INTEGRITY: no A1 point (pilot OR expansion) claims free-production in its mastery gate or level-expectation; every gate is satisfiable-non-empty', async () => {
    const sid = await subjectId();
    const PILOT_KEYS = ['ENG-A1-GREETINGS-INTRO', 'ENG-A1-VERB-BE', 'ENG-A1-PERSONAL-INFO', 'ENG-A1-FAMILY-POSSESSION', 'ENG-A1-PRESENT-SIMPLE'];
    const allKeys = [...PILOT_KEYS, ...CURRICULUM_POINT_PLAN.map((p) => p.pointKey)];
    expect(allKeys.length).toBe(21); // 5 pilot + 16 expansion
    for (const key of allKeys) {
      const point = await prisma.roadmapPoint.findUniqueOrThrow({ where: { pointKey: key }, include: { masteryRequirement: true } });
      const gates = await prisma.masteryRequirementSkillExpectation.findMany({ where: { requirementRevisionId: point.masteryRequirement!.currentRevisionId! } });
      expect(gates.length).toBeGreaterThanOrEqual(1);
      for (const g of gates) {
        const kinds = (g.requiredEvidenceKinds ?? []) as string[];
        expect(kinds).not.toContain('free-production'); // integrity: nothing the runtime cannot produce
        expect(kinds.length).toBeGreaterThanOrEqual(1); // satisfiable (non-empty kind set)
      }
    }
    // The level-expectation STANDARD axis is also honest (the axis the old ensureExpectation over-claimed).
    const slers = await prisma.skillLevelExpectationRevision.findMany({
      where: { expectation: { skill: { subjectId: sid } } },
      select: { requiredEvidenceKinds: true },
    });
    expect(slers.length).toBeGreaterThanOrEqual(1);
    for (const s of slers) expect(((s.requiredEvidenceKinds ?? []) as string[])).not.toContain('free-production');
  });

  it('CUR-E2E-07 review/repair adaptation is generic: a REPEATED_MISTAKE signal on Articles drives REPAIR (repair > new learning)', async () => {
    const { token, userId } = await makeLearner();
    await learnPoint(token, 'ENG-A1-GREETINGS-INTRO');
    await learnPoint(token, 'ENG-A1-VERB-BE');
    await learnPoint(token, 'ENG-A1-ARTICLES');

    // Seed a REAL active repair signal on the Articles skill (the fact); attention is derived at read time.
    const sid = await subjectId();
    const skill = await prisma.skill.findUniqueOrThrow({ where: { subjectId_code: { subjectId: sid, code: 'ENG-A1-ARTICLES' } } });
    await prisma.learnerSignal.create({ data: { userId, subjectId: sid, skillId: skill.id, type: 'REPEATED_MISTAKE', status: 'ACTIVE' } });

    // The generic roadmap projection shows REPAIR on a NON-Present-Simple point, in learner language.
    const rm = await roadmap(token);
    const articles = (rm.points as { pointKey: string; attention: string; attentionReason: string }[]).find((p) => p.pointKey === 'ENG-A1-ARTICLES')!;
    expect(articles.attention).toBe('REPAIR_REQUIRED');
    expect(articles.attentionReason).toBe('REPEATED_MISTAKE');

    // And the daily action prioritizes REPAIR over new learning.
    const today = await genToday(token);
    expect(today.body.action.type).toBe('REPAIR');
    expect(today.body.action.point.pointKey).toBe('ENG-A1-ARTICLES');
    expect(userId).toBeTruthy();
  });
});
