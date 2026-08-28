import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { ActivityType, ContainerStatus, ContentSource, LessonStatus, RevisionStatus, SkillMeasurementSource } from '@prisma/client';
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
 * Structured production (e2e, izlan_test). Proves A1 can go BEYOND multiple-choice with trustworthy evidence:
 * a Methodist authors a real point ("Present Simple word order") whose practice + mastery are STRUCTURED
 * (sentence_order / fill_blank) through the authoring API; the point requires controlled-production; a learner
 * performs the production in Teaching and earns controlled-production@2 evidence → LEARNED. Also proves a
 * recognition-only (choice) evidence activity CANNOT satisfy a controlled-production gate (readiness blocks it),
 * that malformed structured answers are rejected, and that no answer key / accepted set ever leaks.
 */
describe('Structured production — beyond multiple-choice (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let authz: AuthorizationRepository;
  const sms = new TestSmsAdapter();
  let seq = 0;
  const phone = () => `+99890${String(6800000 + seq++).slice(-7)}`;

  const STRUCT_V = 'lesson-activity-structured/v1';
  const OBJ_V = 'lesson-activity-objective/v1';
  const md = (markdown: string) => ({ schemaVersion: 'lesson-activity-markdown/v1', markdown });
  const sentenceOrder = (prompt: string, tokens: { id: string; text: string }[], order: string[]) => ({ schemaVersion: STRUCT_V, format: 'sentence_order', prompt, tokens, answerKey: { correctOrder: order } });
  const fillBlank = (prompt: string, before: string, blankId: string, after: string, accepted: string[]) => ({ schemaVersion: STRUCT_V, format: 'fill_blank', prompt, segments: [{ text: before }, { blankId }, { text: after }], blanks: { [blankId]: { accepted } }, normalization: { caseFold: true } });
  const choice = (prompt: string) => ({ schemaVersion: OBJ_V, format: 'single_choice', prompt, options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], answerKey: { correctOptionIds: ['a'] } });

  let subjectId = '';
  let levelId = '';
  let topicId = '';
  let skillId = '';

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
    await seedBase();
  }, 120_000);

  afterAll(async () => { await reset(); await app.close(); });

  const srv = () => app.getHttpServer();
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function reset() {
    await prisma.evidenceIntegrityScope.deleteMany();
    await prisma.evidenceIntegrityDecision.deleteMany();
    await prisma.contentSourceProvenance.deleteMany();
    await prisma.contentReview.deleteMany();
    await prisma.contentQualityIssue.deleteMany();
    await prisma.sourceReference.deleteMany();
    await prisma.contentQualityPolicyVersion.deleteMany();
    await prisma.pointAcquisitionEvent.deleteMany();
    await prisma.masteryEvaluationEvidence.deleteMany();
    await prisma.skillMeasurementEvidenceRef.deleteMany();
    await prisma.masteryEvaluation.deleteMany();
    await prisma.skillMeasurement.deleteMany();
    await prisma.roadmapPointProjection.deleteMany();
    await prisma.learnerRoadmapGeneration.deleteMany();
    await prisma.teachingSessionContentPin.deleteMany();
    await prisma.xpGrant.deleteMany();
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
    await prisma.staffAudit.deleteMany();
    await cleanupAuthTables(prisma);
    await bootstrapSystemRoles(authz);
  }

  /** Minimal PUBLISHED hierarchy + one skill (a topic for authoring a fresh lesson into). */
  async function seedBase() {
    const author = await prisma.user.create({ data: { phone: phone() } });
    const subject = await prisma.subject.create({ data: { slug: 'english-a1-dev', title: 'English — Beginner (A1)', status: ContainerStatus.PUBLISHED, createdBy: author.id } });
    const track = await prisma.track.create({ data: { subjectId: subject.id, slug: 'general-a1-dev', title: 'General English A1', status: ContainerStatus.PUBLISHED, sortOrder: 1, createdBy: author.id } });
    const level = await prisma.level.create({ data: { trackId: track.id, code: 'A1', title: 'A1', status: ContainerStatus.PUBLISHED, sortOrder: 1, createdBy: author.id } });
    const moduleRow = await prisma.module.create({ data: { levelId: level.id, title: 'A1 Foundations', status: ContainerStatus.PUBLISHED, sortOrder: 1, createdBy: author.id } });
    const topic = await prisma.topic.create({ data: { moduleId: moduleRow.id, title: 'Kundalik hayot', status: ContainerStatus.PUBLISHED, sortOrder: 1, createdBy: author.id } });
    const skill = await prisma.skill.create({ data: { subjectId: subject.id, code: 'ENG-A1-PS-WORD-ORDER', name: 'Present Simple word order', sortOrder: 1 } });
    subjectId = subject.id; levelId = level.id; topicId = topic.id; skillId = skill.id;
  }

  async function makeUser(): Promise<{ token: string; userId: string }> {
    const ph = phone();
    const r = await request(srv()).post('/api/auth/otp/request').send({ phone: ph });
    const reg = await request(srv()).post('/api/auth/register').send({ challengeId: r.body.challengeId, code: sms.latestCode(), password: 'Passw0rd!123' });
    const user = await prisma.user.findUniqueOrThrow({ where: { phone: ph } });
    await prisma.userProfile.update({ where: { userId: user.id }, data: { displayName: 'A', dateOfBirth: new Date('2004-01-01'), timezone: 'Asia/Tashkent', onboardingCompletedAt: new Date() } });
    return { token: reg.body.accessToken as string, userId: user.id };
  }

  async function makeMethodist(): Promise<string> {
    const u = await makeUser();
    const role = await prisma.role.upsert({ where: { code: 'METHODIST_TEST' }, update: {}, create: { code: 'METHODIST_TEST', name: 'METHODIST_TEST' } });
    await prisma.rolePermission.createMany({ data: ['content.author', 'content.publish'].map((p) => ({ roleId: role.id, permissionCode: p })), skipDuplicates: true });
    await prisma.userRole.create({ data: { userId: u.userId, roleId: role.id, grantedBy: null } });
    await prisma.subjectAssignment.create({ data: { userId: u.userId, subjectId, assignedBy: u.userId } });
    return u.token;
  }

  let runSeq = 0;
  /** Author + PUBLISH a lesson with structured activities via the real Content Studio API. Returns activity ids + keys. */
  async function authorStructuredLesson(token: string): Promise<{ practiceOrder: string; practiceBlank: string; masteryOrder: string; contentKey: string; suffix: number }> {
    const suffix = runSeq++;
    const contentKey = `ENG-A1-PS-WORD-ORDER-LSN-${suffix}`;
    await request(srv()).post(`/api/staff/content/topics/${topicId}/lessons`).set(auth(token)).send({ contentKey, slug: `ps-word-order-${suffix}`, sortOrder: suffix + 1 });
    const lessonRow = await prisma.lesson.findUniqueOrThrow({ where: { contentKey } });
    await request(srv()).post(`/api/staff/content/lessons/${lessonRow.id}/revisions`).set(auth(token)).send({ title: 'Present Simple word order' });
    const revRow = await prisma.lessonRevision.findFirstOrThrow({ where: { lessonId: lessonRow.id }, orderBy: { version: 'desc' } });
    const revId = revRow.id;
    let token2 = revRow.updatedAt.toISOString();
    const add = async (type: string, position: number, payload: object) => {
      const res = await request(srv()).post(`/api/staff/content/revisions/${revId}/activities`).set(auth(token)).send({ expectedRevisionUpdatedAt: token2, type, position, payload });
      if (res.status !== 201 && res.status !== 200) throw new Error(`add activity failed: ${JSON.stringify(res.body)}`);
      token2 = res.body.revisionUpdatedAt;
      return res.body.activity.id as string;
    };
    await add('EXPLANATION', 0, md('## Word order\n\nSubject + verb + rest.'));
    const practiceOrder = await add('PRACTICE', 1, sentenceOrder('Order the words.', [{ id: 't1', text: 'She' }, { id: 't2', text: 'works' }, { id: 't3', text: 'here' }], ['t1', 't2', 't3']));
    const practiceBlank = await add('PRACTICE', 2, fillBlank('Fill the blank.', 'He ', 'b1', ' every day.', ['works']));
    const masteryOrder = await add('MASTERY_TEST', 3, sentenceOrder('Build the sentence.', [{ id: 'm1', text: 'They' }, { id: 'm2', text: 'play' }, { id: 'm3', text: 'football' }], ['m1', 'm2', 'm3']));
    // map the skill onto every objective activity (recognition/production evidence).
    for (const id of [practiceOrder, practiceBlank, masteryOrder]) {
      const res = await request(srv()).post(`/api/staff/content/activities/${id}/skills`).set(auth(token)).send({ expectedRevisionUpdatedAt: token2, skillId });
      token2 = res.body.revisionUpdatedAt;
    }
    // submit-review → publish the lesson.
    await request(srv()).post(`/api/staff/content/revisions/${revId}/submit-review`).set(auth(token)).send({ expectedUpdatedAt: token2 });
    const revF = await prisma.lessonRevision.findUniqueOrThrow({ where: { id: revId } });
    const lessonF = await prisma.lesson.findUniqueOrThrow({ where: { id: lessonRow.id } });
    const pub = await request(srv()).post(`/api/staff/content/revisions/${revId}/publish`).set(auth(token)).send({ expectedRevisionUpdatedAt: revF.updatedAt.toISOString(), expectedLessonUpdatedAt: lessonF.updatedAt.toISOString() });
    if (pub.status !== 200 && pub.status !== 201) {
      const readiness = (await request(srv()).get(`/api/staff/content/revisions/${revId}/readiness`).set(auth(token))).body;
      throw new Error(`lesson publish ${pub.status}: ${JSON.stringify(pub.body)} readiness=${JSON.stringify(readiness)}`);
    }
    return { practiceOrder, practiceBlank, masteryOrder, contentKey, suffix };
  }

  /** Author a point whose mastery requires controlled-production, binding the structured activities. Returns detail. */
  async function authorStructuredPoint(token: string, pointKey: string, acts: { practiceOrder: string; practiceBlank: string; masteryOrder: string }, minIndependence: number, evidenceActivityId: string) {
    let d = (await request(srv()).post(`/api/staff/content/v2/levels/${levelId}/points`).set(auth(token)).send({ pointKey, title: 'Present Simple word order', canDo: ['So‘z tartibini to‘g‘ri qurish'], sortOrderDefault: 90, estimatedEffortMin: 15 })).body;
    d = (await request(srv()).put(`/api/staff/content/v2/point-revisions/${d.revision.id}/skills`).set(auth(token)).send({ expectedUpdatedAt: d.revision.updatedAt, skills: [{ skillId, role: 'REQUIRED' }] })).body;
    d = (await request(srv()).put(`/api/staff/content/v2/blueprint-revisions/${d.blueprint.revision.id}/stages`).set(auth(token)).send({
      expectedUpdatedAt: d.blueprint.revision.updatedAt,
      stages: [
        { stageType: 'production', title: 'Mashq', bindings: [{ activityId: acts.practiceOrder, role: 'PRACTICE' }, { activityId: acts.practiceBlank, role: 'PRACTICE' }] },
        { stageType: 'mastery', title: 'Yakuniy', bindings: [{ activityId: evidenceActivityId, role: 'EVIDENCE' }] },
      ],
    })).body;
    d = (await request(srv()).put(`/api/staff/content/v2/mastery-revisions/${d.mastery.revision.id}`).set(auth(token)).send({
      expectedUpdatedAt: d.mastery.revision.updatedAt,
      gates: { thresholdBp: 8000, minIndependence, requireAllRequiredSkills: true },
      skillGates: [{ skillId, role: 'REQUIRED', requiredEvidenceKinds: ['controlled-production'], minIndependence }],
    })).body;
    return d;
  }

  async function correctAnswer(activityId: string): Promise<Record<string, unknown>> {
    const a = await prisma.activity.findUniqueOrThrow({ where: { id: activityId }, select: { payload: true } });
    const p = a.payload as { format?: string; answerKey?: { correctOrder?: string[]; correctOptionIds?: string[] }; blanks?: Record<string, { accepted: string[] }>; segments?: unknown };
    if (p.format === 'sentence_order') return { orderedTokenIds: p.answerKey!.correctOrder };
    if (p.format === 'fill_blank') { const blanks: Record<string, string> = {}; for (const id of Object.keys(p.blanks!)) blanks[id] = p.blanks![id].accepted[0]; return { blanks }; }
    return { selectedOptionId: p.answerKey!.correctOptionIds![0] };
  }

  // ─────────────────────────────────────────────────────────────────────────

  it('SPX-01 a controlled-production point publishes ONLY with structured evidence; recognition (choice) is blocked', async () => {
    const token = await makeMethodist();
    const acts = await authorStructuredLesson(token);
    const pk = `ENG-A1-PS-WORD-ORDER-${acts.suffix}`;

    // A structured MASTERY_TEST as EVIDENCE + a minIndependence-2 gate → publishes (production evidence is producible).
    let d = await authorStructuredPoint(token, pk, acts, 2, acts.masteryOrder);
    await request(srv()).post(`/api/staff/content/v2/point-revisions/${d.revision.id}/submit-review`).set(auth(token)).send({ expectedUpdatedAt: d.revision.updatedAt });
    d = (await request(srv()).get(`/api/staff/content/v2/points/${d.point.id}`).set(auth(token))).body;
    await request(srv()).post(`/api/staff/content/v2/point-revisions/${d.revision.id}/review`).set(auth(token)).send({ expectedUpdatedAt: d.revision.updatedAt, outcome: 'APPROVED' });
    d = (await request(srv()).get(`/api/staff/content/v2/points/${d.point.id}`).set(auth(token))).body;
    const publish = await request(srv()).post(`/api/staff/content/v2/point-revisions/${d.revision.id}/publish`).set(auth(token)).send({ expectedUpdatedAt: d.revision.updatedAt });
    expect(publish.status).toBe(200);
    expect((await prisma.roadmapPoint.findUniqueOrThrow({ where: { pointKey: pk } })).status).toBe('PUBLISHED');

    // Now a CHOICE (recognition) evidence activity under the SAME controlled-production gate → readiness blocks it.
    const lessonRev = await prisma.lesson.findUniqueOrThrow({ where: { contentKey: acts.contentKey }, select: { publishedRevisionId: true } });
    const choiceAct = await prisma.activity.create({ data: { lessonRevisionId: lessonRev.publishedRevisionId!, type: ActivityType.MASTERY_TEST, position: 9, source: ContentSource.HUMAN, payload: choice('Recognition') } });
    await prisma.activitySkill.create({ data: { activityId: choiceAct.id, skillId } });
    const d2 = await authorStructuredPoint(token, `${pk}-CHOICE`, acts, 2, choiceAct.id);
    const readiness = (await request(srv()).get(`/api/staff/content/v2/points/${d2.point.id}/readiness`).set(auth(token))).body;
    expect(readiness.publishReady).toBe(false);
    expect((readiness.blockers as { code: string }[]).some((b) => b.code === 'MASTERY_EVIDENCE_KIND_UNSATISFIABLE')).toBe(true);
  });

  it('SPX-02 a learner performs structured production in Teaching → controlled-production@2 evidence → LEARNED', async () => {
    const token = await makeMethodist();
    const acts = await authorStructuredLesson(token);
    let d = await authorStructuredPoint(token, `ENG-A1-PS-WORD-ORDER-${acts.suffix}`, acts, 2, acts.masteryOrder);
    await request(srv()).post(`/api/staff/content/v2/point-revisions/${d.revision.id}/submit-review`).set(auth(token)).send({ expectedUpdatedAt: d.revision.updatedAt });
    d = (await request(srv()).get(`/api/staff/content/v2/points/${d.point.id}`).set(auth(token))).body;
    await request(srv()).post(`/api/staff/content/v2/point-revisions/${d.revision.id}/review`).set(auth(token)).send({ expectedUpdatedAt: d.revision.updatedAt, outcome: 'APPROVED' });
    d = (await request(srv()).get(`/api/staff/content/v2/points/${d.point.id}`).set(auth(token))).body;
    await request(srv()).post(`/api/staff/content/v2/point-revisions/${d.revision.id}/publish`).set(auth(token)).send({ expectedUpdatedAt: d.revision.updatedAt });
    const pointId = d.point.id as string;

    const learner = await makeUser();
    const L = (r: request.Test) => r.set(auth(learner.token));
    const start = await L(request(srv()).post(`/api/v2/roadmap-points/${pointId}/teaching-session/start`));
    expect(start.status).toBe(200);
    const sessionId = start.body.id as string;
    // The projected structured activities carry NO answer key / accepted set / correct order.
    expect(JSON.stringify(start.body)).not.toMatch(/answerKey|correctOrder|accepted|correctOptionIds/);

    // Perform every objective activity (structured production) correctly.
    for (const stage of start.body.stages as { activities: { id: string; kind: string }[] }[]) {
      for (const a of stage.activities) {
        if (a.kind !== 'OBJECTIVE') continue;
        const submit = await L(request(srv()).post(`/api/v2/teaching-sessions/${sessionId}/activities/${a.id}/attempts`)).send({ clientRequestId: randomUUID(), answer: await correctAnswer(a.id) });
        expect(submit.status).toBe(200);
        expect(submit.body.isCorrect).toBe(true);
      }
    }
    const check = await L(request(srv()).post(`/api/v2/teaching-sessions/${sessionId}/mastery-check`));
    expect(check.body.learned).toBe(true); // the controlled-production gate (minIndependence 2) was satisfied

    // The evidence is HONEST: controlled-production at independence 2 (not the old fabricated free-production).
    const measurement = await prisma.skillMeasurement.findFirstOrThrow({ where: { userId: learner.userId, skillId, source: SkillMeasurementSource.TEACHING_MASTERY } });
    expect(measurement.evidenceKind).toBe('controlled-production');
    expect(measurement.independenceLevel).toBe(2);
    // Evidence lineage intact: refs point at the real structured attempts.
    const refs = await prisma.skillMeasurementEvidenceRef.count({ where: { skillMeasurementId: measurement.id } });
    expect(refs).toBeGreaterThanOrEqual(1);
  });

  it('SPX-03 malformed structured answers are rejected (400) and never scored', async () => {
    const token = await makeMethodist();
    const acts = await authorStructuredLesson(token);
    let d = await authorStructuredPoint(token, `ENG-A1-PS-WORD-ORDER-${acts.suffix}`, acts, 2, acts.masteryOrder);
    await request(srv()).post(`/api/staff/content/v2/point-revisions/${d.revision.id}/submit-review`).set(auth(token)).send({ expectedUpdatedAt: d.revision.updatedAt });
    d = (await request(srv()).get(`/api/staff/content/v2/points/${d.point.id}`).set(auth(token))).body;
    await request(srv()).post(`/api/staff/content/v2/point-revisions/${d.revision.id}/review`).set(auth(token)).send({ expectedUpdatedAt: d.revision.updatedAt, outcome: 'APPROVED' });
    d = (await request(srv()).get(`/api/staff/content/v2/points/${d.point.id}`).set(auth(token))).body;
    await request(srv()).post(`/api/staff/content/v2/point-revisions/${d.revision.id}/publish`).set(auth(token)).send({ expectedUpdatedAt: d.revision.updatedAt });
    const pointId = d.point.id as string;

    const learner = await makeUser();
    const L = (r: request.Test) => r.set(auth(learner.token));
    const start = await L(request(srv()).post(`/api/v2/roadmap-points/${pointId}/teaching-session/start`));
    const orderAct = (start.body.stages as { activities: { id: string; kind: string; format?: string }[] }[]).flatMap((s) => s.activities).find((a) => a.format === 'sentence_order')!;
    // A malformed sentence_order answer (wrong field) → 400, no attempt recorded.
    const bad = await L(request(srv()).post(`/api/v2/teaching-sessions/${start.body.id}/activities/${orderAct.id}/attempts`)).send({ clientRequestId: randomUUID(), answer: { selectedOptionId: 'x' } });
    expect(bad.status).toBe(400);
    expect(await prisma.activityAttempt.count({ where: { userId: learner.userId, activityId: orderAct.id } })).toBe(0);
  });
});
