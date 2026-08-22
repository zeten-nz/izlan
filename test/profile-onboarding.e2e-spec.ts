import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ContainerStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AuthorizationRepository } from '../src/authorization/authorization.repository';
import { AuthExceptionFilter } from '../src/auth/http/auth-exception.filter';
import { SMS_PORT } from '../src/sms/sms.port';
import { bootstrapSystemRoles } from '../src/bootstrap/system-roles';
import { cleanupAuthTables } from './test-db.helper';
import { TestSmsAdapter } from './test-sms.adapter';

describe('Profile + Onboarding (e2e, izlan_test)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  const sms = new TestSmsAdapter();
  const PHONE = '+998901234567';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(SMS_PORT).useValue(sms).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AuthExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = moduleRef.get(PrismaService);
    await prisma.learnerLearningIntent.deleteMany();
    await prisma.track.deleteMany();
    await prisma.subject.deleteMany();
    await cleanupAuthTables(prisma);
    await prisma.role.deleteMany();
    await bootstrapSystemRoles(moduleRef.get(AuthorizationRepository));
  });

  afterAll(async () => {
    await prisma.learnerLearningIntent.deleteMany();
    await prisma.track.deleteMany();
    await prisma.subject.deleteMany();
    await cleanupAuthTables(prisma);
    await app.close();
  });

  beforeEach(async () => {
    await prisma.learnerLearningIntent.deleteMany();
    await prisma.track.deleteMany();
    await prisma.subject.deleteMany();
    await cleanupAuthTables(prisma);
    sms.clear();
  });

  const server = () => app.getHttpServer();

  async function login(): Promise<{ token: string; userId: string }> {
    await prisma.otpChallenge.updateMany({ where: { phone: PHONE }, data: { createdAt: new Date(Date.now() - 300_000) } });
    const req = await request(server()).post('/api/auth/otp/request').send({ phone: PHONE });
    const verify = await request(server()).post('/api/auth/register').send({ challengeId: req.body.challengeId, code: sms.latestCode(), password: 'Passw0rd!123' });
    const user = await prisma.user.findUnique({ where: { phone: PHONE } });
    return { token: verify.body.accessToken, userId: user!.id };
  }

  // ── Profile ──
  it('GET /api/profile/me returns own profile without phone/roles/permissions', async () => {
    const { token } = await login();
    const res = await request(server()).get('/api/profile/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: expect.any(String), displayName: null, dateOfBirth: null, timezone: null, onboarding: { completed: false, completedAt: null } });
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(PHONE);
    expect(body).not.toMatch(/LEARNER|permission|token/i);
    expect(res.headers['cache-control']).toContain('no-store');
  });

  it('requires auth', async () => {
    expect((await request(server()).get('/api/profile/me')).status).toBe(401);
  });

  it('PATCH updates displayName, dateOfBirth, timezone (date-only, no shift)', async () => {
    const { token } = await login();
    const res = await request(server()).patch('/api/profile/me').set('Authorization', `Bearer ${token}`).send({
      displayName: '  Alisher Karimov  ', dateOfBirth: '2006-10-14', timezone: 'Asia/Tashkent', preferredLanguage: 'uz',
    });
    expect(res.status).toBe(200);
    expect(res.body.displayName).toBe('Alisher Karimov'); // trimmed
    expect(res.body.dateOfBirth).toBe('2006-10-14');
    expect(res.body.timezone).toBe('Asia/Tashkent');
    expect(res.body.preferredLanguage).toBe('uz');
  });

  it('rejects invalid timezone / DOB', async () => {
    const { token } = await login();
    const tz = await request(server()).patch('/api/profile/me').set('Authorization', `Bearer ${token}`).send({ timezone: 'GMT+5' });
    expect(tz.status).toBe(400);
    expect(tz.body.code).toBe('PROFILE_INVALID_TIMEZONE');
    const dob = await request(server()).patch('/api/profile/me').set('Authorization', `Bearer ${token}`).send({ dateOfBirth: '2007-02-30' });
    expect(dob.status).toBe(400);
    expect(dob.body.code).toBe('PROFILE_INVALID_DOB');
  });

  it('rejects mass assignment (status/role/id/phone) via forbidNonWhitelisted', async () => {
    const { token } = await login();
    for (const bad of [{ status: 'SUSPENDED' }, { id: 'x' }, { phone: '+998900000000' }, { onboardingCompletedAt: new Date().toISOString() }]) {
      const res = await request(server()).patch('/api/profile/me').set('Authorization', `Bearer ${token}`).send(bad);
      expect(res.status).toBe(400);
    }
  });

  it('empty displayName rejected; Unicode accepted', async () => {
    const { token } = await login();
    expect((await request(server()).patch('/api/profile/me').set('Authorization', `Bearer ${token}`).send({ displayName: '   ' })).status).toBe(400);
    const ok = await request(server()).patch('/api/profile/me').set('Authorization', `Bearer ${token}`).send({ displayName: 'Аҗдаҳо Каримова' });
    expect(ok.status).toBe(200);
    expect(ok.body.displayName).toBe('Аҗдаҳо Каримова');
  });

  // Content + intent tayyorlash helper
  async function seedSubjectTrack(creatorId: string): Promise<{ subjectId: string; trackId: string }> {
    const s = await prisma.subject.create({ data: { slug: `s-${Date.now()}`, title: 'English', status: ContainerStatus.PUBLISHED, sortOrder: 1, createdBy: creatorId } });
    const t = await prisma.track.create({ data: { subjectId: s.id, slug: `t-${Date.now()}`, title: 'IELTS', status: ContainerStatus.PUBLISHED, sortOrder: 1, createdBy: creatorId } });
    return { subjectId: s.id, trackId: t.id };
  }
  const setProfile = (token: string) =>
    request(server()).patch('/api/profile/me').set('Authorization', `Bearer ${token}`).send({ displayName: 'A', dateOfBirth: '2005-01-01', timezone: 'Asia/Tashkent' });
  const saveIntent = (token: string, subjectId: string, trackId?: string) =>
    request(server()).put('/api/onboarding/learning-intent').set('Authorization', `Bearer ${token}`).send(trackId ? { subjectId, trackId } : { subjectId });

  // ── Onboarding ──
  it('status flow: profile + learning intent required; complete idempotent first-write', async () => {
    const { token, userId } = await login();
    const s0 = await request(server()).get('/api/onboarding/status').set('Authorization', `Bearer ${token}`);
    expect(s0.body).toEqual({ completed: false, canComplete: false, missing: ['displayName', 'dateOfBirth', 'timezone', 'learningIntent'] });

    await setProfile(token);
    const s1 = await request(server()).get('/api/onboarding/status').set('Authorization', `Bearer ${token}`);
    expect(s1.body).toEqual({ completed: false, canComplete: false, missing: ['learningIntent'] }); // profile complete, intent yo'q

    // complete while intent missing → 409
    const early = await request(server()).post('/api/onboarding/complete').set('Authorization', `Bearer ${token}`);
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('PROFILE_INCOMPLETE');

    const { subjectId, trackId } = await seedSubjectTrack(userId);
    // subject-only intent → hali learningIntent missing (track yo'q)
    await saveIntent(token, subjectId);
    const sMid = await request(server()).get('/api/onboarding/status').set('Authorization', `Bearer ${token}`);
    expect(sMid.body.missing).toEqual(['learningIntent']);

    await saveIntent(token, subjectId, trackId); // to'liq intent
    const s2 = await request(server()).get('/api/onboarding/status').set('Authorization', `Bearer ${token}`);
    expect(s2.body).toEqual({ completed: false, canComplete: true, missing: [] });

    const c1 = await request(server()).post('/api/onboarding/complete').set('Authorization', `Bearer ${token}`);
    expect(c1.status).toBe(200);
    expect(c1.body.completed).toBe(true);
    const firstCompletedAt = c1.body.completedAt;
    const c2 = await request(server()).post('/api/onboarding/complete').set('Authorization', `Bearer ${token}`);
    expect(c2.body.completedAt).toBe(firstCompletedAt); // idempotent first-write
  });

  it('DOB cannot be changed after onboarding (safety restriction)', async () => {
    const { token, userId } = await login();
    await setProfile(token);
    const { subjectId, trackId } = await seedSubjectTrack(userId);
    await saveIntent(token, subjectId, trackId);
    await request(server()).post('/api/onboarding/complete').set('Authorization', `Bearer ${token}`);
    const res = await request(server()).patch('/api/profile/me').set('Authorization', `Bearer ${token}`).send({ dateOfBirth: '2004-01-01' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PROFILE_DOB_LOCKED');
    // displayName/timezone still editable
    expect((await request(server()).patch('/api/profile/me').set('Authorization', `Bearer ${token}`).send({ displayName: 'B', timezone: 'Europe/Berlin' })).status).toBe(200);
  });

  // ── Content discovery ──
  it('subjects: only PUBLISHED, deterministic order; tracks respect lifecycle + belong to subject', async () => {
    const { token, userId } = await login();
    const pub = await prisma.subject.create({ data: { slug: 'english', title: 'English', status: ContainerStatus.PUBLISHED, sortOrder: 1, createdBy: userId } });
    await prisma.subject.create({ data: { slug: 'draft-subj', title: 'Draft', status: ContainerStatus.DRAFT, sortOrder: 2, createdBy: userId } });
    await prisma.subject.create({ data: { slug: 'arch-subj', title: 'Archived', status: ContainerStatus.ARCHIVED, sortOrder: 3, createdBy: userId } });
    const other = await prisma.subject.create({ data: { slug: 'math', title: 'Math', status: ContainerStatus.PUBLISHED, sortOrder: 0, createdBy: userId } });
    // tracks under english
    await prisma.track.create({ data: { subjectId: pub.id, slug: 'general', title: 'General English', status: ContainerStatus.PUBLISHED, sortOrder: 1, createdBy: userId } });
    await prisma.track.create({ data: { subjectId: pub.id, slug: 'ielts-draft', title: 'IELTS', status: ContainerStatus.DRAFT, sortOrder: 2, createdBy: userId } });
    await prisma.track.create({ data: { subjectId: other.id, slug: 'algebra', title: 'Algebra', status: ContainerStatus.PUBLISHED, sortOrder: 1, createdBy: userId } });

    const subs = await request(server()).get('/api/onboarding/subjects').set('Authorization', `Bearer ${token}`);
    expect(subs.status).toBe(200);
    // only PUBLISHED (english, math); ordered by sortOrder (math=0 before english=1)
    expect(subs.body.map((s: { slug: string }) => s.slug)).toEqual(['math', 'english']);

    const tracks = await request(server()).get(`/api/onboarding/subjects/${pub.id}/tracks`).set('Authorization', `Bearer ${token}`);
    expect(tracks.status).toBe(200);
    // only PUBLISHED track of english; math's algebra NOT leaked
    expect(tracks.body.map((t: { slug: string }) => t.slug)).toEqual(['general']);
  });

  it('tracks of DRAFT/unknown subject → 404 (hidden content not revealed)', async () => {
    const { token, userId } = await login();
    const draft = await prisma.subject.create({ data: { slug: 'draft2', title: 'Draft', status: ContainerStatus.DRAFT, sortOrder: 1, createdBy: userId } });
    const res = await request(server()).get(`/api/onboarding/subjects/${draft.id}/tracks`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
    const unknown = await request(server()).get(`/api/onboarding/subjects/${draft.id.replace(/.$/, '0')}/tracks`).set('Authorization', `Bearer ${token}`);
    expect([404]).toContain(unknown.status);
  });

  it('empty catalog → [] not 500', async () => {
    const { token } = await login();
    const res = await request(server()).get('/api/onboarding/subjects').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  // ── Learning intent (TD-93) ──
  describe('learning intent', () => {
    it('resumable: subject-only saved, then track added (no memory state)', async () => {
      const { token, userId } = await login();
      const { subjectId, trackId } = await seedSubjectTrack(userId);
      // 1) subject-only
      const r1 = await saveIntent(token, subjectId);
      expect(r1.status).toBe(200);
      expect(r1.body).toEqual([{ id: expect.any(String), subject: { id: subjectId, slug: expect.any(String), title: 'English' }, track: null }]);
      // 2) reload → GET returns persisted subject, track null
      const list = await request(server()).get('/api/onboarding/learning-intents').set('Authorization', `Bearer ${token}`);
      expect(list.body).toHaveLength(1);
      expect(list.body[0].track).toBeNull();
      // 3) add track (same intent row updated)
      const r2 = await saveIntent(token, subjectId, trackId);
      expect(r2.body).toHaveLength(1);
      expect(r2.body[0].track.id).toBe(trackId);
      // DB: exactly one row (upsert, not duplicate)
      expect(await prisma.learnerLearningIntent.count({ where: { userId } })).toBe(1);
    });

    it('multi-subject: two subjects coexist, second does not overwrite first', async () => {
      const { token, userId } = await login();
      const a = await seedSubjectTrack(userId);
      const b = await seedSubjectTrack(userId);
      await saveIntent(token, a.subjectId, a.trackId);
      await saveIntent(token, b.subjectId, b.trackId);
      const list = await request(server()).get('/api/onboarding/learning-intents').set('Authorization', `Bearer ${token}`);
      expect(list.body).toHaveLength(2);
      expect(list.body.map((i: { subject: { id: string } }) => i.subject.id).sort()).toEqual([a.subjectId, b.subjectId].sort());
    });

    it('rejects DRAFT/ARCHIVED subject, cross-subject track, non-published track', async () => {
      const { token, userId } = await login();
      const draft = await prisma.subject.create({ data: { slug: `d-${Date.now()}`, title: 'Draft', status: ContainerStatus.DRAFT, sortOrder: 1, createdBy: userId } });
      const draftIntent = await saveIntent(token, draft.id);
      expect(draftIntent.status).toBe(404);
      expect(draftIntent.body.code).toBe('LEARNING_SUBJECT_NOT_AVAILABLE');

      const { subjectId } = await seedSubjectTrack(userId);
      const other = await seedSubjectTrack(userId); // boshqa subject + track
      const mismatch = await saveIntent(token, subjectId, other.trackId);
      expect(mismatch.status).toBe(400);
      expect(mismatch.body.code).toBe('LEARNING_TRACK_SUBJECT_MISMATCH');

      const draftTrack = await prisma.track.create({ data: { subjectId, slug: `dt-${Date.now()}`, title: 'DT', status: ContainerStatus.DRAFT, sortOrder: 2, createdBy: userId } });
      const draftTrackRes = await saveIntent(token, subjectId, draftTrack.id);
      expect(draftTrackRes.status).toBe(404);
      expect(draftTrackRes.body.code).toBe('LEARNING_TRACK_NOT_AVAILABLE');
    });

    it('schema: same user+subject upserts (no duplicate); different users same subject allowed', async () => {
      const { token, userId } = await login();
      const { subjectId } = await seedSubjectTrack(userId);
      await saveIntent(token, subjectId);
      await saveIntent(token, subjectId); // upsert — duplicate emas
      expect(await prisma.learnerLearningIntent.count({ where: { userId, subjectId } })).toBe(1);
      // different user, same subject → allowed (unique is per user+subject)
      const other = await prisma.user.create({ data: { phone: '+998901110022', updatedAt: new Date() } });
      await prisma.learnerLearningIntent.create({ data: { userId: other.id, subjectId } });
      expect(await prisma.learnerLearningIntent.count({ where: { subjectId } })).toBe(2);
    });

    it('learning-intents requires auth (own user only)', async () => {
      expect((await request(server()).get('/api/onboarding/learning-intents')).status).toBe(401);
    });
  });
});
