import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { ActivityAttemptStatus, ActivityType, ContainerStatus, ContentSource, LessonStatus, RevisionStatus, SkillMeasurementSource } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createFastifyAdapter } from '../src/bootstrap/http-adapter';
import { PrismaService } from '../src/database/prisma.service';
import { AuthorizationRepository } from '../src/authorization/authorization.repository';
import { AuthExceptionFilter } from '../src/auth/http/auth-exception.filter';
import { SMS_PORT } from '../src/sms/sms.port';
import { bootstrapSystemRoles } from '../src/bootstrap/system-roles';
import { cleanupAuthTables } from './test-db.helper';
import { TestSmsAdapter } from './test-sms.adapter';

/**
 * V2 Content Authoring & Quality (e2e, izlan_test). Proves the real content factory: an assigned Methodist authors
 * and publishes the "To be: am/is/are" A1 point through the AUTHORING API (no provisioner), a learner then receives
 * it via a NEW roadmap generation and can enter the existing Teaching flow — with RBAC, immutable revisions, the
 * pedagogical publish gate, relational provenance, and the evidence-integrity workflow all enforced.
 */
describe('V2 Content Authoring & Quality — content factory (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let authz: AuthorizationRepository;
  const sms = new TestSmsAdapter();
  let seq = 0;
  const phone = () => `+99890${String(6400000 + seq++).slice(-7)}`;

  const OBJ_V = 'lesson-activity-objective/v1';
  const MD_V = 'lesson-activity-markdown/v1';
  const md = (markdown: string) => ({ schemaVersion: MD_V, markdown });
  const sc = (prompt: string) => ({ schemaVersion: OBJ_V, format: 'single_choice', prompt, options: [{ id: 'a', text: 'Correct' }, { id: 'b', text: 'Wrong' }], answerKey: { correctOptionIds: ['a'] } });

  const BE = ['ENG-A1-BE-AFFIRMATIVE', 'ENG-A1-BE-NEGATIVE', 'ENG-A1-BE-QUESTIONS'];
  const BE_LESSONS = ['ENG-A1-003-BE-AFFIRMATIVE', 'ENG-A1-004-BE-NEGATIVE', 'ENG-A1-005-BE-QUESTIONS'];

  let subjectId = '';
  let levelId = '';
  // per-skill activity ids: teach (VIEW_ONLY) + mastery (evidence)
  const skillIdByCode = new Map<string, string>();
  const teachActByCode = new Map<string, string>();
  const masteryActByCode = new Map<string, string>();

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
    await seedBaseContent();
  }, 120_000);

  afterAll(async () => {
    await reset();
    await app.close();
  });

  beforeEach(async () => {
    await clearVolatile(); // per-test isolation of the point graph + learners (base content is kept)
  });

  const srv = () => app.getHttpServer();
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** Volatile layers cleared BETWEEN tests (keeps base content): quality/integrity, learner facts, point graph. */
  async function clearVolatile() {
    await prisma.evidenceIntegrityScope.deleteMany();
    await prisma.evidenceIntegrityDecision.deleteMany();
    await prisma.contentSourceProvenance.deleteMany();
    await prisma.contentReview.deleteMany();
    await prisma.contentQualityIssue.deleteMany();
    await prisma.sourceReference.deleteMany();
    await prisma.contentQualityPolicyVersion.deleteMany();
    await prisma.pointAcquisitionValidationRef.deleteMany();
    await prisma.pointAcquisitionEvent.deleteMany();
    await prisma.masteryEvaluationEvidence.deleteMany();
    await prisma.skillMeasurementEvidenceRef.deleteMany();
    await prisma.masteryEvaluation.deleteMany();
    await prisma.skillMeasurement.deleteMany();
    await prisma.roadmapPointProjection.deleteMany();
    await prisma.learnerRoadmapGeneration.deleteMany();
    await prisma.teachingSessionContentPin.deleteMany();
    await prisma.xpGrant.deleteMany();
    await prisma.rewardGrant.deleteMany();
    await prisma.dailyMissionCompletionEvidence.deleteMany();
    await prisma.dailyMissionCompletion.deleteMany();
    await prisma.activityAttempt.deleteMany();
    await prisma.teachingSession.deleteMany();
    await prisma.learnerSkillState.deleteMany();
    await prisma.learnerSignal.deleteMany();
    await prisma.learnerLearningIntent.deleteMany();
    await prisma.placementDecisionValidation.deleteMany();
    await prisma.placementDecision.deleteMany();
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
  }

  async function reset() {
    await clearVolatile();
    await prisma.skill.updateMany({ data: { primaryDomainId: null } });
    await prisma.subjectDomain.deleteMany();
    // Base content
    skillIdByCode.clear(); teachActByCode.clear(); masteryActByCode.clear();
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
    await prisma.staffAudit.deleteMany();
    await cleanupAuthTables(prisma);
    await bootstrapSystemRoles(authz);
  }

  /** Base A1 content for "to be" — PUBLISHED subject/hierarchy + 3 skills + 3 lessons (teach + mastery activities). */
  async function seedBaseContent() {
    const author = await prisma.user.create({ data: { phone: phone() } });
    const subject = await prisma.subject.create({ data: { slug: 'english-a1-dev', title: 'English — Beginner (A1)', status: ContainerStatus.PUBLISHED, createdBy: author.id } });
    const track = await prisma.track.create({ data: { subjectId: subject.id, slug: 'general-a1-dev', title: 'General English A1', status: ContainerStatus.PUBLISHED, sortOrder: 1, createdBy: author.id } });
    const level = await prisma.level.create({ data: { trackId: track.id, code: 'A1', title: 'A1', status: ContainerStatus.PUBLISHED, sortOrder: 1, createdBy: author.id } });
    const moduleRow = await prisma.module.create({ data: { levelId: level.id, title: 'A1 Foundations', status: ContainerStatus.PUBLISHED, sortOrder: 1, createdBy: author.id } });
    const topic = await prisma.topic.create({ data: { moduleId: moduleRow.id, title: 'To be', status: ContainerStatus.PUBLISHED, sortOrder: 1, createdBy: author.id } });
    subjectId = subject.id;
    levelId = level.id;

    for (let i = 0; i < 3; i++) {
      const code = BE[i];
      const skill = await prisma.skill.create({ data: { subjectId: subject.id, code, name: code.replace('ENG-A1-', ''), sortOrder: i + 1 } });
      skillIdByCode.set(code, skill.id);
      const lesson = await prisma.lesson.create({ data: { topicId: topic.id, contentKey: BE_LESSONS[i], slug: BE_LESSONS[i].toLowerCase(), sortOrder: i + 1, status: LessonStatus.PUBLISHED, createdBy: author.id } });
      const rev = await prisma.lessonRevision.create({ data: { lessonId: lesson.id, version: 1, title: BE_LESSONS[i], status: RevisionStatus.PUBLISHED, createdBy: author.id, publishedBy: author.id, publishedAt: new Date() } });
      await prisma.lesson.update({ where: { id: lesson.id }, data: { publishedRevisionId: rev.id } });
      await prisma.lessonSkill.create({ data: { lessonId: lesson.id, skillId: skill.id } });
      const teach = await prisma.activity.create({ data: { lessonRevisionId: rev.id, type: ActivityType.EXPLANATION, position: 0, source: ContentSource.HUMAN, payload: md('## To be\n\nam / is / are.') } });
      const mastery = await prisma.activity.create({ data: { lessonRevisionId: rev.id, type: ActivityType.MASTERY_TEST, position: 1, source: ContentSource.HUMAN, payload: sc('Choose the correct form') } });
      await prisma.activitySkill.create({ data: { activityId: mastery.id, skillId: skill.id } });
      teachActByCode.set(code, teach.id);
      masteryActByCode.set(code, mastery.id);
    }
  }

  async function makeUser(): Promise<{ token: string; userId: string }> {
    const ph = phone();
    const r = await request(srv()).post('/api/auth/otp/request').send({ phone: ph });
    const reg = await request(srv()).post('/api/auth/register').send({ challengeId: r.body.challengeId, code: sms.latestCode(), password: 'Passw0rd!123' });
    const user = await prisma.user.findUnique({ where: { phone: ph } });
    await prisma.userProfile.update({ where: { userId: user!.id }, data: { onboardingCompletedAt: new Date(), timezone: 'Asia/Tashkent' } });
    return { token: reg.body.accessToken as string, userId: user!.id };
  }

  async function grantPerms(userId: string, perms: string[], code: string) {
    const role = await prisma.role.upsert({ where: { code }, update: {}, create: { code, name: code } });
    await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionCode: p })), skipDuplicates: true });
    await prisma.userRole.create({ data: { userId, roleId: role.id, grantedBy: null } });
  }

  /** A Methodist assigned to the subject with author + publish. */
  async function makeMethodist(subject: string): Promise<{ token: string; userId: string }> {
    const u = await makeUser();
    await grantPerms(u.userId, ['content.author', 'content.publish'], 'METHODIST_TEST');
    await prisma.subjectAssignment.create({ data: { userId: u.userId, subjectId: subject, assignedBy: u.userId } });
    return u;
  }

  // Author the full VERB-BE point up to REVIEW-ready via the API. Returns the detail body.
  async function authorToBePoint(token: string, pointKey: string) {
    const created = await request(srv()).post(`/api/staff/content/v2/levels/${levelId}/points`).set(auth(token)).send({ pointKey, title: 'To be: am / is / are', canDo: ['am/is/are tasdiq, inkor, savol'], sortOrderDefault: 20, estimatedEffortMin: 20 });
    expect(created.status).toBe(200);
    const pointId = created.body.point.id as string;
    const detail0 = created.body;
    // skills
    const r1 = await request(srv()).put(`/api/staff/content/v2/point-revisions/${detail0.revision.id}/skills`).set(auth(token)).send({ expectedUpdatedAt: detail0.revision.updatedAt, skills: BE.map((c) => ({ skillId: skillIdByCode.get(c), role: 'REQUIRED' })) });
    if (r1.status !== 200) throw new Error("skills: " + JSON.stringify(r1.body));
    let d = r1.body;
    // blueprint stages: a concept stage (teach) + a mastery stage (evidence)
    const r2 = await request(srv()).put(`/api/staff/content/v2/blueprint-revisions/${d.blueprint.revision.id}/stages`).set(auth(token)).send({
      expectedUpdatedAt: d.blueprint.revision.updatedAt,
      stages: [
        { stageType: 'concept', title: 'Concept', bindings: BE.map((c) => ({ activityId: teachActByCode.get(c), role: 'TEACH' })) },
        { stageType: 'mastery', title: 'Mastery check', bindings: BE.map((c) => ({ activityId: masteryActByCode.get(c), role: 'EVIDENCE' })) },
      ],
    });
    if (r2.status !== 200) throw new Error("stages: " + JSON.stringify(r2.body));
    d = r2.body;
    // mastery gates
    const r3 = await request(srv()).put(`/api/staff/content/v2/mastery-revisions/${d.mastery.revision.id}`).set(auth(token)).send({
      expectedUpdatedAt: d.mastery.revision.updatedAt,
      gates: { thresholdBp: 8000, minIndependence: 1, requireAllRequiredSkills: true },
      skillGates: BE.map((c) => ({ skillId: skillIdByCode.get(c), role: 'REQUIRED', requiredEvidenceKinds: ['recognition'], minIndependence: 1 })), // choice EVIDENCE → recognition@1 (honest; free-production is not producible by choice)
    });
    if (r3.status !== 200) throw new Error("mastery: " + JSON.stringify(r3.body));
    d = r3.body;
    return { pointId, detail: d };
  }

  // ─────────────────────────────────────────────────────────────

  it('CF-01: an assigned Methodist authors a point draft; an unassigned one is 404 (subject isolation)', async () => {
    const methodist = await makeMethodist(subjectId);
    const { pointId, detail } = await authorToBePoint(methodist.token, 'ENG-A1-VERB-BE');
    expect(detail.point.status).toBe('DRAFT');
    expect(detail.skills.length).toBe(3);
    expect(detail.blueprint.revision.stages.length).toBe(2);
    expect(detail.mastery.revision.skillGates.length).toBe(3);

    // Unassigned methodist (author perm, other subject) cannot author here → 404 (IDOR-safe).
    const other = await makeUser();
    await grantPerms(other.userId, ['content.author', 'content.publish'], 'METHODIST_OTHER');
    const foreign = await request(srv()).post(`/api/staff/content/v2/levels/${levelId}/points`).set(auth(other.token)).send({ pointKey: 'X-INTRUDER', title: 'x', canDo: ['x'], sortOrderDefault: 1 });
    expect(foreign.status).toBe(404);
    const foreignGet = await request(srv()).get(`/api/staff/content/v2/points/${pointId}`).set(auth(other.token));
    expect(foreignGet.status).toBe(404);
  });

  it('CF-02: drafts are invisible to learners (server-enforced), and publish is BLOCKED without an approved review', async () => {
    const methodist = await makeMethodist(subjectId);
    const { pointId, detail } = await authorToBePoint(methodist.token, 'ENG-A1-VERB-BE');

    // A learner does not see the DRAFT point.
    const learner = await makeUser();
    const roadmap0 = await request(srv()).get(`/api/v2/roadmap/subjects/${subjectId}`).set(auth(learner.token));
    expect((roadmap0.body.points ?? []).find((p: { pointKey: string }) => p.pointKey === 'ENG-A1-VERB-BE')).toBeUndefined();

    // submit-review passes structural readiness; publish is blocked because the policy requires an APPROVED review.
    const submitted = await request(srv()).post(`/api/staff/content/v2/point-revisions/${detail.revision.id}/submit-review`).set(auth(methodist.token)).send({ expectedUpdatedAt: detail.revision.updatedAt });
    expect(submitted.status).toBe(200);
    expect(submitted.body.revision.status).toBe('REVIEW');
    const readiness = await request(srv()).get(`/api/staff/content/v2/points/${pointId}/readiness`).set(auth(methodist.token));
    expect(readiness.body.blockers.map((b: { code: string }) => b.code)).toContain('REVIEW_REQUIRED');
    const blockedPublish = await request(srv()).post(`/api/staff/content/v2/point-revisions/${detail.revision.id}/publish`).set(auth(methodist.token)).send({ expectedUpdatedAt: submitted.body.revision.updatedAt });
    expect(blockedPublish.status).toBe(409); // not publish-ready
  });

  it('CF-03: a BLOCKER quality issue prevents publish until resolved; then the approved point publishes', async () => {
    const methodist = await makeMethodist(subjectId);
    const { pointId, detail } = await authorToBePoint(methodist.token, 'ENG-A1-VERB-BE');
    // provenance capability: attach a source (relational, retained)
    const src = await request(srv()).post('/api/staff/content/v2/sources').set(auth(methodist.token)).send({ title: 'Cambridge Grammar of English', kind: 'reference-grammar', locator: 'ISBN:9780521588461' });
    await request(srv()).post(`/api/staff/content/v2/point-revisions/${detail.revision.id}/sources`).set(auth(methodist.token)).send({ sourceReferenceId: src.body.id, claimRole: 'rule-basis' });

    // Raise a BLOCKER issue on the point revision → readiness must block publish.
    const issue = await request(srv()).post('/api/staff/content/v2/issues').set(auth(methodist.token)).send({ severityCode: 'BLOCKER', summary: 'Explanation contradicts to-be usage', roadmapPointRevisionId: detail.revision.id });
    const submit = await request(srv()).post(`/api/staff/content/v2/point-revisions/${detail.revision.id}/submit-review`).set(auth(methodist.token)).send({ expectedUpdatedAt: detail.revision.updatedAt });
    // reviewer approves...
    const reviewed = await request(srv()).post(`/api/staff/content/v2/point-revisions/${detail.revision.id}/review`).set(auth(methodist.token)).send({ expectedUpdatedAt: submit.body.revision.updatedAt, outcome: 'APPROVED' });
    const r1 = await request(srv()).get(`/api/staff/content/v2/points/${pointId}/readiness`).set(auth(methodist.token));
    expect(r1.body.blockers.map((b: { code: string }) => b.code)).toContain('QUALITY_ISSUE_OPEN');

    // resolve the issue → provenance retained → publish succeeds
    await request(srv()).post(`/api/staff/content/v2/issues/${issue.body.id}/resolve`).set(auth(methodist.token)).send({ status: 'RESOLVED' });
    const r2 = await request(srv()).get(`/api/staff/content/v2/points/${pointId}/readiness`).set(auth(methodist.token));
    expect(r2.body.publishReady).toBe(true);
    const published = await request(srv()).post(`/api/staff/content/v2/point-revisions/${reviewed.body.revision.id}/publish`).set(auth(methodist.token)).send({ expectedUpdatedAt: reviewed.body.revision.updatedAt });
    expect(published.status).toBe(200);
    expect(published.body.point.status).toBe('PUBLISHED');
    expect(JSON.stringify(published.body)).not.toContain('answerKey');

    // Provenance is relational + retained after publish.
    const prov = await prisma.contentSourceProvenance.findMany({ where: { roadmapPointRevisionId: detail.revision.id } });
    expect(prov.length).toBe(1);
    // Mastery + blueprint survive publish, pinned by the point's published revision.
    const point = await prisma.roadmapPoint.findUniqueOrThrow({ where: { id: pointId }, select: { publishedRevisionId: true, teachingBlueprint: { select: { publishedRevisionId: true } }, masteryRequirement: { select: { currentRevisionId: true } } } });
    expect(point.publishedRevisionId).toBe(reviewed.body.revision.id);
    expect(point.teachingBlueprint?.publishedRevisionId).toBeTruthy();
    expect(point.masteryRequirement?.currentRevisionId).toBeTruthy();
    const bindings = await prisma.teachingBlueprintContentBinding.count({ where: { stage: { blueprintRevisionId: point.teachingBlueprint!.publishedRevisionId! }, role: 'EVIDENCE' } });
    expect(bindings).toBe(3);
    const gates = await prisma.masteryRequirementSkillExpectation.count({ where: { requirementRevisionId: point.masteryRequirement!.currentRevisionId! } });
    expect(gates).toBe(3);
  });

  it('CF-04: published point enters a NEW learner generation without rewriting history; learner can teach it', async () => {
    const methodist = await makeMethodist(subjectId);
    const learner = await makeUser();
    // Learner has a roadmap generation BEFORE the point is published (empty published set → no generation, or seeded later).
    // Publish another point first so the learner has a generation, then publish VERB-BE and confirm regeneration.
    const first = await publishSimplePoint(methodist.token, 'ENG-A1-GREETINGS');
    const gen1 = (await request(srv()).get(`/api/v2/roadmap/subjects/${subjectId}`).set(auth(learner.token))).body.generation;
    expect(gen1).not.toBeNull();
    const genId1 = gen1.id;

    // Now author + publish VERB-BE.
    const be = await authorToBePoint(methodist.token, 'ENG-A1-VERB-BE');
    await approveAndPublish(methodist.token, be.detail.revision.id, be.detail.revision.updatedAt);

    // Learner reads roadmap → regenerated: NEW generation, VERB-BE present, old generation preserved (SUPERSEDED).
    const roadmap = await request(srv()).get(`/api/v2/roadmap/subjects/${subjectId}`).set(auth(learner.token));
    expect(roadmap.body.generation.id).not.toBe(genId1);
    const bePoint = roadmap.body.points.find((p: { pointKey: string }) => p.pointKey === 'ENG-A1-VERB-BE');
    expect(bePoint).toBeDefined();
    const old = await prisma.learnerRoadmapGeneration.findUnique({ where: { id: genId1 }, select: { status: true } });
    expect(old!.status).toBe('SUPERSEDED');
    expect(roadmap.body.generation.generationNo).toBeGreaterThan(gen1.generationNo);

    // Learner can enter the newly published point in the existing V2 Teaching flow.
    const teach = await request(srv()).post(`/api/v2/roadmap-points/${bePoint.roadmapPointId}/teaching-session/start`).set(auth(learner.token));
    expect(teach.status).toBe(200);
    expect(teach.body.stages.length).toBeGreaterThanOrEqual(1);
  });

  it('CF-05: editing published content creates a NEW revision (published revision immutable)', async () => {
    const methodist = await makeMethodist(subjectId);
    const be = await authorToBePoint(methodist.token, 'ENG-A1-VERB-BE');
    await approveAndPublish(methodist.token, be.detail.revision.id, be.detail.revision.updatedAt);
    const publishedRevId = be.detail.revision.id;

    // Editing the published revision directly is refused (not a draft).
    const directEdit = await request(srv()).patch(`/api/staff/content/v2/point-revisions/${publishedRevId}`).set(auth(methodist.token)).send({ expectedUpdatedAt: new Date().toISOString(), title: 'hacked' });
    expect(directEdit.status).toBe(409);

    // "Revise" creates a NEW draft revision (versionNo+1); the published revision stays intact.
    const revised = await request(srv()).post(`/api/staff/content/v2/points/${be.pointId}/revise`).set(auth(methodist.token)).send({});
    expect(revised.status).toBe(200);
    expect(revised.body.revision.id).not.toBe(publishedRevId);
    expect(revised.body.revision.versionNo).toBe(2);
    expect(revised.body.revision.status).toBe('DRAFT');
    const oldRev = await prisma.roadmapPointRevision.findUniqueOrThrow({ where: { id: publishedRevId }, select: { status: true } });
    expect(oldRev.status).toBe('PUBLISHED'); // history immutable
  });

  it('CF-06: an integrity decision excludes defective evidence from CURRENT computation without deleting history', async () => {
    const methodist = await makeMethodist(subjectId);
    const learner = await makeUser();
    const skillId = skillIdByCode.get('ENG-A1-BE-AFFIRMATIVE')!;
    const goodAct = masteryActByCode.get('ENG-A1-BE-AFFIRMATIVE')!;
    const badAct = masteryActByCode.get('ENG-A1-BE-NEGATIVE')!; // a distinct real activity we'll mark defective
    const goodRev = (await prisma.activity.findUniqueOrThrow({ where: { id: goodAct }, select: { lessonRevisionId: true } })).lessonRevisionId;
    const badRev = (await prisma.activity.findUniqueOrThrow({ where: { id: badAct }, select: { lessonRevisionId: true } })).lessonRevisionId;

    // Seed two LESSON_MASTERY measurements for the SAME skill: one strong (good activity) + one weak (defective).
    const mkAttempt = (activityId: string, lessonRevisionId: string, correct: boolean) =>
      prisma.activityAttempt.create({ data: { userId: learner.userId, activityId, lessonRevisionId, attemptNo: 1, status: ActivityAttemptStatus.SUBMITTED, isCorrect: correct, deterministicScore: correct ? 10000 : 0, submittedAt: new Date(), startedAt: new Date() } });
    const goodAttempt = await mkAttempt(goodAct, goodRev, true);
    const badAttempt = await mkAttempt(badAct, badRev, false);
    const mkMeasure = async (score: number, refAttemptId: string, observedAt: Date) => {
      const m = await prisma.skillMeasurement.create({ data: { userId: learner.userId, skillId, source: SkillMeasurementSource.LESSON_MASTERY, scoreBp: score, confidenceBp: 10000, evidenceCount: 1, observedAt, derivationVersion: 'test-v1' } });
      await prisma.skillMeasurementEvidenceRef.create({ data: { skillMeasurementId: m.id, activityAttemptId: refAttemptId } });
      return m.id;
    };
    const goodMeasureId = await mkMeasure(10000, goodAttempt.id, new Date(Date.now() - 2000));
    const badMeasureId = await mkMeasure(0, badAttempt.id, new Date(Date.now() - 1000));

    // Record an INVALIDATED integrity decision scoped to the defective activity (governance: content.publish + scope).
    // Its recompute rebuilds the affected skill's current state from scratch, EXCLUDING the invalidated evidence.
    const decision = await request(srv()).post('/api/staff/content/v2/evidence-integrity/decisions').set(auth(methodist.token)).send({
      clientRequestId: randomUUID(),
      outcome: 'INVALIDATED',
      reasonCode: 'WRONG_ANSWER_KEY',
      scopes: [{ scopeKind: 'ACTIVITY', activityId: badAct }],
    });
    expect(decision.status).toBe(200);
    expect(decision.body.affectedRecomputed).toBeGreaterThanOrEqual(1);

    // Current competence recomputed EXCLUDING the invalidated evidence → reflects only the good measurement (high).
    const state = await prisma.learnerSkillState.findFirstOrThrow({ where: { userId: learner.userId, skillId } });
    expect(state.masteryScoreBp).toBe(10000); // only the admissible strong evidence remains in the current window

    // Historical facts are PRESERVED — nothing deleted.
    expect(await prisma.skillMeasurement.count({ where: { id: { in: [goodMeasureId, badMeasureId] } } })).toBe(2);
    expect(await prisma.activityAttempt.count({ where: { id: { in: [goodAttempt.id, badAttempt.id] } } })).toBe(2);
    // Idempotent re-record (same clientRequestId) → no duplicate decision.
    const crid = randomUUID();
    await request(srv()).post('/api/staff/content/v2/evidence-integrity/decisions').set(auth(methodist.token)).send({ clientRequestId: crid, outcome: 'INVALIDATED', reasonCode: 'WRONG_ANSWER_KEY', scopes: [{ scopeKind: 'ACTIVITY', activityId: badAct }] });
    await request(srv()).post('/api/staff/content/v2/evidence-integrity/decisions').set(auth(methodist.token)).send({ clientRequestId: crid, outcome: 'INVALIDATED', reasonCode: 'WRONG_ANSWER_KEY', scopes: [{ scopeKind: 'ACTIVITY', activityId: badAct }] });
    expect(await prisma.evidenceIntegrityDecision.count({ where: { clientRequestId: crid } })).toBe(1);
  });

  // Author + publish a minimal single-skill point (for regeneration setup).
  async function publishSimplePoint(token: string, pointKey: string) {
    const created = await request(srv()).post(`/api/staff/content/v2/levels/${levelId}/points`).set(auth(token)).send({ pointKey, title: pointKey, canDo: ['x'], sortOrderDefault: 10, estimatedEffortMin: 10 });
    const d0 = created.body;
    const code = BE[0];
    let d = (await request(srv()).put(`/api/staff/content/v2/point-revisions/${d0.revision.id}/skills`).set(auth(token)).send({ expectedUpdatedAt: d0.revision.updatedAt, skills: [{ skillId: skillIdByCode.get(code), role: 'REQUIRED' }] })).body;
    d = (await request(srv()).put(`/api/staff/content/v2/blueprint-revisions/${d.blueprint.revision.id}/stages`).set(auth(token)).send({ expectedUpdatedAt: d.blueprint.revision.updatedAt, stages: [{ stageType: 'mastery', title: 'Mastery', bindings: [{ activityId: masteryActByCode.get(code), role: 'EVIDENCE' }] }] })).body;
    d = (await request(srv()).put(`/api/staff/content/v2/mastery-revisions/${d.mastery.revision.id}`).set(auth(token)).send({ expectedUpdatedAt: d.mastery.revision.updatedAt, gates: { thresholdBp: 8000, minIndependence: 1, requireAllRequiredSkills: true }, skillGates: [{ skillId: skillIdByCode.get(code), role: 'REQUIRED', requiredEvidenceKinds: ['recognition'], minIndependence: 1 }] })).body; // choice EVIDENCE → recognition@1 (honest)
    await approveAndPublish(token, d.revision.id, d.revision.updatedAt);
    return d;
  }

  async function approveAndPublish(token: string, pointRevisionId: string, updatedAt: string) {
    const submit = await request(srv()).post(`/api/staff/content/v2/point-revisions/${pointRevisionId}/submit-review`).set(auth(token)).send({ expectedUpdatedAt: updatedAt });
    const reviewed = await request(srv()).post(`/api/staff/content/v2/point-revisions/${pointRevisionId}/review`).set(auth(token)).send({ expectedUpdatedAt: submit.body.revision.updatedAt, outcome: 'APPROVED' });
    const published = await request(srv()).post(`/api/staff/content/v2/point-revisions/${pointRevisionId}/publish`).set(auth(token)).send({ expectedUpdatedAt: reviewed.body.revision.updatedAt });
    expect(published.status).toBe(200);
    return published.body;
  }
});
