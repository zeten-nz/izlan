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
import { SKILL_PROFILE_DIAGNOSTIC_VERSION } from '../src/skill-profile/derivation/diagnostic-profile.types';

describe('Skill profile (e2e, izlan_test)', () => {
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

  async function makeLearner(phone: string): Promise<{ token: string; userId: string }> {
    await prisma.otpChallenge.updateMany({ where: { phone }, data: { createdAt: new Date(Date.now() - 300_000) } });
    const req = await request(server()).post('/api/auth/otp/request').send({ phone });
    const verify = await request(server()).post('/api/auth/otp/verify').send({ challengeId: req.body.challengeId, code: sms.latestCode() });
    const user = await prisma.user.findUnique({ where: { phone } });
    await prisma.userProfile.update({ where: { userId: user!.id }, data: { displayName: 'A', dateOfBirth: new Date('2005-01-01'), timezone: 'Asia/Tashkent', onboardingCompletedAt: new Date() } });
    return { token: verify.body.accessToken, userId: user!.id };
  }

  const makeSubjectTrack = async (creatorId: string) => {
    const s = await prisma.subject.create({ data: { slug: `s-${uid()}`, title: 'English', status: ContainerStatus.PUBLISHED, sortOrder: 1, createdBy: creatorId } });
    const t = await prisma.track.create({ data: { subjectId: s.id, slug: `t-${uid()}`, title: 'IELTS', status: ContainerStatus.PUBLISHED, sortOrder: 1, createdBy: creatorId } });
    return { subjectId: s.id, trackId: t.id };
  };
  const makeSkill = async (subjectId: string, name: string, sortOrder = 0) => (await prisma.skill.create({ data: { subjectId, name: `${name}-${uid()}`, sortOrder } })).id;
  const makeIntent = (userId: string, subjectId: string, trackId: string) => prisma.learnerLearningIntent.create({ data: { userId, subjectId, trackId } });

  const scPayload = (correct = 'a') => ({
    schemaVersion: PLACEMENT_ITEM_SCHEMA_VERSION, format: 'single_choice', prompt: 'Choose',
    options: [{ id: 'a', text: 'Alpha' }, { id: 'b', text: 'Beta' }], answerKey: { correctOptionIds: [correct] },
  });
  const config = (over: { itemsPerSkill?: number; maxItems?: number } = {}) => ({
    schemaVersion: PLACEMENT_CONFIG_SCHEMA_VERSION, engine: PLACEMENT_ENGINE_VERSION,
    selection: { startDifficulty: 3, stepUp: 1, stepDown: 1 },
    coverage: { itemsPerSkill: over.itemsPerSkill ?? 1 },
    stopping: { maxItems: over.maxItems ?? 10 },
    profileScale: { minDifficulty: 1, maxDifficulty: 6 },
  });

  interface SeedItem { skillId: string; difficulty: number; payload?: object }
  async function seedDefinition(creatorId: string, subjectId: string, opts: { items: SeedItem[]; config: object }) {
    const def = await prisma.assessmentDefinition.create({ data: { subjectId, purposeScope: AssessmentPurposeScope.DIAGNOSTIC, title: 'Placement', status: ContainerStatus.PUBLISHED, createdBy: creatorId } });
    const version = await prisma.assessmentDefinitionVersion.create({ data: { definitionId: def.id, versionNo: 1, config: opts.config as object, status: RevisionStatus.PUBLISHED, createdBy: creatorId, publishedAt: new Date() } });
    await prisma.assessmentDefinition.update({ where: { id: def.id }, data: { currentVersionId: version.id } });
    for (const it of opts.items) {
      const item = await prisma.assessmentItem.create({ data: { definitionId: def.id, type: ActivityType.MINI_QUESTION, payload: it.payload ?? scPayload(), skillId: it.skillId, difficulty: it.difficulty, status: RevisionStatus.PUBLISHED, source: ContentSource.HUMAN } });
      await prisma.assessmentVersionItem.create({ data: { versionId: version.id, itemId: item.id } });
    }
  }

  const start = (token: string, intentId: string) => request(server()).post('/api/assessments/placement/start').set('Authorization', `Bearer ${token}`).send({ learningIntentId: intentId });
  const submit = (token: string, id: string, itemId: string, answer: object) => request(server()).post(`/api/assessments/attempts/${id}/responses`).set('Authorization', `Bearer ${token}`).send({ itemId, answer });
  async function driveToComplete(token: string, intentId: string): Promise<string> {
    let view = (await start(token, intentId)).body;
    const attemptId = view.attemptId;
    while (view.status === 'IN_PROGRESS') view = (await submit(token, attemptId, view.item.id, { selectedOptionId: 'a' })).body;
    return attemptId;
  }
  const getProfile = (token: string, subjectId: string) => request(server()).get(`/api/skill-profile/me/subjects/${subjectId}`).set('Authorization', `Bearer ${token}`);
  const getSnapshot = (token: string, attemptId: string) => request(server()).get(`/api/skill-profile/diagnostics/${attemptId}`).set('Authorization', `Bearer ${token}`);
  const derive = (token: string, attemptId: string) => request(server()).post(`/api/skill-profile/diagnostics/${attemptId}/derive`).set('Authorization', `Bearer ${token}`);

  /** Full setup: two skills (high/low difficulty), completed diagnostic, auto-derived. */
  async function completedDiagnostic(phone: string) {
    const { token, userId } = await makeLearner(phone);
    const { subjectId, trackId } = await makeSubjectTrack(userId);
    const skHigh = await makeSkill(subjectId, 'Grammar', 1);
    const skLow = await makeSkill(subjectId, 'Reading', 2);
    const intent = await makeIntent(userId, subjectId, trackId);
    await seedDefinition(userId, subjectId, { items: [{ skillId: skHigh, difficulty: 5 }, { skillId: skLow, difficulty: 1 }], config: config({ itemsPerSkill: 1, maxItems: 2 }) });
    const attemptId = await driveToComplete(token, intent.id);
    return { token, userId, subjectId, attemptId, skHigh, skLow };
  }

  // ─────────────────────────────────────────────────────────────────────────

  it('§56 auto-derivation: completing a diagnostic materializes SkillMeasurement + LearnerSkillState (no manual derive)', async () => {
    const { token, userId, subjectId, attemptId, skHigh, skLow } = await completedDiagnostic('+998900000301');

    // measurements exist, exact attempt link (§50)
    const measurements = await prisma.skillMeasurement.findMany({ where: { attemptId } });
    expect(measurements).toHaveLength(2);
    expect(measurements.every((m) => m.source === 'DIAGNOSTIC' && m.attemptId === attemptId && m.derivationVersion === SKILL_PROFILE_DIAGNOSTIC_VERSION && m.lessonId === null && m.displayLevel === null)).toBe(true);

    // current state exists per skill
    expect(await prisma.learnerSkillState.count({ where: { userId } })).toBe(2);

    // difficulty-sensitive mastery: high-difficulty skill > low-difficulty skill
    const high = await prisma.learnerSkillState.findUnique({ where: { userId_skillId: { userId, skillId: skHigh } } });
    const low = await prisma.learnerSkillState.findUnique({ where: { userId_skillId: { userId, skillId: skLow } } });
    expect(high!.masteryScoreBp).toBe(8000); // difficulty 5 on [1,6]
    expect(low!.masteryScoreBp).toBe(0); // difficulty 1 = min
    expect(high!.confidenceBp).toBe(10000);
    expect(high!.evidenceCount).toBe(1);
    expect(high!.displayLevel).toBeNull();

    // API view
    const profile = await getProfile(token, subjectId);
    expect(profile.status).toBe(200);
    expect(profile.body.subject).toMatchObject({ id: subjectId, title: 'English' });
    expect(profile.body.skills).toHaveLength(2);
    expect(profile.body.skills.every((s: { displayLevel: unknown }) => s.displayLevel === null)).toBe(true);

    // No downstream side-effects (§64/65/66)
    expect(await prisma.learnerRoadmap.count({ where: { userId } })).toBe(0);
    expect(await prisma.learnerSignal.count({ where: { userId } })).toBe(0);
    expect(await prisma.xpGrant.count({ where: { userId } })).toBe(0);
    expect(await prisma.aiEvaluation.count()).toBe(0);
  });

  it('§55 profile/snapshot APIs: own access; other user 404; no auth 401; no answer-key/engine leak', async () => {
    const { token, subjectId, attemptId } = await completedDiagnostic('+998900000302');
    const snap = await getSnapshot(token, attemptId);
    expect(snap.status).toBe(200);
    expect(snap.body).toMatchObject({ attemptId, derivationVersion: SKILL_PROFILE_DIAGNOSTIC_VERSION });
    expect(snap.body.skills[0]).toHaveProperty('masteryScoreBp');
    for (const body of [(await getProfile(token, subjectId)).body, snap.body]) {
      const json = JSON.stringify(body);
      for (const leak of ['answerKey', 'correctOptionIds', 'engineState', 'selectedOptionId', 'phone']) expect(json).not.toContain(leak);
    }

    const attacker = await makeLearner('+998900000303');
    expect((await getSnapshot(attacker.token, attemptId)).status).toBe(404);
    expect((await request(server()).get(`/api/skill-profile/diagnostics/${attemptId}`)).status).toBe(401);
    expect((await request(server()).get(`/api/skill-profile/me/subjects/${subjectId}`)).status).toBe(401);
  });

  it('§51 append-only: re-deriving does not create or update SkillMeasurement rows', async () => {
    const { token, attemptId } = await completedDiagnostic('+998900000304');
    const before = await prisma.skillMeasurement.findMany({ where: { attemptId }, orderBy: { skillId: 'asc' } });
    expect(before).toHaveLength(2);

    const again = await derive(token, attemptId);
    expect(again.status).toBe(200);
    const after = await prisma.skillMeasurement.findMany({ where: { attemptId }, orderBy: { skillId: 'asc' } });
    expect(after).toHaveLength(2); // no new rows
    expect(after.map((m) => m.id)).toEqual(before.map((m) => m.id)); // same rows
    expect(after.map((m) => m.scoreBp)).toEqual(before.map((m) => m.scoreBp)); // values unchanged
  });

  it('§52 concurrent derive: parallel derivation yields one measurement per skill (no duplicates)', async () => {
    const { token, userId, attemptId } = await completedDiagnostic('+998900000305');
    // clear the auto-derived output, then race two derivations against the empty state
    await prisma.skillMeasurement.deleteMany({ where: { attemptId } });
    await prisma.learnerSkillState.deleteMany({ where: { userId } });

    const [r1, r2] = await Promise.all([derive(token, attemptId), derive(token, attemptId)]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect(await prisma.skillMeasurement.count({ where: { attemptId } })).toBe(2); // no duplicates
    expect(await prisma.learnerSkillState.count({ where: { userId } })).toBe(2);
  });

  it('§53/§30 current state is a projection of measurement history — a poked value is rebuilt by merge-v1 on recompute', async () => {
    const { token, userId, attemptId, skHigh } = await completedDiagnostic('+998900000306');
    const attempt = await prisma.assessmentAttempt.findUnique({ where: { id: attemptId } });
    const derived = await prisma.learnerSkillState.findUnique({ where: { userId_skillId: { userId, skillId: skHigh } } });
    const diagMastery = derived!.masteryScoreBp; // = merge of the single DIAGNOSTIC milestone

    // Manually poke a fabricated "newer" state that has NO backing measurement (processing time ≠ evidence).
    const newer = new Date(attempt!.completedAt!.getTime() + 86_400_000);
    await prisma.learnerSkillState.update({ where: { userId_skillId: { userId, skillId: skHigh } }, data: { masteryScoreBp: 9999, lastMeasurementAt: newer } });

    // Re-derive the attempt → recompute-from-scratch (§30) overwrites the poked value with the merge of real history.
    expect((await derive(token, attemptId)).status).toBe(200);
    const state = await prisma.learnerSkillState.findUnique({ where: { userId_skillId: { userId, skillId: skHigh } } });
    expect(state!.masteryScoreBp).toBe(diagMastery); // NOT 9999 — history governs, not a poked cache value
    expect(state!.lastMeasurementAt!.getTime()).toBe(attempt!.completedAt!.getTime()); // = observedAt of the diagnostic milestone
    // Append-only history unchanged (idempotent re-derive).
    expect(await prisma.skillMeasurement.count({ where: { attemptId, skillId: skHigh } })).toBe(1);
  });

  it('§54 subject scope: cross-subject evidence fails derivation with no writes (L-3)', async () => {
    const { token, userId } = await makeLearner('+998900000307');
    const { subjectId, trackId } = await makeSubjectTrack(userId);
    const otherSubject = await makeSubjectTrack(userId); // a different subject
    const foreignSkill = await makeSkill(otherSubject.subjectId, 'Foreign', 1); // skill in the OTHER subject
    const intent = await makeIntent(userId, subjectId, trackId);
    // Diagnostic on `subjectId` but its pooled item's skill belongs to `otherSubject` (corrupt fixture).
    await seedDefinition(userId, subjectId, { items: [{ skillId: foreignSkill, difficulty: 3 }], config: config({ itemsPerSkill: 1, maxItems: 1 }) });
    const attemptId = await driveToComplete(token, intent.id); // completes; auto-derive fails silently

    // Explicit derive surfaces the scope violation.
    const res = await derive(token, attemptId);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ASSESSMENT_CONFIGURATION_INVALID');
    // No measurement / state written.
    expect(await prisma.skillMeasurement.count({ where: { attemptId } })).toBe(0);
    expect(await prisma.learnerSkillState.count({ where: { userId } })).toBe(0);
  });

  it('§15 derivationVersion DB integrity: NULL rejected (NOT NULL), empty rejected (CHECK), valid accepted', async () => {
    const { userId, skHigh, attemptId } = await completedDiagnostic('+998900000309');
    // The auto-derived row carries the frozen version.
    const derived = await prisma.skillMeasurement.findFirst({ where: { attemptId, skillId: skHigh } });
    expect(derived!.derivationVersion).toBe(SKILL_PROFILE_DIAGNOSTIC_VERSION);

    const base = `INSERT INTO skill_measurement (id, user_id, skill_id, source, score_bp, evidence_count, observed_at`;
    const vals = `gen_random_uuid(), '${userId}'::uuid, '${skHigh}'::uuid, 'DIAGNOSTIC', 5000, 1, now()`;
    // NULL derivation_version (column omitted, no default) → NOT NULL violation.
    await expect(prisma.$executeRawUnsafe(`${base}) VALUES (${vals})`)).rejects.toThrow();
    // Empty derivation_version → non-empty CHECK violation.
    await expect(prisma.$executeRawUnsafe(`${base}, derivation_version) VALUES (${vals}, '')`)).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`${base}, derivation_version) VALUES (${vals}, '   ')`)).rejects.toThrow();
    // A real derivation version is accepted.
    await expect(prisma.$executeRawUnsafe(`${base}, derivation_version) VALUES (${vals}, 'lesson-mastery-v1')`)).resolves.toBeDefined();
  });

  it('snapshot before derivation → 409 SKILL_PROFILE_NOT_DERIVED', async () => {
    const { token, userId, attemptId } = await completedDiagnostic('+998900000308');
    await prisma.skillMeasurement.deleteMany({ where: { attemptId } });
    await prisma.learnerSkillState.deleteMany({ where: { userId } });
    const snap = await getSnapshot(token, attemptId);
    expect(snap.status).toBe(409);
    expect(snap.body.code).toBe('SKILL_PROFILE_NOT_DERIVED');
  });
});
