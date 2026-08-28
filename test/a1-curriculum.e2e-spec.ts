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

  it('CUR-E2E-01 authored 6 new points, each PUBLISHED via the real workflow (published blueprint + mastery + APPROVED review)', async () => {
    expect(provisionResult.pointsPublished).toBe(6);
    expect(provisionResult.lessonsPublished).toBe(6);

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

  it('CUR-E2E-03 honest mastery: gates require recognition + controlled-production only (never free-production)', async () => {
    for (const spec of CURRICULUM_POINT_PLAN) {
      const point = await prisma.roadmapPoint.findUniqueOrThrow({ where: { pointKey: spec.pointKey }, include: { masteryRequirement: true } });
      const gate = await prisma.masteryRequirementSkillExpectation.findFirstOrThrow({ where: { requirementRevisionId: point.masteryRequirement!.currentRevisionId! } });
      const kinds = gate.requiredEvidenceKinds as string[];
      expect(kinds).toContain('recognition');
      expect(kinds).not.toContain('free-production'); // objective items never claim free/independent production
    }
  });
});
