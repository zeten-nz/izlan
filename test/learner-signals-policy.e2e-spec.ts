import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ContainerStatus, SkillMeasurementSource } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AuthorizationRepository } from '../src/authorization/authorization.repository';
import { AuthExceptionFilter } from '../src/auth/http/auth-exception.filter';
import { SMS_PORT } from '../src/sms/sms.port';
import { Clock } from '../src/common/clock';
import { bootstrapSystemRoles } from '../src/bootstrap/system-roles';
import { cleanupAuthTables } from './test-db.helper';
import { TestSmsAdapter } from './test-sms.adapter';

/** WEAK_SKILL + REVIEW_DUE policies (Phase 1.8C). State/measurements seeded directly; fixed clock. */
describe('Learner signals — weak skill + review due (e2e, izlan_test)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  const sms = new TestSmsAdapter();
  const T0 = new Date('2026-08-20T00:00:00.000Z');
  const clock = { current: new Date(T0), now() { return this.current; } };
  const DAY = 24 * 60 * 60 * 1000;
  const at = (ms: number) => new Date(T0.getTime() + ms);
  let n = 0;
  let so = 0;
  const uid = () => `${Date.now()}-${n++}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(SMS_PORT).useValue(sms).overrideProvider(Clock).useValue(clock).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AuthExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = moduleRef.get(PrismaService);
    await reset();
    await prisma.role.deleteMany();
    await bootstrapSystemRoles(moduleRef.get(AuthorizationRepository));
  });
  afterAll(async () => { await reset(); await app.close(); });
  beforeEach(async () => { await reset(); sms.clear(); clock.current = new Date(T0); });

  async function reset() {
    await prisma.learnerSignal.deleteMany();
    await prisma.skillMeasurement.deleteMany();
    await prisma.learnerSkillState.deleteMany();
    await prisma.skill.deleteMany();
    await prisma.subject.deleteMany();
    await cleanupAuthTables(prisma);
  }
  const server = () => app.getHttpServer();

  async function makeLearner(phone: string) {
    await prisma.otpChallenge.updateMany({ where: { phone }, data: { createdAt: new Date(Date.now() - 300_000) } });
    const req = await request(server()).post('/api/auth/otp/request').send({ phone });
    const verify = await request(server()).post('/api/auth/otp/verify').send({ challengeId: req.body.challengeId, code: sms.latestCode() });
    const user = await prisma.user.findUnique({ where: { phone } });
    return { token: verify.body.accessToken, userId: user!.id };
  }
  const makeSubject = (creatorId: string) => prisma.subject.create({ data: { slug: `s-${uid()}`, title: 'Subj', status: ContainerStatus.PUBLISHED, sortOrder: so++, createdBy: creatorId } }).then((s) => s.id);
  const makeSkill = (subjectId: string, name: string) => prisma.skill.create({ data: { subjectId, name: `${name}-${uid()}`, sortOrder: so++ } }).then((s) => s.id);
  const seedState = (userId: string, skillId: string, masteryScoreBp: number, confidenceBp: number, evidenceCount: number, lastMeasurementAt: Date | null) =>
    prisma.learnerSkillState.create({ data: { userId, skillId, masteryScoreBp, confidenceBp, evidenceCount, lastMeasurementAt, displayLevel: null } });
  const setState = (userId: string, skillId: string, data: { masteryScoreBp?: number; confidenceBp?: number; evidenceCount?: number; lastMeasurementAt?: Date }) =>
    prisma.learnerSkillState.update({ where: { userId_skillId: { userId, skillId } }, data });
  const seedMeasure = (userId: string, skillId: string, source: SkillMeasurementSource, scoreBp: number, confidenceBp: number, evidenceCount: number, observedAt: Date, derivationVersion = 'v1') =>
    prisma.skillMeasurement.create({ data: { userId, skillId, source, scoreBp, confidenceBp, evidenceCount, observedAt, derivationVersion, displayLevel: null } });

  const reconcile = (token: string, subjectId: string) => request(server()).post(`/api/learner-signals/me/subjects/${subjectId}/reconcile`).set('Authorization', `Bearer ${token}`);
  const listSignals = (token: string, subjectId: string) => request(server()).get(`/api/learner-signals/me/subjects/${subjectId}`).set('Authorization', `Bearer ${token}`);
  const recomputeLP = (token: string, subjectId: string) => request(server()).post(`/api/learning-progress/me/subjects/${subjectId}/recompute`).set('Authorization', `Bearer ${token}`);
  const activeCount = (userId: string, type: string, skillId?: string) => prisma.learnerSignal.count({ where: { userId, status: 'ACTIVE', type, ...(skillId ? { skillId } : {}) } });
  const types = (body: { signals: { type: string }[] }) => body.signals.map((s) => s.type).sort();

  // ───────────────────────────────────────────────────────────────────────────

  it('§37/§42/§44 WEAK_SKILL activate → resolve (hysteresis) → recurrence (new episode)', async () => {
    const { token, userId } = await makeLearner('+998900002001');
    const subjectId = await makeSubject(userId);
    const sk = await makeSkill(subjectId, 'Grammar');
    await seedState(userId, sk, 4000, 10000, 3, at(0)); // mastery<5000, conf>=7000, count>=3

    expect(types((await reconcile(token, subjectId)).body)).toContain('WEAK_SKILL');
    expect(await activeCount(userId, 'WEAK_SKILL', sk)).toBe(1);

    // §9 hold band 5000..6499 → stays ACTIVE
    await setState(userId, sk, { masteryScoreBp: 6000 });
    await reconcile(token, subjectId);
    expect(await activeCount(userId, 'WEAK_SKILL', sk)).toBe(1);

    // §42 resolve at >=6500 with conf>=7000
    await setState(userId, sk, { masteryScoreBp: 6500, confidenceBp: 7000 });
    await reconcile(token, subjectId);
    expect(await activeCount(userId, 'WEAK_SKILL', sk)).toBe(0);
    expect(await prisma.learnerSignal.count({ where: { userId, type: 'WEAK_SKILL', status: 'RESOLVED' } })).toBe(1);

    // §44 recurrence → new episode
    await setState(userId, sk, { masteryScoreBp: 4000, confidenceBp: 10000 });
    await reconcile(token, subjectId);
    expect(await activeCount(userId, 'WEAK_SKILL', sk)).toBe(1);
    expect(await prisma.learnerSignal.count({ where: { userId, type: 'WEAK_SKILL', skillId: sk } })).toBe(2);
  });

  it('§38/§39/§40/§43 WEAK_SKILL gates: confidence, evidence, exact threshold, resolve-confidence', async () => {
    const { token, userId } = await makeLearner('+998900002002');
    const subjectId = await makeSubject(userId);
    const s1 = await makeSkill(subjectId, 'A');
    const s2 = await makeSkill(subjectId, 'B');
    const s3 = await makeSkill(subjectId, 'C');
    await seedState(userId, s1, 2000, 6999, 10, at(0)); // §38 conf gate
    await seedState(userId, s2, 2000, 10000, 2, at(0)); // §39 evidence gate
    await seedState(userId, s3, 5000, 10000, 10, at(0)); // §40 exact threshold (not < 5000)
    await reconcile(token, subjectId);
    expect(await activeCount(userId, 'WEAK_SKILL')).toBe(0);

    // §43 active but resolve needs conf>=7000: 9000/6999 stays active
    await prisma.learnerSignal.create({ data: { userId, subjectId, skillId: s1, type: 'WEAK_SKILL', status: 'ACTIVE', evidenceRefs: { schemaVersion: 'weak-skill-signal/v1' } } });
    await setState(userId, s1, { masteryScoreBp: 9000, confidenceBp: 6999 });
    await reconcile(token, subjectId);
    expect(await activeCount(userId, 'WEAK_SKILL', s1)).toBe(1);
  });

  it('§45/§50 REVIEW_DUE activates only when elapsed time reaches dueAt (exact due inclusive)', async () => {
    const { token, userId } = await makeLearner('+998900002003');
    const subjectId = await makeSubject(userId);
    const sk = await makeSkill(subjectId, 'Grammar');
    await seedState(userId, sk, 9000, 4999, 5, at(0)); // conf<5000 → 1-day interval

    clock.current = at(DAY - 60_000); // +23h59m
    await reconcile(token, subjectId);
    expect(await activeCount(userId, 'REVIEW_DUE', sk)).toBe(0);

    clock.current = at(DAY); // exact due
    await reconcile(token, subjectId);
    expect(await activeCount(userId, 'REVIEW_DUE', sk)).toBe(1);
    const sig = await prisma.learnerSignal.findFirst({ where: { userId, type: 'REVIEW_DUE', skillId: sk } });
    expect((sig!.evidenceRefs as { intervalDays: number }).intervalDays).toBe(1);
  });

  it('§47/§48/§49 REVIEW_DUE interval bands (3/7/14 days) via dueAt timing', async () => {
    const { token, userId } = await makeLearner('+998900002004');
    const subjectId = await makeSubject(userId);
    const med = await makeSkill(subjectId, 'Med');
    const good = await makeSkill(subjectId, 'Good');
    const strong = await makeSkill(subjectId, 'Strong');
    await seedState(userId, med, 6000, 10000, 5, at(0)); // 3 days
    await seedState(userId, good, 8000, 10000, 5, at(0)); // 7 days
    await seedState(userId, strong, 9000, 10000, 5, at(0)); // 14 days

    clock.current = at(3 * DAY); // med due, good/strong not
    await reconcile(token, subjectId);
    expect(await activeCount(userId, 'REVIEW_DUE', med)).toBe(1);
    expect(await activeCount(userId, 'REVIEW_DUE', good)).toBe(0);
    expect(await activeCount(userId, 'REVIEW_DUE', strong)).toBe(0);

    clock.current = at(7 * DAY);
    await reconcile(token, subjectId);
    expect(await activeCount(userId, 'REVIEW_DUE', good)).toBe(1);
    expect(await activeCount(userId, 'REVIEW_DUE', strong)).toBe(0);

    clock.current = at(14 * DAY);
    await reconcile(token, subjectId);
    expect(await activeCount(userId, 'REVIEW_DUE', strong)).toBe(1);
  });

  it('§51/§52/§53/§54 REVIEW_DUE no-state; newer evidence resolves; same-timestamp holds; recurrence', async () => {
    const { token, userId } = await makeLearner('+998900002005');
    const subjectId = await makeSubject(userId);
    const sk = await makeSkill(subjectId, 'Grammar');

    // §51 no state → reconcile → no review
    clock.current = at(100 * DAY);
    await reconcile(token, subjectId);
    expect(await prisma.learnerSignal.count({ where: { userId } })).toBe(0);

    await seedState(userId, sk, 9000, 10000, 5, at(0)); // 14-day interval
    clock.current = at(14 * DAY);
    await reconcile(token, subjectId);
    expect(await activeCount(userId, 'REVIEW_DUE', sk)).toBe(1);

    // §53 same logical timestamp → stays ACTIVE
    await reconcile(token, subjectId);
    expect(await activeCount(userId, 'REVIEW_DUE', sk)).toBe(1);

    // §52 newer lastMeasurementAt → RESOLVED
    await setState(userId, sk, { lastMeasurementAt: at(14 * DAY), masteryScoreBp: 9000 });
    await reconcile(token, subjectId);
    expect(await activeCount(userId, 'REVIEW_DUE', sk)).toBe(0);
    expect(await prisma.learnerSignal.count({ where: { userId, type: 'REVIEW_DUE', status: 'RESOLVED' } })).toBe(1);

    // §54 recurrence: advance past new dueAt (14d from at(14d)) → new episode
    clock.current = at(28 * DAY);
    await reconcile(token, subjectId);
    expect(await activeCount(userId, 'REVIEW_DUE', sk)).toBe(1);
    expect(await prisma.learnerSignal.count({ where: { userId, type: 'REVIEW_DUE', skillId: sk } })).toBe(2);
  });

  it('§56/§57 WEAK_SKILL and REVIEW_DUE coexist independently for the same skill', async () => {
    const { token, userId } = await makeLearner('+998900002006');
    const subjectId = await makeSubject(userId);
    const sk = await makeSkill(subjectId, 'Grammar');
    await seedState(userId, sk, 4000, 10000, 3, at(0)); // weak + 1-day review interval
    clock.current = at(2 * DAY);
    const body = (await reconcile(token, subjectId)).body;
    expect(types(body)).toEqual(['REVIEW_DUE', 'WEAK_SKILL']);
    expect(await activeCount(userId, 'WEAK_SKILL', sk)).toBe(1);
    expect(await activeCount(userId, 'REVIEW_DUE', sk)).toBe(1);
  });

  it('§58/§59/§60 concurrent reconcile → one WEAK_SKILL and one REVIEW_DUE (partial unique authority)', async () => {
    const { token, userId } = await makeLearner('+998900002007');
    const subjectId = await makeSubject(userId);
    const sk = await makeSkill(subjectId, 'Grammar');
    await seedState(userId, sk, 4000, 10000, 3, at(0));
    clock.current = at(2 * DAY);
    const [a, b] = await Promise.all([reconcile(token, subjectId), reconcile(token, subjectId)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await activeCount(userId, 'WEAK_SKILL', sk)).toBe(1);
    expect(await activeCount(userId, 'REVIEW_DUE', sk)).toBe(1);
  });

  it('§61/§33 reconcile creates due review; GET is read-only (never creates on time elapsed)', async () => {
    const { token, userId } = await makeLearner('+998900002008');
    const subjectId = await makeSubject(userId);
    const sk = await makeSkill(subjectId, 'Grammar');
    await seedState(userId, sk, 9000, 10000, 5, at(0)); // 14 days
    clock.current = at(20 * DAY); // already past due

    // §33 GET must NOT create a signal even though time has elapsed
    expect((await listSignals(token, subjectId)).body.signals).toEqual([]);
    expect(await activeCount(userId, 'REVIEW_DUE', sk)).toBe(0);

    // §61 reconcile creates it; repeat is idempotent
    await reconcile(token, subjectId);
    expect(await activeCount(userId, 'REVIEW_DUE', sk)).toBe(1);
    await reconcile(token, subjectId);
    expect(await activeCount(userId, 'REVIEW_DUE', sk)).toBe(1);
  });

  it('§62 automatic WEAK_SKILL on merge recompute; §55 checkpoint reset resolves stale REVIEW_DUE', async () => {
    const { token, userId } = await makeLearner('+998900002009');
    const subjectId = await makeSubject(userId);
    const sk = await makeSkill(subjectId, 'Grammar');

    // §62 seed a weak DIAGNOSTIC measurement; the learning-progress recompute materializes state AND fires signals
    await seedMeasure(userId, sk, SkillMeasurementSource.DIAGNOSTIC, 4000, 10000, 3, at(0), 'skill-profile-diagnostic-v1');
    clock.current = at(2 * DAY);
    await recomputeLP(token, subjectId);
    expect(await activeCount(userId, 'WEAK_SKILL', sk)).toBe(1); // appeared automatically
    expect(await activeCount(userId, 'REVIEW_DUE', sk)).toBe(1); // 1-day interval, 2 days elapsed → due

    // §55 a later CHECKPOINT recalibrates state → lastMeasurementAt advances → stale REVIEW_DUE resolves automatically
    await seedMeasure(userId, sk, SkillMeasurementSource.CHECKPOINT, 9000, 10000, 5, at(2 * DAY), 'checkpoint-v1');
    await recomputeLP(token, subjectId);
    expect(await activeCount(userId, 'REVIEW_DUE', sk)).toBe(0); // resolved by newer evidence
    expect(await activeCount(userId, 'WEAK_SKILL', sk)).toBe(0); // mastery now 9000 → resolved
  });

  it('§63 automatic REVIEW_DUE resolution when newer lesson evidence updates state', async () => {
    const { token, userId } = await makeLearner('+998900002010');
    const subjectId = await makeSubject(userId);
    const sk = await makeSkill(subjectId, 'Grammar');
    await seedMeasure(userId, sk, SkillMeasurementSource.DIAGNOSTIC, 9000, 10000, 5, at(0), 'skill-profile-diagnostic-v1');
    clock.current = at(20 * DAY);
    await recomputeLP(token, subjectId); // state lastMeasurementAt=at(0); 14-day interval, due → REVIEW_DUE active
    expect(await activeCount(userId, 'REVIEW_DUE', sk)).toBe(1);

    // Newer LESSON_MASTERY evidence → recompute advances lastMeasurementAt → auto resolves review
    await seedMeasure(userId, sk, SkillMeasurementSource.LESSON_MASTERY, 9500, 10000, 1, at(20 * DAY), 'lesson-mastery-v1');
    await recomputeLP(token, subjectId);
    expect(await activeCount(userId, 'REVIEW_DUE', sk)).toBe(0); // resolved; SkillState was authoritative, not rolled back
    expect((await recomputeLP(token, subjectId)).status).toBe(200);
  });

  it('§64/§65/§66 read API + IDOR + no raw evidence leak + side-effect boundary', async () => {
    const { token, userId } = await makeLearner('+998900002011');
    const subjectId = await makeSubject(userId);
    const sk = await makeSkill(subjectId, 'Grammar');
    await seedState(userId, sk, 4000, 10000, 3, at(0));
    clock.current = at(2 * DAY);
    const before = { roadmaps: await prisma.learnerRoadmap.count(), plans: await prisma.dailyPlan.count(), rewards: await prisma.rewardGrant.count(), notes: await prisma.notification.count() };
    await reconcile(token, subjectId);

    const list = await listSignals(token, subjectId);
    expect(types(list.body)).toEqual(['REVIEW_DUE', 'WEAK_SKILL']);
    expect(list.body.signals[0]).not.toHaveProperty('evidenceRefs'); // §65 not exposed
    expect(JSON.stringify(list.body)).not.toMatch(/basisLastMeasurementAt|masteryScoreBp|dueAt/);

    // §66 boundary — signal work changed nothing else
    expect(await prisma.learnerRoadmap.count()).toBe(before.roadmaps);
    expect(await prisma.dailyPlan.count()).toBe(before.plans);
    expect(await prisma.rewardGrant.count()).toBe(before.rewards);
    expect(await prisma.notification.count()).toBe(before.notes);
    expect(await prisma.aiEvaluation.count()).toBe(0);
    expect(await prisma.skillMeasurement.count({ where: { userId } })).toBe(0);

    // §64 IDOR / 401
    const attacker = await makeLearner('+998900002012');
    expect((await listSignals(attacker.token, subjectId)).body.signals).toEqual([]);
    expect((await reconcile(attacker.token, subjectId)).body.signals).toEqual([]);
    expect(await activeCount(userId, 'WEAK_SKILL', sk)).toBe(1); // attacker did not touch victim
    expect((await request(server()).get(`/api/learner-signals/me/subjects/${subjectId}`)).status).toBe(401);
  });
});
