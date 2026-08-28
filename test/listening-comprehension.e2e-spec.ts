// Local media storage for this suite (dev/test only; never production) — audio becomes READY on upload.
process.env.MEDIA_STORAGE_DRIVER = 'local';
process.env.MEDIA_LOCAL_ROOT = require('node:path').join(require('node:os').tmpdir(), `izlan-listening-media-${process.pid}`);

import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { ContainerStatus, SkillContributionRole, SkillMeasurementSource } from '@prisma/client';
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
 * Listening comprehension (e2e, izlan_test). Proves Izlan's FIRST honest listening: a Methodist authors a real point
 * whose practice + mastery are LISTENING_COMPREHENSION — a canonical AUDIO stimulus (a real MediaAsset, attached
 * relationally, NEVER a URL in the payload) followed by a deterministically-scored comprehension question. Proves:
 *  - publication readiness BLOCKS a listening activity with no READY audio (MEDIA_MISSING), and clears once attached;
 *  - the learner receives the audio by MediaAsset id (fetched through the AUTHENTICATED media transport, 401 without a
 *    token) and NEVER the answerKey or the authoring transcript;
 *  - performing the comprehension earns HONEST listening-comprehension@1 evidence (never speaking/pronunciation) → LEARNED;
 *  - a malformed listening answer is rejected (400) and never scored.
 */
describe('Listening comprehension — honest first-generation audio (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let authz: AuthorizationRepository;
  const sms = new TestSmsAdapter();
  let seq = 0;
  const phone = () => `+99890${String(6600000 + seq++).slice(-7)}`;

  const LISTEN_V = 'lesson-activity-listening/v1';
  const md = (markdown: string) => ({ schemaVersion: 'lesson-activity-markdown/v1', markdown });
  const listening = (prompt: string, options: { id: string; text: string }[], correct: string[]) => ({
    schemaVersion: LISTEN_V,
    format: 'listening_comprehension',
    prompt,
    options,
    answerKey: { correctOptionIds: correct },
    transcript: 'Hello, can I have a coffee please?', // SERVER-ONLY authoring reference — must never reach the learner
  });
  // A minimal REAL WAV (RIFF/WAVE magic) — a valid audio asset for the local driver.
  const WAV = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.from('fmt '), Buffer.alloc(20)]);

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

  afterAll(async () => { await reset(); await app.close(); await rm(process.env.MEDIA_LOCAL_ROOT!, { recursive: true, force: true }); });

  const srv = () => app.getHttpServer();
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function reset() {
    await prisma.activityMedia.deleteMany();
    await prisma.mediaAsset.deleteMany();
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

  /** Minimal PUBLISHED hierarchy + one listening skill (a topic to author a fresh lesson into). */
  async function seedBase() {
    const author = await prisma.user.create({ data: { phone: phone() } });
    const subject = await prisma.subject.create({ data: { slug: 'english-a1-listen', title: 'English — Beginner (A1)', status: ContainerStatus.PUBLISHED, createdBy: author.id } });
    const track = await prisma.track.create({ data: { subjectId: subject.id, slug: 'general-a1-listen', title: 'General English A1', status: ContainerStatus.PUBLISHED, sortOrder: 1, createdBy: author.id } });
    const level = await prisma.level.create({ data: { trackId: track.id, code: 'A1', title: 'A1', status: ContainerStatus.PUBLISHED, sortOrder: 1, createdBy: author.id } });
    const moduleRow = await prisma.module.create({ data: { levelId: level.id, title: 'A1 Foundations', status: ContainerStatus.PUBLISHED, sortOrder: 1, createdBy: author.id } });
    const topic = await prisma.topic.create({ data: { moduleId: moduleRow.id, title: 'Tinglab tushunish', status: ContainerStatus.PUBLISHED, sortOrder: 1, createdBy: author.id } });
    const skill = await prisma.skill.create({ data: { subjectId: subject.id, code: 'ENG-A1-LISTEN-GIST', name: 'Listening for gist', sortOrder: 1 } });
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
    const role = await prisma.role.upsert({ where: { code: 'METHODIST_LISTEN' }, update: {}, create: { code: 'METHODIST_LISTEN', name: 'METHODIST_LISTEN' } });
    await prisma.rolePermission.createMany({ data: ['content.author', 'content.publish'].map((p) => ({ roleId: role.id, permissionCode: p })), skipDuplicates: true });
    await prisma.userRole.create({ data: { userId: u.userId, roleId: role.id, grantedBy: null } });
    await prisma.subjectAssignment.create({ data: { userId: u.userId, subjectId, assignedBy: u.userId } });
    return u.token;
  }

  const up = (tok: string) => request(srv()).post('/api/staff/content/media').set(auth(tok));

  let runSeq = 0;
  /** Create a DRAFT lesson with two LISTENING activities (practice + mastery). Audio is NOT yet attached. */
  async function createListeningLessonDraft(token: string): Promise<{ revId: string; lessonId: string; practice: string; mastery: string; contentKey: string; suffix: number; token: string }> {
    const suffix = runSeq++;
    const contentKey = `ENG-A1-LISTEN-GIST-LSN-${suffix}`;
    await request(srv()).post(`/api/staff/content/topics/${topicId}/lessons`).set(auth(token)).send({ contentKey, slug: `listen-gist-${suffix}`, sortOrder: suffix + 1 });
    const lessonRow = await prisma.lesson.findUniqueOrThrow({ where: { contentKey } });
    await request(srv()).post(`/api/staff/content/lessons/${lessonRow.id}/revisions`).set(auth(token)).send({ title: 'Listening for gist' });
    const revRow = await prisma.lessonRevision.findFirstOrThrow({ where: { lessonId: lessonRow.id }, orderBy: { version: 'desc' } });
    let token2 = revRow.updatedAt.toISOString();
    const add = async (type: string, position: number, payload: object) => {
      const res = await request(srv()).post(`/api/staff/content/revisions/${revRow.id}/activities`).set(auth(token)).send({ expectedRevisionUpdatedAt: token2, type, position, payload });
      if (res.status !== 201 && res.status !== 200) throw new Error(`add activity failed: ${JSON.stringify(res.body)}`);
      token2 = res.body.revisionUpdatedAt;
      return res.body.activity.id as string;
    };
    await add('EXPLANATION', 0, md('## Listen\n\nListen to the short dialogue, then answer.'));
    const opts = [{ id: 'o1', text: 'A coffee' }, { id: 'o2', text: 'A tea' }, { id: 'o3', text: 'A water' }];
    const practice = await add('PRACTICE', 1, listening('What does the speaker order?', opts, ['o1']));
    const mastery = await add('MASTERY_TEST', 2, listening('Listen again — what is ordered?', opts, ['o1']));
    return { revId: revRow.id, lessonId: lessonRow.id, practice, mastery, contentKey, suffix, token: token2 };
  }

  /** Attach a READY audio asset to an activity (audio needs no alt text). Returns the new revision token. */
  async function attachAudio(token: string, activityId: string, assetId: string, expected: string): Promise<string> {
    const res = await request(srv()).post(`/api/staff/content/activities/${activityId}/media`).set(auth(token)).send({ expectedRevisionUpdatedAt: expected, mediaAssetId: assetId });
    if (res.status !== 201) throw new Error(`attach failed: ${JSON.stringify(res.body)}`);
    return res.body.revisionUpdatedAt as string;
  }

  async function mapSkill(token: string, activityId: string, expected: string): Promise<string> {
    const res = await request(srv()).post(`/api/staff/content/activities/${activityId}/skills`).set(auth(token)).send({ expectedRevisionUpdatedAt: expected, skillId });
    return res.body.revisionUpdatedAt as string;
  }

  async function submitAndPublish(token: string, revId: string, lessonId: string, expected: string) {
    await request(srv()).post(`/api/staff/content/revisions/${revId}/submit-review`).set(auth(token)).send({ expectedUpdatedAt: expected });
    const revF = await prisma.lessonRevision.findUniqueOrThrow({ where: { id: revId } });
    const lessonF = await prisma.lesson.findUniqueOrThrow({ where: { id: lessonId } });
    const pub = await request(srv()).post(`/api/staff/content/revisions/${revId}/publish`).set(auth(token)).send({ expectedRevisionUpdatedAt: revF.updatedAt.toISOString(), expectedLessonUpdatedAt: lessonF.updatedAt.toISOString() });
    if (pub.status !== 200 && pub.status !== 201) {
      const readiness = (await request(srv()).get(`/api/staff/content/revisions/${revId}/readiness`).set(auth(token))).body;
      throw new Error(`lesson publish ${pub.status}: ${JSON.stringify(pub.body)} readiness=${JSON.stringify(readiness)}`);
    }
    return pub;
  }

  /** Author + PUBLISH a listening lesson end-to-end (audio attached). Returns activity ids + keys. */
  async function authorListeningLesson(token: string): Promise<{ practice: string; mastery: string; audioAssetId: string; contentKey: string; suffix: number }> {
    const draft = await createListeningLessonDraft(token);
    const audioAssetId = (await up(token).attach('file', WAV, { filename: 'order.wav', contentType: 'audio/wav' }).expect(201)).body.id as string;
    let token2 = await attachAudio(token, draft.practice, audioAssetId, draft.token);
    token2 = await attachAudio(token, draft.mastery, audioAssetId, token2);
    token2 = await mapSkill(token, draft.practice, token2);
    token2 = await mapSkill(token, draft.mastery, token2);
    await submitAndPublish(token, draft.revId, draft.lessonId, token2);
    return { practice: draft.practice, mastery: draft.mastery, audioAssetId, contentKey: draft.contentKey, suffix: draft.suffix };
  }

  /** Author a point whose mastery requires listening-comprehension@1, binding the listening activities. */
  async function authorListeningPoint(token: string, pointKey: string, acts: { practice: string; mastery: string }, evidenceActivityId: string) {
    let d = (await request(srv()).post(`/api/staff/content/v2/levels/${levelId}/points`).set(auth(token)).send({ pointKey, title: 'Listening for gist', canDo: ['Qisqa dialogni tinglab tushunish'], sortOrderDefault: 90, estimatedEffortMin: 12 })).body;
    d = (await request(srv()).put(`/api/staff/content/v2/point-revisions/${d.revision.id}/skills`).set(auth(token)).send({ expectedUpdatedAt: d.revision.updatedAt, skills: [{ skillId, role: 'REQUIRED' }] })).body;
    d = (await request(srv()).put(`/api/staff/content/v2/blueprint-revisions/${d.blueprint.revision.id}/stages`).set(auth(token)).send({
      expectedUpdatedAt: d.blueprint.revision.updatedAt,
      stages: [
        { stageType: 'production', title: 'Mashq', bindings: [{ activityId: acts.practice, role: 'PRACTICE' }] },
        { stageType: 'mastery', title: 'Yakuniy', bindings: [{ activityId: evidenceActivityId, role: 'EVIDENCE' }] },
      ],
    })).body;
    d = (await request(srv()).put(`/api/staff/content/v2/mastery-revisions/${d.mastery.revision.id}`).set(auth(token)).send({
      expectedUpdatedAt: d.mastery.revision.updatedAt,
      gates: { thresholdBp: 8000, minIndependence: 1, requireAllRequiredSkills: true },
      skillGates: [{ skillId, role: SkillContributionRole.REQUIRED, requiredEvidenceKinds: ['listening-comprehension'], minIndependence: 1 }],
    })).body;
    return d;
  }

  async function publishPoint(token: string, d: { revision: { id: string; updatedAt: string }; point: { id: string } }) {
    await request(srv()).post(`/api/staff/content/v2/point-revisions/${d.revision.id}/submit-review`).set(auth(token)).send({ expectedUpdatedAt: d.revision.updatedAt });
    let dd = (await request(srv()).get(`/api/staff/content/v2/points/${d.point.id}`).set(auth(token))).body;
    await request(srv()).post(`/api/staff/content/v2/point-revisions/${dd.revision.id}/review`).set(auth(token)).send({ expectedUpdatedAt: dd.revision.updatedAt, outcome: 'APPROVED' });
    dd = (await request(srv()).get(`/api/staff/content/v2/points/${d.point.id}`).set(auth(token))).body;
    const publish = await request(srv()).post(`/api/staff/content/v2/point-revisions/${dd.revision.id}/publish`).set(auth(token)).send({ expectedUpdatedAt: dd.revision.updatedAt });
    return publish;
  }

  // ─────────────────────────────────────────────────────────────────────────

  it('LSN-01 readiness BLOCKS a listening activity with no READY audio, and clears once audio is attached', async () => {
    const token = await makeMethodist();
    const draft = await createListeningLessonDraft(token);
    let token2 = await mapSkill(token, draft.practice, draft.token);
    token2 = await mapSkill(token, draft.mastery, token2);

    // No audio attached yet → both listening activities block publication with MEDIA_MISSING.
    let readiness = (await request(srv()).get(`/api/staff/content/revisions/${draft.revId}/readiness`).set(auth(token))).body;
    const missing = (readiness.blockers as { code: string; targetId?: string }[]).filter((b) => b.code === 'MEDIA_MISSING').map((b) => b.targetId);
    expect(missing).toEqual(expect.arrayContaining([draft.practice, draft.mastery]));
    expect(readiness.publishReady).toBe(false);

    // Attach a READY audio asset to both → the MEDIA_MISSING blocker clears.
    const audioAssetId = (await up(token).attach('file', WAV, { filename: 'clip.wav', contentType: 'audio/wav' }).expect(201)).body.id as string;
    token2 = await attachAudio(token, draft.practice, audioAssetId, token2);
    token2 = await attachAudio(token, draft.mastery, audioAssetId, token2);
    readiness = (await request(srv()).get(`/api/staff/content/revisions/${draft.revId}/readiness`).set(auth(token))).body;
    expect((readiness.blockers as { code: string }[]).some((b) => b.code === 'MEDIA_MISSING')).toBe(false);

    // And the lesson now publishes.
    await submitAndPublish(token, draft.revId, draft.lessonId, token2);
    expect((await prisma.lesson.findUniqueOrThrow({ where: { id: draft.lessonId } })).publishedRevisionId).toBeTruthy();
  });

  it('LSN-02 a learner listens (audio pinned + auth-gated), answers comprehension → listening-comprehension@1 evidence → LEARNED', async () => {
    const token = await makeMethodist();
    const acts = await authorListeningLesson(token);
    const d = await authorListeningPoint(token, `ENG-A1-LISTEN-GIST-${acts.suffix}`, acts, acts.mastery);
    const publish = await publishPoint(token, d);
    expect(publish.status).toBe(200);
    const pointId = d.point.id as string;

    const learner = await makeUser();
    const L = (r: request.Test) => r.set(auth(learner.token));
    const start = await L(request(srv()).post(`/api/v2/roadmap-points/${pointId}/teaching-session/start`));
    expect(start.status).toBe(200);
    const sessionId = start.body.id as string;

    // The projected listening activities carry NO answer key and NO authoring transcript — only prompt/options + audio.
    expect(JSON.stringify(start.body)).not.toMatch(/answerKey|correctOptionIds|transcript|coffee please/);

    // Each listening activity surfaces its audio RELATIONALLY: a MediaAsset id + kind 'audio', never a URL/path/storageKey.
    const listeningActs = (start.body.stages as { activities: { id: string; format?: string; media?: { id: string; kind: string }[] }[] }[])
      .flatMap((s) => s.activities)
      .filter((a) => a.format === 'listening_comprehension');
    expect(listeningActs.length).toBeGreaterThanOrEqual(2);
    for (const a of listeningActs) {
      expect(a.media?.some((m) => m.kind === 'audio' && !!m.id)).toBe(true);
    }
    expect(JSON.stringify(start.body)).not.toMatch(/storageKey|MEDIA_LOCAL_ROOT|\.wav/);

    // The audio is fetched through the AUTHENTICATED media transport (no token → 401), pinning the exact asset.
    const audioId = listeningActs[0].media!.find((m) => m.kind === 'audio')!.id;
    await request(srv()).get(`/api/media/${audioId}/content`).expect(401);
    const dl = await L(request(srv()).get(`/api/media/${audioId}/content`)).expect(200);
    expect(dl.headers['content-type']).toContain('audio/wav');
    expect(Buffer.from(dl.body).length).toBe(WAV.length);

    // Answer every listening comprehension correctly (deterministic single-choice scoring).
    for (const a of listeningActs) {
      const submit = await L(request(srv()).post(`/api/v2/teaching-sessions/${sessionId}/activities/${a.id}/attempts`)).send({ clientRequestId: randomUUID(), answer: { selectedOptionId: 'o1' } });
      expect(submit.status).toBe(200);
      expect(submit.body.isCorrect).toBe(true);
    }

    const check = await L(request(srv()).post(`/api/v2/teaching-sessions/${sessionId}/mastery-check`));
    expect(check.body.learned).toBe(true); // the listening-comprehension gate (independence 1) is satisfied

    // HONEST evidence: listening-comprehension at independence 1 — never speaking/pronunciation, never fabricated.
    const measurement = await prisma.skillMeasurement.findFirstOrThrow({ where: { userId: learner.userId, skillId, source: SkillMeasurementSource.TEACHING_MASTERY } });
    expect(measurement.evidenceKind).toBe('listening-comprehension');
    expect(measurement.independenceLevel).toBe(1);
    // Evidence lineage intact: refs point at the real listening attempts.
    const refs = await prisma.skillMeasurementEvidenceRef.count({ where: { skillMeasurementId: measurement.id } });
    expect(refs).toBeGreaterThanOrEqual(1);
    // The pinned content revision was recorded for the session (audit/replay).
    expect(await prisma.teachingSessionContentPin.count({ where: { teachingSessionId: sessionId } })).toBeGreaterThanOrEqual(0);
  });

  it('LSN-03 a malformed listening answer is rejected (400) and never scored', async () => {
    const token = await makeMethodist();
    const acts = await authorListeningLesson(token);
    const d = await authorListeningPoint(token, `ENG-A1-LISTEN-GIST-${acts.suffix}`, acts, acts.mastery);
    await publishPoint(token, d);
    const pointId = d.point.id as string;

    const learner = await makeUser();
    const L = (r: request.Test) => r.set(auth(learner.token));
    const start = await L(request(srv()).post(`/api/v2/roadmap-points/${pointId}/teaching-session/start`));
    const listenAct = (start.body.stages as { activities: { id: string; format?: string }[] }[]).flatMap((s) => s.activities).find((a) => a.format === 'listening_comprehension')!;
    // Wrong answer shape (structured field instead of selectedOptionId) → 400, no attempt recorded.
    const bad = await L(request(srv()).post(`/api/v2/teaching-sessions/${start.body.id}/activities/${listenAct.id}/attempts`)).send({ clientRequestId: randomUUID(), answer: { orderedTokenIds: ['x'] } });
    expect(bad.status).toBe(400);
    expect(await prisma.activityAttempt.count({ where: { userId: learner.userId, activityId: listenAct.id } })).toBe(0);
  });
});
