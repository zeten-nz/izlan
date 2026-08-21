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
import { bootstrapSystemRoles } from '../src/bootstrap/system-roles';
import { cleanupAuthTables } from './test-db.helper';
import { TestSmsAdapter } from './test-sms.adapter';

/** Direct SkillMeasurement seeding — exercises the merge engine + repair endpoint without full flows. */
describe('Learning progress merge (e2e, izlan_test)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  const sms = new TestSmsAdapter();
  let n = 0;
  let so = 0;
  const uid = () => `${Date.now()}-${n++}`;
  const t = (ms: number) => new Date(1_700_000_000_000 + ms);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(SMS_PORT).useValue(sms).compile();
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
  beforeEach(async () => { await reset(); sms.clear(); });

  async function reset() {
    await prisma.learnerSignal.deleteMany(); // advisory signals now created by recompute → clear before subject (RESTRICT)
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
  const measure = (userId: string, skillId: string, source: SkillMeasurementSource, scoreBp: number, confidenceBp: number, evidenceCount: number, observedAt: Date, derivationVersion = 'v1') =>
    prisma.skillMeasurement.create({ data: { userId, skillId, source, scoreBp, confidenceBp, evidenceCount, observedAt, derivationVersion, displayLevel: null } });
  const recompute = (token: string, subjectId: string) => request(server()).post(`/api/learning-progress/me/subjects/${subjectId}/recompute`).set('Authorization', `Bearer ${token}`);
  const stateOf = (userId: string, skillId: string) => prisma.learnerSkillState.findUnique({ where: { userId_skillId: { userId, skillId } } });

  // ───────────────────────────────────────────────────────────────────────────

  it('§54/§41 diagnostic-only recompute reproduces the diagnostic milestone exactly', async () => {
    const { token, userId } = await makeLearner('+998900000901');
    const subjectId = await makeSubject(userId);
    const sk = await makeSkill(subjectId, 'Grammar');
    await measure(userId, sk, SkillMeasurementSource.DIAGNOSTIC, 6000, 10000, 4, t(1000));

    const res = await recompute(token, subjectId);
    expect(res.status).toBe(200);
    expect(res.body.skills[0]).toMatchObject({ skillId: sk, masteryScoreBp: 6000, confidenceBp: 10000, evidenceCount: 4, displayLevel: null });
    const st = await stateOf(userId, sk);
    expect(st).toMatchObject({ masteryScoreBp: 6000, evidenceCount: 4 });
    expect(st!.lastMeasurementAt!.getTime()).toBe(t(1000).getTime());
  });

  it('§42 diagnostic + lesson merge; §45 a later CHECKPOINT resets the window (older evidence excluded, kept as history)', async () => {
    const { token, userId } = await makeLearner('+998900000902');
    const subjectId = await makeSubject(userId);
    const sk = await makeSkill(subjectId, 'Grammar');
    await measure(userId, sk, SkillMeasurementSource.DIAGNOSTIC, 6000, 10000, 4, t(1000));
    await measure(userId, sk, SkillMeasurementSource.LESSON_MASTERY, 9000, 10000, 1, t(2000));
    expect((await recompute(token, subjectId)).body.skills[0]).toMatchObject({ masteryScoreBp: 6600, evidenceCount: 5 });

    // Later CHECKPOINT recalibrates; a still-later lesson accumulates on top of it.
    await measure(userId, sk, SkillMeasurementSource.CHECKPOINT, 8000, 10000, 5, t(3000), 'checkpoint-v1');
    await measure(userId, sk, SkillMeasurementSource.LESSON_MASTERY, 10000, 10000, 1, t(4000));
    expect((await recompute(token, subjectId)).body.skills[0]).toMatchObject({ masteryScoreBp: 8333, evidenceCount: 6 });
    expect(await prisma.skillMeasurement.count({ where: { userId, skillId: sk } })).toBe(4); // all history preserved
  });

  it('§49 old backfill does not regress: a lesson observed BEFORE the anchor is excluded from the window', async () => {
    const { token, userId } = await makeLearner('+998900000903');
    const subjectId = await makeSubject(userId);
    const sk = await makeSkill(subjectId, 'Grammar');
    await measure(userId, sk, SkillMeasurementSource.DIAGNOSTIC, 6000, 10000, 4, t(5000)); // anchor
    await recompute(token, subjectId);
    const before = await stateOf(userId, sk);

    // Insert an OLDER lesson milestone (observedAt before the anchor) — processing time is "now" but it is old evidence.
    await measure(userId, sk, SkillMeasurementSource.LESSON_MASTERY, 10000, 10000, 3, t(1000));
    await recompute(token, subjectId);
    const after = await stateOf(userId, sk);
    expect(after!.masteryScoreBp).toBe(before!.masteryScoreBp); // unchanged — old evidence excluded
    expect(after!.evidenceCount).toBe(4);
  });

  it('§57 materialization recovery + §58 idempotency: repair builds state from existing measurements; repeat = stable, no new rows', async () => {
    const { token, userId } = await makeLearner('+998900000904');
    const subjectId = await makeSubject(userId);
    const sk = await makeSkill(subjectId, 'Grammar');
    await measure(userId, sk, SkillMeasurementSource.DIAGNOSTIC, 7000, 10000, 2, t(1000)); // measurement exists, state not materialized
    expect(await stateOf(userId, sk)).toBeNull();

    const r1 = await recompute(token, subjectId);
    expect(r1.status).toBe(200);
    expect((await stateOf(userId, sk))!.masteryScoreBp).toBe(7000);
    const measCount = await prisma.skillMeasurement.count({ where: { userId } });

    const r2 = await recompute(token, subjectId);
    expect(r2.body.skills[0]).toMatchObject({ masteryScoreBp: 7000, evidenceCount: 2 });
    expect(await prisma.skillMeasurement.count({ where: { userId } })).toBe(measCount); // recompute NEVER creates measurements
  });

  it('§59 subject scope: recomputing Subject A never consumes Subject B measurements', async () => {
    const { token, userId } = await makeLearner('+998900000905');
    const subjectA = await makeSubject(userId);
    const subjectB = await makeSubject(userId);
    const skA = await makeSkill(subjectA, 'A');
    const skB = await makeSkill(subjectB, 'B');
    await measure(userId, skA, SkillMeasurementSource.DIAGNOSTIC, 4000, 10000, 1, t(1000));
    await measure(userId, skB, SkillMeasurementSource.DIAGNOSTIC, 9000, 10000, 1, t(1000));

    const res = await recompute(token, subjectA);
    expect(res.body.skills.map((s: { skillId: string }) => s.skillId)).toEqual([skA]);
    expect(await stateOf(userId, skB)).toBeNull(); // Subject B untouched
  });

  it('§60 existing state with no supported measurements is NOT deleted', async () => {
    const { token, userId } = await makeLearner('+998900000906');
    const subjectId = await makeSubject(userId);
    const sk = await makeSkill(subjectId, 'Grammar');
    await measure(userId, sk, SkillMeasurementSource.DIAGNOSTIC, 5000, 10000, 1, t(1000));
    await recompute(token, subjectId); // materialize
    await prisma.skillMeasurement.deleteMany({ where: { userId, skillId: sk } }); // history now unsupported/empty

    const res = await recompute(token, subjectId);
    expect(res.status).toBe(200);
    expect(await stateOf(userId, sk)).not.toBeNull(); // preserved, not destroyed
  });

  it('§50 concurrent recompute of the same skill converges to one deterministic state', async () => {
    const { token, userId } = await makeLearner('+998900000907');
    const subjectId = await makeSubject(userId);
    const sk = await makeSkill(subjectId, 'Grammar');
    await measure(userId, sk, SkillMeasurementSource.DIAGNOSTIC, 6000, 10000, 4, t(1000));
    await measure(userId, sk, SkillMeasurementSource.LESSON_MASTERY, 9000, 10000, 1, t(2000));

    const [a, b] = await Promise.all([recompute(token, subjectId), recompute(token, subjectId)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await prisma.learnerSkillState.count({ where: { userId, skillId: sk } })).toBe(1);
    expect((await stateOf(userId, sk))!.masteryScoreBp).toBe(6600);
  });

  it('§52 different skills are recomputed independently (no cross-skill mixing)', async () => {
    const { token, userId } = await makeLearner('+998900000908');
    const subjectId = await makeSubject(userId);
    const g = await makeSkill(subjectId, 'Grammar');
    const r = await makeSkill(subjectId, 'Reading');
    await measure(userId, g, SkillMeasurementSource.DIAGNOSTIC, 3000, 10000, 1, t(1000));
    await measure(userId, r, SkillMeasurementSource.DIAGNOSTIC, 8000, 10000, 1, t(1000));

    await recompute(token, subjectId);
    expect((await stateOf(userId, g))!.masteryScoreBp).toBe(3000);
    expect((await stateOf(userId, r))!.masteryScoreBp).toBe(8000);
  });

  it('§71 security: recompute is own-user only; other user gets their own (empty) scope; no auth → 401', async () => {
    const { userId } = await makeLearner('+998900000909');
    const subjectId = await makeSubject(userId);
    const sk = await makeSkill(subjectId, 'Grammar');
    await measure(userId, sk, SkillMeasurementSource.DIAGNOSTIC, 6000, 10000, 4, t(1000));

    const attacker = await makeLearner('+998900000910');
    const res = await recompute(attacker.token, subjectId); // same subject, different principal
    expect(res.status).toBe(200);
    expect(res.body.skills).toEqual([]); // attacker has no measurements → no states
    expect(await stateOf(userId, sk)).toBeNull(); // victim's state was never materialized by the attacker's call

    expect((await request(server()).post(`/api/learning-progress/me/subjects/${subjectId}/recompute`)).status).toBe(401);
    expect((await request(server()).post(`/api/learning-progress/me/subjects/not-a-uuid/recompute`).set('Authorization', `Bearer ${attacker.token}`)).status).toBe(400);
  });
});
