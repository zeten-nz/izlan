import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ActivityType, AssessmentPurposeScope, ContainerStatus, ContentSource, RevisionStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AuthorizationRepository } from '../src/authorization/authorization.repository';
import { AuthExceptionFilter } from '../src/auth/http/auth-exception.filter';
import { SMS_PORT } from '../src/sms/sms.port';
import { bootstrapSystemRoles } from '../src/bootstrap/system-roles';
import { cleanupAuthTables, cleanupAssessmentTables } from './test-db.helper';
import { TestSmsAdapter } from './test-sms.adapter';
import { PLACEMENT_CONFIG_SCHEMA_VERSION, PLACEMENT_ENGINE_VERSION } from '../src/assessment/engine/placement-engine.types';
import { PLACEMENT_ITEM_SCHEMA_VERSION } from '../src/assessment/scoring/item-payload';

describe('Placement assessment (e2e, izlan_test)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  const sms = new TestSmsAdapter();
  let n = 0;
  const uid = () => `${Date.now()}-${n++}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(SMS_PORT).useValue(sms).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AuthExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = moduleRef.get(PrismaService);
    await resetAll();
    await prisma.role.deleteMany();
    await bootstrapSystemRoles(moduleRef.get(AuthorizationRepository));
  });

  afterAll(async () => {
    await resetAll();
    await app.close();
  });

  beforeEach(async () => {
    await resetAll();
    sms.clear();
  });

  async function resetAll() {
    await cleanupAssessmentTables(prisma);
    await prisma.learnerLearningIntent.deleteMany();
    await prisma.track.deleteMany();
    await prisma.subject.deleteMany();
    await cleanupAuthTables(prisma);
  }

  const server = () => app.getHttpServer();

  // ── auth + onboarding ──
  async function makeLearner(phone: string): Promise<{ token: string; userId: string }> {
    await prisma.otpChallenge.updateMany({ where: { phone }, data: { createdAt: new Date(Date.now() - 300_000) } });
    const req = await request(server()).post('/api/auth/otp/request').send({ phone });
    const verify = await request(server()).post('/api/auth/otp/verify').send({ challengeId: req.body.challengeId, code: sms.latestCode() });
    const user = await prisma.user.findUnique({ where: { phone } });
    await prisma.userProfile.update({
      where: { userId: user!.id },
      data: { displayName: 'A', dateOfBirth: new Date('2005-01-01'), timezone: 'Asia/Tashkent', onboardingCompletedAt: new Date() },
    });
    return { token: verify.body.accessToken, userId: user!.id };
  }

  async function makeContent(creatorId: string): Promise<{ subjectId: string; trackId: string; skillId: string }> {
    const s = await prisma.subject.create({ data: { slug: `s-${uid()}`, title: 'English', status: ContainerStatus.PUBLISHED, sortOrder: 1, createdBy: creatorId } });
    const t = await prisma.track.create({ data: { subjectId: s.id, slug: `t-${uid()}`, title: 'IELTS', status: ContainerStatus.PUBLISHED, sortOrder: 1, createdBy: creatorId } });
    const skillId = await makeSkill(s.id);
    return { subjectId: s.id, trackId: t.id, skillId };
  }
  const makeSkill = async (subjectId: string) => (await prisma.skill.create({ data: { subjectId, name: `sk-${uid()}` } })).id;
  const makeIntent = (userId: string, subjectId: string, trackId: string | null) => prisma.learnerLearningIntent.create({ data: { userId, subjectId, trackId } });

  // ── fixtures ──
  const scPayload = (correct = 'a') => ({
    schemaVersion: PLACEMENT_ITEM_SCHEMA_VERSION, format: 'single_choice', prompt: 'Choose',
    options: [{ id: 'a', text: 'Alpha' }, { id: 'b', text: 'Beta' }], answerKey: { correctOptionIds: [correct] },
  });
  const mcPayload = () => ({
    schemaVersion: PLACEMENT_ITEM_SCHEMA_VERSION, format: 'multiple_choice', prompt: 'Pick A and B',
    options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }], answerKey: { correctOptionIds: ['a', 'b'] },
  });
  const openPayload = () => ({ schemaVersion: PLACEMENT_ITEM_SCHEMA_VERSION, format: 'open_ended', prompt: 'Write an essay' });
  const config = (over: { itemsPerSkill?: number; maxItems?: number; startDifficulty?: number; stepUp?: number; minDifficulty?: number; maxDifficulty?: number } = {}) => ({
    schemaVersion: PLACEMENT_CONFIG_SCHEMA_VERSION, engine: PLACEMENT_ENGINE_VERSION,
    selection: { startDifficulty: over.startDifficulty ?? 3, stepUp: over.stepUp ?? 1, stepDown: 1 },
    coverage: { itemsPerSkill: over.itemsPerSkill ?? 1 },
    stopping: { maxItems: over.maxItems ?? 10 },
    profileScale: { minDifficulty: over.minDifficulty ?? 1, maxDifficulty: over.maxDifficulty ?? 6 },
  });

  interface SeedItem { skillId: string; difficulty: number; payload: object; type?: ActivityType; inPool?: boolean }
  interface Seeded { definitionId: string; versionId: string; items: { id: string; skillId: string }[]; poolItemIds: string[] }

  async function createDefinition(creatorId: string, subjectId: string): Promise<string> {
    const def = await prisma.assessmentDefinition.create({
      data: { subjectId, purposeScope: AssessmentPurposeScope.DIAGNOSTIC, title: 'Placement', status: ContainerStatus.PUBLISHED, createdBy: creatorId },
    });
    return def.id;
  }

  async function addVersion(definitionId: string, creatorId: string, opts: { items: SeedItem[]; config: object; versionNo?: number }): Promise<Omit<Seeded, 'definitionId'>> {
    const version = await prisma.assessmentDefinitionVersion.create({
      data: { definitionId, versionNo: opts.versionNo ?? 1, config: opts.config as object, status: RevisionStatus.PUBLISHED, createdBy: creatorId, publishedAt: new Date() },
    });
    await prisma.assessmentDefinition.update({ where: { id: definitionId }, data: { currentVersionId: version.id } });
    const items: { id: string; skillId: string }[] = [];
    const poolItemIds: string[] = [];
    for (const it of opts.items) {
      const item = await prisma.assessmentItem.create({
        data: { definitionId, type: it.type ?? ActivityType.MINI_QUESTION, payload: it.payload, skillId: it.skillId, difficulty: it.difficulty, status: RevisionStatus.PUBLISHED, source: ContentSource.HUMAN },
      });
      items.push({ id: item.id, skillId: it.skillId });
      if (it.inPool !== false) { await prisma.assessmentVersionItem.create({ data: { versionId: version.id, itemId: item.id } }); poolItemIds.push(item.id); }
    }
    return { versionId: version.id, items, poolItemIds };
  }

  async function seedDefinition(creatorId: string, subjectId: string, opts: { items: SeedItem[]; config: object; versionNo?: number }): Promise<Seeded> {
    const definitionId = await createDefinition(creatorId, subjectId);
    return { definitionId, ...(await addVersion(definitionId, creatorId, opts)) };
  }

  const start = (token: string, learningIntentId: string) => request(server()).post('/api/assessments/placement/start').set('Authorization', `Bearer ${token}`).send({ learningIntentId });
  const getAttempt = (token: string, id: string) => request(server()).get(`/api/assessments/attempts/${id}`).set('Authorization', `Bearer ${token}`);
  const submit = (token: string, id: string, itemId: string, answer: object) => request(server()).post(`/api/assessments/attempts/${id}/responses`).set('Authorization', `Bearer ${token}`).send({ itemId, answer });

  async function driveObjective(token: string, first: request.Response): Promise<{ presented: string[]; final: request.Response }> {
    const presented: string[] = [];
    let view = first;
    const attemptId = view.body.attemptId;
    while (view.body.status === 'IN_PROGRESS') {
      presented.push(view.body.item.id);
      view = await submit(token, attemptId, view.body.item.id, { selectedOptionId: 'a' });
      expect(view.status).toBe(200);
    }
    return { presented, final: view };
  }

  // ─────────────────────────────────────────────────────────────────────────

  it('full objective flow → complete with reproducible evidence, coverage, and NO downstream side-effects', async () => {
    const { token, userId } = await makeLearner('+998900000201');
    const { subjectId, trackId, skillId } = await makeContent(userId);
    const intent = await makeIntent(userId, subjectId, trackId);
    const seed = await seedDefinition(userId, subjectId, {
      items: [{ skillId, difficulty: 3, payload: scPayload() }, { skillId, difficulty: 4, payload: scPayload() }, { skillId, difficulty: 2, payload: scPayload() }],
      config: config({ itemsPerSkill: 3, maxItems: 3 }),
    });

    expect((await request(server()).get(`/api/assessments/placement/availability?learningIntentId=${intent.id}`).set('Authorization', `Bearer ${token}`)).body).toEqual({ available: true });

    const started = await start(token, intent.id);
    expect(started.status).toBe(200);
    expect(started.body).toMatchObject({ status: 'IN_PROGRESS', engineVersion: PLACEMENT_ENGINE_VERSION, progress: { answered: 0, maxItems: 3 }, result: null });
    expect(started.body.item).toMatchObject({ format: 'single_choice', options: expect.any(Array) });

    const { presented, final } = await driveObjective(token, started);
    expect(final.body.status).toBe('COMPLETED');
    expect(final.body.result).toMatchObject({ answered: 3, objectiveCorrect: 3, coverageComplete: true, insufficientSkillIds: [] });
    expect(new Set(presented).size).toBe(3);

    const attempt = await prisma.assessmentAttempt.findUnique({ where: { id: started.body.attemptId } });
    expect(attempt).toMatchObject({ status: 'COMPLETED', definitionVersionId: seed.versionId, purpose: 'INITIAL_DIAGNOSTIC' });
    const responses = await prisma.assessmentResponse.findMany({ where: { attemptId: attempt!.id }, orderBy: { sequenceNo: 'asc' } });
    expect(responses.map((r) => r.sequenceNo)).toEqual([1, 2, 3]);
    expect(responses.every((r) => r.status === 'SUBMITTED' && r.isCorrect === true && r.deterministicScore === 10000)).toBe(true);

    // Skill state/measurement are now produced by Phase 1.5C auto-derivation (the HTTP submit flow),
    // covered in skill-profile.e2e. Phase 1.8C: the derived weak-skill state (mastery < 5000, high
    // confidence, ≥3 evidence) now yields an advisory WEAK_SKILL signal via the merge→signal chain (§62) —
    // the assessment module still writes NO signal directly (no REPEATED_MISTAKE without lesson attempts).
    expect(await prisma.learnerRoadmap.count({ where: { userId } })).toBe(0);
    const sigs = await prisma.learnerSignal.findMany({ where: { userId } });
    expect(sigs.every((s) => s.type === 'WEAK_SKILL' || s.type === 'REVIEW_DUE')).toBe(true); // only state-derived, none from assessment
    expect(sigs.some((s) => s.type === 'REPEATED_MISTAKE')).toBe(false);
    expect(await prisma.xpGrant.count({ where: { userId } })).toBe(0);
    expect(await prisma.aiEvaluation.count()).toBe(0);
  });

  it('resume: reload keeps the same current item and does not advance (§54)', async () => {
    const { token, userId } = await makeLearner('+998900000202');
    const { subjectId, trackId, skillId } = await makeContent(userId);
    const intent = await makeIntent(userId, subjectId, trackId);
    await seedDefinition(userId, subjectId, { items: [{ skillId, difficulty: 3, payload: scPayload() }, { skillId, difficulty: 4, payload: scPayload() }], config: config({ itemsPerSkill: 2, maxItems: 2 }) });

    const started = await start(token, intent.id);
    const attemptId = started.body.attemptId;
    const firstItemId = started.body.item.id;
    for (let i = 0; i < 3; i++) {
      const g = await getAttempt(token, attemptId);
      expect(g.body.item.id).toBe(firstItemId);
      expect(g.body.progress.answered).toBe(0);
    }
    expect(await prisma.assessmentResponse.count({ where: { attemptId } })).toBe(1);
    await submit(token, attemptId, firstItemId, { selectedOptionId: 'a' });
    expect((await getAttempt(token, attemptId)).body.item.id).not.toBe(firstItemId);
  });

  it('version pinning + start-resume: pointer moves to v2, but start resumes the pinned v1 attempt; new learner uses v2 (§9/28/38/50)', async () => {
    const creator = await makeLearner('+998900000203');
    const { subjectId, trackId, skillId } = await makeContent(creator.userId);
    const seedV1 = await seedDefinition(creator.userId, subjectId, {
      items: [{ skillId, difficulty: 2, payload: scPayload() }, { skillId, difficulty: 3, payload: scPayload() }],
      config: config({ itemsPerSkill: 2, maxItems: 2 }), versionNo: 1,
    });

    const i1 = await makeIntent(creator.userId, subjectId, trackId);
    const s1 = await start(creator.token, i1.id);

    // publish v2 (different pool), move current pointer, archive v1
    const v2 = await addVersion(seedV1.definitionId, creator.userId, {
      items: [{ skillId, difficulty: 2, payload: scPayload() }, { skillId, difficulty: 3, payload: scPayload() }],
      config: config({ itemsPerSkill: 2, maxItems: 2 }), versionNo: 2,
    });
    await prisma.assessmentDefinitionVersion.update({ where: { id: seedV1.versionId }, data: { status: RevisionStatus.ARCHIVED } });

    // start again → RESUMES the v1 attempt (does NOT repin to v2, does NOT create a new attempt)
    const s1again = await start(creator.token, i1.id);
    expect(s1again.body.attemptId).toBe(s1.body.attemptId);
    const a1 = await prisma.assessmentAttempt.findUnique({ where: { id: s1.body.attemptId } });
    expect(a1!.definitionVersionId).toBe(seedV1.versionId);
    expect(await prisma.assessmentAttempt.count({ where: { userId: creator.userId, subjectId, status: 'IN_PROGRESS' } })).toBe(1);

    // resume presents only v1 items; drive to completion stays on v1
    const run1 = await driveObjective(creator.token, s1again);
    expect(run1.presented.every((id) => seedV1.poolItemIds.includes(id))).toBe(true);

    // a NEW learner resolves the new current version v2
    const l2 = await makeLearner('+998900000204');
    const i2 = await makeIntent(l2.userId, subjectId, trackId);
    const s2 = await start(l2.token, i2.id);
    const a2 = await prisma.assessmentAttempt.findUnique({ where: { id: s2.body.attemptId } });
    expect(a2!.definitionVersionId).toBe(v2.versionId);
    const run2 = await driveObjective(l2.token, s2);
    expect(run2.presented.every((id) => v2.poolItemIds.includes(id))).toBe(true);
    expect(run2.presented.some((id) => seedV1.poolItemIds.includes(id))).toBe(false);
  });

  it('pool membership: an item outside the pinned version pool is never presented (§10/51)', async () => {
    const { token, userId } = await makeLearner('+998900000205');
    const { subjectId, trackId, skillId } = await makeContent(userId);
    const intent = await makeIntent(userId, subjectId, trackId);
    const seed = await seedDefinition(userId, subjectId, {
      items: [{ skillId, difficulty: 3, payload: scPayload() }, { skillId, difficulty: 3, payload: scPayload() }, { skillId, difficulty: 3, payload: scPayload(), inPool: false }],
      config: config({ itemsPerSkill: 5, maxItems: 5 }),
    });
    const outside = seed.items[2].id;
    const { presented } = await driveObjective(token, await start(token, intent.id));
    expect(presented).not.toContain(outside);
    expect(presented.length).toBe(2);
  });

  it('answer key never leaks in any HTTP response (§52)', async () => {
    const { token, userId } = await makeLearner('+998900000206');
    const { subjectId, trackId, skillId } = await makeContent(userId);
    const intent = await makeIntent(userId, subjectId, trackId);
    await seedDefinition(userId, subjectId, { items: [{ skillId, difficulty: 3, payload: scPayload() }, { skillId, difficulty: 3, payload: scPayload() }], config: config({ itemsPerSkill: 2, maxItems: 2 }) });
    const started = await start(token, intent.id);
    const g = await getAttempt(token, started.body.attemptId);
    const sub = await submit(token, started.body.attemptId, started.body.item.id, { selectedOptionId: 'a' });
    for (const body of [started.body, g.body, sub.body]) {
      const json = JSON.stringify(body);
      for (const leak of ['answerKey', 'correctOptionIds', 'skillId', 'difficulty']) expect(json).not.toContain(leak);
    }
  });

  it('ownership: another user cannot read or answer someone else\'s attempt (§53)', async () => {
    const owner = await makeLearner('+998900000207');
    const { subjectId, trackId, skillId } = await makeContent(owner.userId);
    const intent = await makeIntent(owner.userId, subjectId, trackId);
    await seedDefinition(owner.userId, subjectId, { items: [{ skillId, difficulty: 3, payload: scPayload() }], config: config({ itemsPerSkill: 1, maxItems: 1 }) });
    const started = await start(owner.token, intent.id);
    const attacker = await makeLearner('+998900000208');
    expect((await getAttempt(attacker.token, started.body.attemptId)).status).toBe(404);
    expect((await submit(attacker.token, started.body.attemptId, started.body.item.id, { selectedOptionId: 'a' })).status).toBe(404);
  });

  it('§31 skill-balanced: two skills, itemsPerSkill=2 → 2 evidence each before completion', async () => {
    const { token, userId } = await makeLearner('+998900000209');
    const { subjectId, trackId, skillId: skA } = await makeContent(userId);
    const skB = await makeSkill(subjectId);
    const intent = await makeIntent(userId, subjectId, trackId);
    const seed = await seedDefinition(userId, subjectId, {
      items: [
        { skillId: skA, difficulty: 1, payload: scPayload() }, { skillId: skA, difficulty: 2, payload: scPayload() }, { skillId: skA, difficulty: 3, payload: scPayload() },
        { skillId: skB, difficulty: 1, payload: scPayload() }, { skillId: skB, difficulty: 2, payload: scPayload() }, { skillId: skB, difficulty: 3, payload: scPayload() },
      ],
      config: config({ itemsPerSkill: 2, maxItems: 10 }),
    });
    const skOf = new Map(seed.items.map((i) => [i.id, i.skillId]));
    const { presented, final } = await driveObjective(token, await start(token, intent.id));
    const perSkill = presented.reduce<Record<string, number>>((acc, id) => { const s = skOf.get(id)!; acc[s] = (acc[s] ?? 0) + 1; return acc; }, {});
    expect(perSkill[skA]).toBe(2);
    expect(perSkill[skB]).toBe(2);
    expect(final.body.result.coverageComplete).toBe(true);
  });

  it('§32 per-skill difficulty independence: answering one skill leaves the other skill target unchanged', async () => {
    const { token, userId } = await makeLearner('+998900000210');
    const { subjectId, trackId, skillId: skA } = await makeContent(userId);
    const skB = await makeSkill(subjectId);
    const intent = await makeIntent(userId, subjectId, trackId);
    const seed = await seedDefinition(userId, subjectId, {
      items: [{ skillId: skA, difficulty: 3, payload: scPayload() }, { skillId: skA, difficulty: 4, payload: scPayload() }, { skillId: skB, difficulty: 3, payload: scPayload() }, { skillId: skB, difficulty: 4, payload: scPayload() }],
      config: config({ itemsPerSkill: 2, maxItems: 10, startDifficulty: 3, stepUp: 1 }),
    });
    const skOf = new Map(seed.items.map((i) => [i.id, i.skillId]));
    const started = await start(token, intent.id);
    const firstItem = started.body.item.id;
    const firstSkill = skOf.get(firstItem)!;
    const otherSkill = firstSkill === skA ? skB : skA;
    await submit(token, started.body.attemptId, firstItem, { selectedOptionId: 'a' }); // correct

    const es = (await prisma.assessmentAttempt.findUnique({ where: { id: started.body.attemptId } }))!.engineState as { skills: Record<string, { targetDifficulty: number }> };
    expect(es.skills[firstSkill].targetDifficulty).toBe(4); // 3 + stepUp
    expect(es.skills[otherSkill].targetDifficulty).toBe(3); // untouched
  });

  it('§33 coverage failure: a skill with too few items → completes with coverageComplete=false + insufficientSkillIds', async () => {
    const { token, userId } = await makeLearner('+998900000211');
    const { subjectId, trackId, skillId: skA } = await makeContent(userId);
    const skB = await makeSkill(subjectId);
    const intent = await makeIntent(userId, subjectId, trackId);
    await seedDefinition(userId, subjectId, {
      items: [{ skillId: skA, difficulty: 1, payload: scPayload() }, { skillId: skA, difficulty: 2, payload: scPayload() }, { skillId: skB, difficulty: 1, payload: scPayload() }],
      config: config({ itemsPerSkill: 2, maxItems: 10 }),
    });
    const { presented, final } = await driveObjective(token, await start(token, intent.id));
    expect(new Set(presented).size).toBe(presented.length); // no repeats
    expect(presented.length).toBe(3); // 2 skA + 1 skB
    expect(final.body.result.coverageComplete).toBe(false);
    expect(final.body.result.insufficientSkillIds).toEqual([skB]);
  });

  it('§34 impossible config: distinctSkills × itemsPerSkill > maxItems → start fails, no attempt created', async () => {
    const { token, userId } = await makeLearner('+998900000212');
    const { subjectId, trackId, skillId: skA } = await makeContent(userId);
    const skB = await makeSkill(subjectId);
    const skC = await makeSkill(subjectId);
    const intent = await makeIntent(userId, subjectId, trackId);
    await seedDefinition(userId, subjectId, {
      items: [skA, skB, skC].flatMap((s) => [{ skillId: s, difficulty: 1, payload: scPayload() }, { skillId: s, difficulty: 2, payload: scPayload() }, { skillId: s, difficulty: 3, payload: scPayload() }]),
      config: config({ itemsPerSkill: 3, maxItems: 8 }), // 3×3=9 > 8
    });
    const res = await start(token, intent.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ASSESSMENT_CONFIGURATION_INVALID');
    expect(await prisma.assessmentAttempt.count({ where: { userId } })).toBe(0);
  });

  it('§24 open-ended in a placement pool → configuration invalid before any attempt starts', async () => {
    const { token, userId } = await makeLearner('+998900000213');
    const { subjectId, trackId, skillId } = await makeContent(userId);
    const intent = await makeIntent(userId, subjectId, trackId);
    await seedDefinition(userId, subjectId, { items: [{ skillId, difficulty: 3, payload: scPayload() }, { skillId, difficulty: 3, payload: openPayload(), type: ActivityType.WRITING }], config: config({ itemsPerSkill: 2, maxItems: 5 }) });
    const res = await start(token, intent.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ASSESSMENT_CONFIGURATION_INVALID');
    expect(await prisma.assessmentAttempt.count({ where: { userId } })).toBe(0);
  });

  it('§5/30 response replay: same answer idempotent (200); different answer conflict (409)', async () => {
    const { token, userId } = await makeLearner('+998900000214');
    const { subjectId, trackId, skillId } = await makeContent(userId);
    const intent = await makeIntent(userId, subjectId, trackId);
    await seedDefinition(userId, subjectId, { items: [{ skillId, difficulty: 3, payload: scPayload() }, { skillId, difficulty: 4, payload: scPayload() }], config: config({ itemsPerSkill: 2, maxItems: 2 }) });
    const started = await start(token, intent.id);
    const attemptId = started.body.attemptId;
    const itemId = started.body.item.id;

    expect((await submit(token, attemptId, itemId, { selectedOptionId: 'a' })).status).toBe(200);
    const replaySame = await submit(token, attemptId, itemId, { selectedOptionId: 'a' });
    expect(replaySame.status).toBe(200); // idempotent
    const replayDiff = await submit(token, attemptId, itemId, { selectedOptionId: 'b' });
    expect(replayDiff.status).toBe(409);
    expect(replayDiff.body.code).toBe('ASSESSMENT_RESPONSE_CONFLICT');
    // exactly one submitted response for that item (immutable)
    expect(await prisma.assessmentResponse.count({ where: { attemptId, itemId, status: 'SUBMITTED' } })).toBe(1);
  });

  it('§30 multiple-choice: order-independent replay same; different set conflict; duplicate → 400', async () => {
    const { token, userId } = await makeLearner('+998900000215');
    const { subjectId, trackId, skillId } = await makeContent(userId);
    const intent = await makeIntent(userId, subjectId, trackId);
    await seedDefinition(userId, subjectId, { items: [{ skillId, difficulty: 3, payload: mcPayload() }, { skillId, difficulty: 4, payload: mcPayload() }], config: config({ itemsPerSkill: 2, maxItems: 2 }) });
    const started = await start(token, intent.id);
    const attemptId = started.body.attemptId;
    const itemId = started.body.item.id;

    expect((await submit(token, attemptId, itemId, { selectedOptionIds: ['a', 'b'] })).status).toBe(200);
    expect((await submit(token, attemptId, itemId, { selectedOptionIds: ['b', 'a'] })).status).toBe(200); // order-independent replay
    const diff = await submit(token, attemptId, itemId, { selectedOptionIds: ['a', 'c'] });
    expect(diff.status).toBe(409);
    expect(diff.body.code).toBe('ASSESSMENT_RESPONSE_CONFLICT');
  });

  it('§3 duplicate multiple-choice option id → 400 invalid response', async () => {
    const { token, userId } = await makeLearner('+998900000216');
    const { subjectId, trackId, skillId } = await makeContent(userId);
    const intent = await makeIntent(userId, subjectId, trackId);
    await seedDefinition(userId, subjectId, { items: [{ skillId, difficulty: 3, payload: mcPayload() }], config: config({ itemsPerSkill: 1, maxItems: 1 }) });
    const started = await start(token, intent.id);
    const dup = await submit(token, started.body.attemptId, started.body.item.id, { selectedOptionIds: ['a', 'a', 'b'] });
    expect(dup.status).toBe(400);
    expect(dup.body.code).toBe('ASSESSMENT_INVALID_RESPONSE');
  });

  it('§27 concurrent start → exactly one in-progress attempt (unique constraint)', async () => {
    const { token, userId } = await makeLearner('+998900000217');
    const { subjectId, trackId, skillId } = await makeContent(userId);
    const intent = await makeIntent(userId, subjectId, trackId);
    await seedDefinition(userId, subjectId, { items: [{ skillId, difficulty: 3, payload: scPayload() }, { skillId, difficulty: 4, payload: scPayload() }], config: config({ itemsPerSkill: 2, maxItems: 2 }) });

    const [r1, r2] = await Promise.all([start(token, intent.id), start(token, intent.id)]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r1.body.attemptId).toBe(r2.body.attemptId); // same logical attempt
    expect(await prisma.assessmentAttempt.count({ where: { userId, subjectId, purpose: 'INITIAL_DIAGNOSTIC', status: 'IN_PROGRESS' } })).toBe(1);
  });

  it('§29 DB uniqueness: a second PUBLISHED DIAGNOSTIC definition per subject is rejected; other cases allowed', async () => {
    const creator = await makeLearner('+998900000218');
    const c1 = await makeContent(creator.userId);
    await createDefinition(creator.userId, c1.subjectId); // first PUBLISHED DIAGNOSTIC

    // second PUBLISHED DIAGNOSTIC, same subject → unique violation
    await expect(createDefinition(creator.userId, c1.subjectId)).rejects.toThrow();

    // different subject → allowed
    const c2 = await makeContent(creator.userId);
    await expect(createDefinition(creator.userId, c2.subjectId)).resolves.toBeDefined();

    // DRAFT diagnostic (same subject) → allowed (partial index only covers PUBLISHED)
    await expect(prisma.assessmentDefinition.create({ data: { subjectId: c1.subjectId, purposeScope: AssessmentPurposeScope.DIAGNOSTIC, title: 'D', status: ContainerStatus.DRAFT, createdBy: creator.userId } })).resolves.toBeDefined();
    // CHECKPOINT published (same subject) → allowed (not DIAGNOSTIC)
    await expect(prisma.assessmentDefinition.create({ data: { subjectId: c1.subjectId, purposeScope: AssessmentPurposeScope.CHECKPOINT, title: 'C', status: ContainerStatus.PUBLISHED, createdBy: creator.userId } })).resolves.toBeDefined();
  });

  it('§13/24 lifecycle guards: wrong current item → 409; completed attempt rejects a never-answered item → 409', async () => {
    const { token, userId } = await makeLearner('+998900000219');
    const { subjectId, trackId, skillId } = await makeContent(userId);
    const intent = await makeIntent(userId, subjectId, trackId);
    const seed = await seedDefinition(userId, subjectId, { items: [{ skillId, difficulty: 3, payload: scPayload() }, { skillId, difficulty: 4, payload: scPayload() }], config: config({ itemsPerSkill: 1, maxItems: 1 }) });
    const started = await start(token, intent.id);
    const attemptId = started.body.attemptId;
    const presentedItem = started.body.item.id;
    const otherItem = seed.poolItemIds.find((id) => id !== presentedItem)!;

    const wrong = await submit(token, attemptId, otherItem, { selectedOptionId: 'a' });
    expect(wrong.status).toBe(409);
    expect(wrong.body.code).toBe('ASSESSMENT_ITEM_NOT_CURRENT');

    expect((await submit(token, attemptId, presentedItem, { selectedOptionId: 'a' })).body.status).toBe('COMPLETED');
    const after = await submit(token, attemptId, otherItem, { selectedOptionId: 'a' });
    expect(after.status).toBe(409);
    expect(after.body.code).toBe('ASSESSMENT_ALREADY_COMPLETED');
  });

  it('§26/57 injected score fields rejected', async () => {
    const { token, userId } = await makeLearner('+998900000220');
    const { subjectId, trackId, skillId } = await makeContent(userId);
    const intent = await makeIntent(userId, subjectId, trackId);
    await seedDefinition(userId, subjectId, { items: [{ skillId, difficulty: 3, payload: scPayload() }], config: config({ itemsPerSkill: 1, maxItems: 1 }) });
    const started = await start(token, intent.id);
    const attemptId = started.body.attemptId;
    const itemId = started.body.item.id;
    const top = await request(server()).post(`/api/assessments/attempts/${attemptId}/responses`).set('Authorization', `Bearer ${token}`).send({ itemId, answer: { selectedOptionId: 'a' }, score: 10000 });
    expect(top.status).toBe(400);
    const nested = await submit(token, attemptId, itemId, { selectedOptionId: 'a', isCorrect: true });
    expect(nested.status).toBe(400);
    expect(nested.body.code).toBe('ASSESSMENT_INVALID_RESPONSE');
  });

  it('gates: onboarding incomplete → 409; no published diagnostic → 404 + availability false', async () => {
    const noOnb = await makeLearner('+998900000221');
    await prisma.userProfile.update({ where: { userId: noOnb.userId }, data: { onboardingCompletedAt: null } });
    const c1 = await makeContent(noOnb.userId);
    const i1 = await makeIntent(noOnb.userId, c1.subjectId, c1.trackId);
    await seedDefinition(noOnb.userId, c1.subjectId, { items: [{ skillId: c1.skillId, difficulty: 3, payload: scPayload() }], config: config({ itemsPerSkill: 1, maxItems: 1 }) });
    const incomplete = await start(noOnb.token, i1.id);
    expect(incomplete.status).toBe(409);
    expect(incomplete.body.code).toBe('ONBOARDING_INCOMPLETE');

    const learner = await makeLearner('+998900000222');
    const c2 = await makeContent(learner.userId);
    const i2 = await makeIntent(learner.userId, c2.subjectId, c2.trackId);
    const started = await start(learner.token, i2.id);
    expect(started.status).toBe(404);
    expect(started.body.code).toBe('ASSESSMENT_NOT_AVAILABLE');
    expect((await request(server()).get(`/api/assessments/placement/availability?learningIntentId=${i2.id}`).set('Authorization', `Bearer ${learner.token}`)).body).toEqual({ available: false });
  });

  it('requires authentication', async () => {
    expect((await request(server()).post('/api/assessments/placement/start').send({ learningIntentId: '00000000-0000-0000-0000-000000000000' })).status).toBe(401);
  });
});
