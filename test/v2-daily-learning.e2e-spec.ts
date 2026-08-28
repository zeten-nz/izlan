import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { ActivityType, ContainerStatus, ContentSource, LessonStatus, RevisionStatus, SignalStatus } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createFastifyAdapter } from '../src/bootstrap/http-adapter';
import { PrismaService } from '../src/database/prisma.service';
import { AuthorizationRepository } from '../src/authorization/authorization.repository';
import { AuthExceptionFilter } from '../src/auth/http/auth-exception.filter';
import { SMS_PORT } from '../src/sms/sms.port';
import { Clock } from '../src/common/clock';
import { ASSISTANT_PORT, AssistantRequest, AssistantResult } from '../src/assistant/assistant.port';
import { StubAssistantAdapter } from '../src/assistant/adapters/stub-assistant.adapter';
import { bootstrapSystemRoles } from '../src/bootstrap/system-roles';
import { cleanupAuthTables } from './test-db.helper';
import { TestSmsAdapter } from './test-sms.adapter';
import { provisionV2PresentSimple, V2_PRESENT_SIMPLE_SKILL_CODES, V2_PRESENT_SIMPLE_LESSON_KEYS } from '../src/bootstrap/provision-v2-present-simple';

/**
 * V2 Daily Learning + Student Assistant (e2e, izlan_test). Proves the REAL daily loop: open → today's one main
 * point → learn it through the real Teaching flow → home refreshes → tomorrow's plan is a new record (yesterday
 * untouched) → repair/review surface from real signals → no fabricated acquisition/reward/evidence from merely
 * viewing a plan. And the assistant boundary: advisory, own-session-only (404-safe), answer-key-free context,
 * graceful degradation when the provider is unavailable/failing, never mutates authoritative state.
 */
describe('V2 Daily Learning + Assistant — the real daily loop (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let authz: AuthorizationRepository;
  const sms = new TestSmsAdapter();
  const clock = { current: new Date('2026-08-20T06:00:00.000Z'), now() { return this.current; } }; // Asia/Tashkent +5 → local 11:00 Aug 20
  // Controllable assistant provider double: 'stub' answers deterministically, 'unavailable' fails closed, 'throw' simulates a provider crash.
  const assistant = {
    mode: 'stub' as 'stub' | 'unavailable' | 'throw',
    lastRequest: null as AssistantRequest | null,
    stub: new StubAssistantAdapter(),
    async ask(req: AssistantRequest): Promise<AssistantResult> {
      this.lastRequest = req;
      if (this.mode === 'throw') throw new Error('provider boom');
      if (this.mode === 'unavailable') return { status: 'UNAVAILABLE', message: null };
      return this.stub.ask(req);
    },
  };
  let seq = 0;
  const phone = () => `+99890${String(6200000 + seq++).slice(-7)}`;

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
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_PORT).useValue(sms)
      .overrideProvider(Clock).useValue(clock)
      .overrideProvider(ASSISTANT_PORT).useValue(assistant)
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
  }, 120_000);

  afterAll(async () => { await reset(); await app.close(); });
  beforeEach(() => { clock.current = new Date('2026-08-20T06:00:00.000Z'); assistant.mode = 'stub'; assistant.lastRequest = null; });

  const srv = () => app.getHttpServer();
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function reset() {
    // Daily-loop learner facts first (FKs → user/subject/point are Restrict).
    await prisma.dailyLearningPlan.deleteMany();
    await prisma.xpGrant.deleteMany();
    await prisma.dailyMissionCompletionEvidence.deleteMany();
    await prisma.dailyMissionCompletion.deleteMany();
    // V2 learner facts (child → parent).
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

  async function makeLearner(timezone = 'Asia/Tashkent'): Promise<{ token: string; userId: string }> {
    const ph = phone();
    const r = await request(srv()).post('/api/auth/otp/request').send({ phone: ph });
    const reg = await request(srv()).post('/api/auth/register').send({ challengeId: r.body.challengeId, code: sms.latestCode(), password: 'Passw0rd!123' });
    const user = await prisma.user.findUniqueOrThrow({ where: { phone: ph } });
    await prisma.userProfile.update({ where: { userId: user.id }, data: { displayName: 'A', dateOfBirth: new Date('2005-01-01'), timezone, onboardingCompletedAt: new Date() } });
    return { token: reg.body.accessToken as string, userId: user.id };
  }

  const pointId = async () => (await prisma.roadmapPoint.findUniqueOrThrow({ where: { pointKey: 'ENG-A1-PRESENT-SIMPLE' } })).id;
  const getDaily = (token: string) => request(srv()).get(`/api/v2/daily/subjects/${subjectId}/today`).set(auth(token));
  const genDaily = (token: string) => request(srv()).post(`/api/v2/daily/subjects/${subjectId}/today`).set(auth(token));

  /** Learn the pinned point through the REAL teaching flow (the route the daily action points into). Returns the sessionId. */
  async function learnThePoint(token: string, rpId: string): Promise<string> {
    const start = await request(srv()).post(`/api/v2/roadmap-points/${rpId}/teaching-session/start`).set(auth(token));
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

  // ─────────────────────────────── DAILY LOOP ───────────────────────────────

  it('DL-01: fresh learner → POST today plans the ONE main point as a LEARN action (deterministic snapshot, no answer-key leak)', async () => {
    const { token } = await makeLearner();
    const res = await genDaily(token);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ localDate: '2026-08-20', timezone: 'Asia/Tashkent', generationNo: 1, status: 'CURRENT', policyVersion: 'daily-learning-v1', engineVersion: 'daily-learning-v1' });
    expect(res.body.subject.id).toBe(subjectId);
    expect(res.body.mainGoal.pointKey).toBe('ENG-A1-PRESENT-SIMPLE');
    expect(res.body.action.type).toBe('LEARN');
    expect(res.body.action.point.pointKey).toBe('ENG-A1-PRESENT-SIMPLE');
    expect(res.body.done).toBe(false);
    expect(JSON.stringify(res.body)).not.toMatch(/answerKey|correctOptionIds/);
  });

  it('DL-02: idempotent per local day — repeat POST/GET returns the SAME plan (one CURRENT row, generationNo stays 1)', async () => {
    const { token, userId } = await makeLearner();
    const a = await genDaily(token);
    const b = await genDaily(token);
    const c = await getDaily(token);
    expect(b.body.generationNo).toBe(1);
    expect(c.body.generationNo).toBe(1);
    expect(b.body.mainGoal.roadmapPointId).toBe(a.body.mainGoal.roadmapPointId);
    expect(await prisma.dailyLearningPlan.count({ where: { userId, status: 'CURRENT' } })).toBe(1);
    expect(await prisma.dailyLearningPlan.count({ where: { userId } })).toBe(1);
  });

  it('DL-03: GET before generate is 404 (own-user, no silent auto-generate); unauthenticated is 401', async () => {
    const { token } = await makeLearner();
    const before = await getDaily(token);
    expect(before.status).toBe(404);
    expect(before.body.code).toBe('DAILY_LEARNING_NOT_FOUND');
    expect((await request(srv()).get(`/api/v2/daily/subjects/${subjectId}/today`)).status).toBe(401);
  });

  it('DL-04: completing the point through the REAL teaching flow refreshes home → mainGoalDone, DONE, one more acquired', async () => {
    const { token, userId } = await makeLearner();
    const gen = await genDaily(token);
    expect(gen.body.progress.roadmapAcquired).toBe(0);
    expect(gen.body.progress.mainGoalDone).toBe(false);

    await learnThePoint(token, gen.body.action.point.roadmapPointId);

    const after = await getDaily(token);
    expect(after.body.generationNo).toBe(1); // same day's plan, not rewritten
    expect(after.body.mainGoal.acquired).toBe(true);
    expect(after.body.progress.mainGoalDone).toBe(true);
    expect(after.body.progress.roadmapAcquired).toBe(1);
    expect(after.body.action.type).toBe('DONE');
    expect(after.body.done).toBe(true);
    // Real work → a legitimate LEARN_TODAY mission completion + XP grant exist (never fabricated by viewing).
    expect(await prisma.dailyMissionCompletion.count({ where: { userId, missionCode: 'LEARN_TODAY' } })).toBe(1);
    expect(await prisma.xpGrant.count({ where: { userId } })).toBeGreaterThan(0);
  });

  it('DL-05: one-main-new-point-per-day — after finishing the main point the SAME day does NOT unlock a new curriculum point (DONE)', async () => {
    const { token } = await makeLearner();
    const gen = await genDaily(token);
    await learnThePoint(token, gen.body.action.point.roadmapPointId);
    // Re-generate on the same local day: still the same pinned plan, and no new-learning action is invented.
    const same = await genDaily(token);
    expect(same.body.generationNo).toBe(1);
    expect(same.body.action.type).toBe('DONE');
    expect(same.body.mainGoal.acquired).toBe(true);
  });

  it('DL-06: repair outranks — an ACTIVE repair signal on the acquired point makes today\'s action REPAIR', async () => {
    const { token, userId } = await makeLearner();
    const gen = await genDaily(token);
    await learnThePoint(token, gen.body.action.point.roadmapPointId);
    // Seed a REAL active repair signal (the fact); attention is derived from it at read time.
    const state = await prisma.learnerSkillState.findFirstOrThrow({ where: { userId } });
    await prisma.learnerSignal.create({ data: { userId, subjectId, skillId: state.skillId, type: 'REPEATED_MISTAKE', status: SignalStatus.ACTIVE } });

    const after = await getDaily(token);
    expect(after.body.action.type).toBe('REPAIR');
    expect(after.body.action.reason).toBe('REPEATED_MISTAKE');
    expect(after.body.action.point.pointKey).toBe('ENG-A1-PRESENT-SIMPLE');
    expect(after.body.attention.map((a: { attention: string }) => a.attention)).toContain('REPAIR_REQUIRED');
    expect(after.body.done).toBe(false); // repair keeps the learner engaged even though the new point is done
  });

  it('DL-07: day boundary — a new local day is a NEW plan record and yesterday\'s plan is left untouched', async () => {
    const { token, userId } = await makeLearner();
    clock.current = new Date('2026-08-19T18:30:00.000Z'); // local Aug 19 23:30
    const day1 = await genDaily(token);
    expect(day1.body.localDate).toBe('2026-08-19');
    const day1Row = await prisma.dailyLearningPlan.findFirstOrThrow({ where: { userId } });

    clock.current = new Date('2026-08-20T06:00:00.000Z'); // local Aug 20
    const day2 = await genDaily(token);
    expect(day2.body.localDate).toBe('2026-08-20');

    const rows = await prisma.dailyLearningPlan.findMany({ where: { userId }, orderBy: { localDate: 'asc' } });
    expect(rows.map((r) => r.localDate.toISOString().slice(0, 10))).toEqual(['2026-08-19', '2026-08-20']);
    const day1After = rows.find((r) => r.id === day1Row.id)!;
    expect(day1After.status).toBe('CURRENT'); // yesterday's decision preserved, not rewritten/superseded
    expect(day1After.generationNo).toBe(day1Row.generationNo);
    expect(day1After.mainRoadmapPointId).toBe(day1Row.mainRoadmapPointId);
    expect(day1After.timezoneSnapshot).toBe(day1Row.timezoneSnapshot);
  });

  it('DL-08: viewing/generating a plan fabricates NO acquisition/reward/mastery/measurement', async () => {
    const { token } = await makeLearner();
    const before = { acq: await prisma.pointAcquisitionEvent.count(), xp: await prisma.xpGrant.count(), meval: await prisma.masteryEvaluation.count(), meas: await prisma.skillMeasurement.count(), states: await prisma.learnerSkillState.count(), missions: await prisma.dailyMissionCompletion.count() };
    await genDaily(token);
    await getDaily(token);
    await genDaily(token);
    const after = { acq: await prisma.pointAcquisitionEvent.count(), xp: await prisma.xpGrant.count(), meval: await prisma.masteryEvaluation.count(), meas: await prisma.skillMeasurement.count(), states: await prisma.learnerSkillState.count(), missions: await prisma.dailyMissionCompletion.count() };
    expect(after).toEqual(before);
    expect(await prisma.aiEvaluation.count()).toBe(0);
  });

  it('DL-09: /me/today resolves the learner\'s primary subject via intent; no intent/subject → 409', async () => {
    const noIntent = await makeLearner();
    const fail = await request(srv()).post('/api/v2/daily/me/today').set(auth(noIntent.token));
    expect(fail.status).toBe(409);
    expect(fail.body.code).toBe('DAILY_LEARNING_UNAVAILABLE');

    const withIntent = await makeLearner();
    const track = await prisma.track.findFirstOrThrow({ where: { subjectId } });
    await prisma.learnerLearningIntent.create({ data: { userId: withIntent.userId, subjectId, trackId: track.id } });
    const ok = await request(srv()).post('/api/v2/daily/me/today').set(auth(withIntent.token));
    expect(ok.status).toBe(200);
    expect(ok.body.subject.id).toBe(subjectId);
    expect(ok.body.mainGoal.pointKey).toBe('ENG-A1-PRESENT-SIMPLE');
  });

  // ─────────────────────────────── ASSISTANT ───────────────────────────────

  const ask = (token: string, sessionId: string, body: object) => request(srv()).post(`/api/v2/assistant/teaching-sessions/${sessionId}/ask`).set(auth(token)).send(body);

  it('AS-01: HINT → 200 ANSWERED with bounded help; the context sent to the provider carries NO answer key', async () => {
    const { token } = await makeLearner();
    const start = await request(srv()).post(`/api/v2/roadmap-points/${await pointId()}/teaching-session/start`).set(auth(token));
    const res = await ask(token, start.body.id, { task: 'HINT', language: 'en' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ANSWERED');
    expect(typeof res.body.message).toBe('string');
    expect(res.body.message.length).toBeGreaterThan(0);
    // The provider only ever received the learner-safe context — never an answer key / correct option / token.
    expect(JSON.stringify(assistant.lastRequest)).not.toMatch(/answerKey|correctOptionIds|Bearer|password/i);
    expect(assistant.lastRequest!.context).not.toHaveProperty('answerKey');
    expect(JSON.stringify(res.body)).not.toMatch(/answerKey|correctOptionIds/);
  });

  it('AS-02: WHY_WRONG is DECLINED before any incorrect submission, ANSWERED after a real incorrect one (no pre-submission answer reveal)', async () => {
    const { token } = await makeLearner();
    const start = await request(srv()).post(`/api/v2/roadmap-points/${await pointId()}/teaching-session/start`).set(auth(token));
    const sessionId = start.body.id as string;
    const declined = await ask(token, sessionId, { task: 'WHY_WRONG' });
    expect(declined.body.status).toBe('DECLINED');
    expect(declined.body.message).toBeNull();

    // Submit a genuinely wrong answer, then WHY_WRONG uses the server-side result (not hidden scoring internals).
    const objAct = (start.body.stages.find((s: { stageType: string }) => s.stageType === 'mastery').activities.find((a: { kind: string }) => a.kind === 'OBJECTIVE')).id;
    await request(srv()).post(`/api/v2/teaching-sessions/${sessionId}/activities/${objAct}/attempts`).set(auth(token)).send({ clientRequestId: randomUUID(), answer: { selectedOptionId: 'b' } });
    const answered = await ask(token, sessionId, { task: 'WHY_WRONG' });
    expect(answered.body.status).toBe('ANSWERED');
    expect(answered.body.message.length).toBeGreaterThan(0);
    expect(answered.body.message).not.toMatch(/answerKey|correctOptionIds/);
  });

  it('AS-03: provider unavailable → 200 UNAVAILABLE (not 5xx); learning is never blocked', async () => {
    const { token } = await makeLearner();
    const start = await request(srv()).post(`/api/v2/roadmap-points/${await pointId()}/teaching-session/start`).set(auth(token));
    assistant.mode = 'unavailable';
    const res = await ask(token, start.body.id, { task: 'EXPLAIN_DIFFERENTLY' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'UNAVAILABLE', message: null });
  });

  it('AS-04: provider failure (throws) is caught → 200 UNAVAILABLE, still not a 5xx', async () => {
    const { token } = await makeLearner();
    const start = await request(srv()).post(`/api/v2/roadmap-points/${await pointId()}/teaching-session/start`).set(auth(token));
    assistant.mode = 'throw';
    const res = await ask(token, start.body.id, { task: 'SIMPLIFY' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('UNAVAILABLE');
  });

  it('AS-05: the assistant mutates NO authoritative state (advisory only)', async () => {
    const { token } = await makeLearner();
    const start = await request(srv()).post(`/api/v2/roadmap-points/${await pointId()}/teaching-session/start`).set(auth(token));
    const before = { acq: await prisma.pointAcquisitionEvent.count(), meval: await prisma.masteryEvaluation.count(), meas: await prisma.skillMeasurement.count(), states: await prisma.learnerSkillState.count(), attempts: await prisma.activityAttempt.count(), signals: await prisma.learnerSignal.count(), xp: await prisma.xpGrant.count(), plans: await prisma.dailyLearningPlan.count() };
    for (const task of ['EXPLAIN_DIFFERENTLY', 'ANOTHER_EXAMPLE', 'SIMPLIFY', 'HINT']) await ask(token, start.body.id, { task });
    await ask(token, start.body.id, { task: 'QUESTION', question: 'Why do we add -s for he/she/it?' });
    const after = { acq: await prisma.pointAcquisitionEvent.count(), meval: await prisma.masteryEvaluation.count(), meas: await prisma.skillMeasurement.count(), states: await prisma.learnerSkillState.count(), attempts: await prisma.activityAttempt.count(), signals: await prisma.learnerSignal.count(), xp: await prisma.xpGrant.count(), plans: await prisma.dailyLearningPlan.count() };
    expect(after).toEqual(before);
    expect(await prisma.aiEvaluation.count()).toBe(0);
  });

  it('AS-06: own-session only — another user (and an unknown session) get 404', async () => {
    const owner = await makeLearner();
    const start = await request(srv()).post(`/api/v2/roadmap-points/${await pointId()}/teaching-session/start`).set(auth(owner.token));
    const other = await makeLearner();
    const idor = await ask(other.token, start.body.id, { task: 'HINT' });
    expect(idor.status).toBe(404);
    const unknown = await ask(owner.token, randomUUID(), { task: 'HINT' });
    expect(unknown.status).toBe(404);
    expect((await request(srv()).post(`/api/v2/assistant/teaching-sessions/${start.body.id}/ask`).send({ task: 'HINT' })).status).toBe(401);
  });

  it('AS-07: an invalid task / injected field is rejected (400) — the client cannot smuggle a free-form provider prompt', async () => {
    const { token } = await makeLearner();
    const start = await request(srv()).post(`/api/v2/roadmap-points/${await pointId()}/teaching-session/start`).set(auth(token));
    expect((await ask(token, start.body.id, { task: 'DO_ANYTHING' })).status).toBe(400);
    expect((await ask(token, start.body.id, { task: 'HINT', answerKey: { correctOptionIds: ['a'] } })).status).toBe(400);
  });
});
