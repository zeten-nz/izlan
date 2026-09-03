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

const BASE = '/api/staff/content';

/**
 * Safe Subject deletion (e2e, izlan_test). Proves the DELETED / ARCHIVED / BLOCKED lifecycle, permission + assignment
 * scope, IDOR-safety, audit, idempotency, and that learner history is NEVER physically destroyed by a Delete click.
 */
describe('Safe Subject deletion (e2e, izlan_test)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let authz: AuthorizationRepository;
  const sms = new TestSmsAdapter();
  let n = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(SMS_PORT).useValue(sms).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AuthExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = moduleRef.get(PrismaService);
    authz = moduleRef.get(AuthorizationRepository);
    await reset();
  });
  afterAll(async () => { await reset(); await app.close(); });
  beforeEach(async () => { await reset(); sms.clear(); });

  async function reset() {
    await prisma.learnerLearningIntent.deleteMany();
    await prisma.staffAudit.deleteMany();
    await prisma.lessonPrerequisite.deleteMany();
    await prisma.activitySkill.deleteMany();
    await prisma.lessonSkill.deleteMany();
    await prisma.activity.deleteMany();
    await prisma.lesson.updateMany({ data: { publishedRevisionId: null } });
    await prisma.lessonRevision.deleteMany();
    await prisma.lesson.deleteMany();
    await prisma.topic.deleteMany();
    await prisma.module.deleteMany();
    await prisma.level.deleteMany();
    await prisma.skill.deleteMany();
    await prisma.subjectDomain.deleteMany();
    await prisma.track.deleteMany();
    await prisma.subjectAssignment.deleteMany();
    await prisma.subject.deleteMany();
    await cleanupAuthTables(prisma);
    await bootstrapSystemRoles(authz);
  }

  const server = () => app.getHttpServer();
  const phone = () => `+99890${String(1000000 + n++).slice(-7)}`;
  const uid = () => `${Date.now()}-${n++}`;
  const P = (url: string, token: string, body?: unknown) => request(server()).post(url).set('Authorization', `Bearer ${token}`).send(body ?? {});
  const G = (url: string, token: string) => request(server()).get(url).set('Authorization', `Bearer ${token}`);
  const DEL = (url: string, token: string) => request(server()).delete(url).set('Authorization', `Bearer ${token}`);

  async function makeUser(): Promise<{ token: string; userId: string }> {
    const ph = phone();
    const req = await request(server()).post('/api/auth/otp/request').send({ phone: ph });
    const verify = await request(server()).post('/api/auth/register').send({ challengeId: req.body.challengeId, code: sms.latestCode(), password: 'Passw0rd!123' });
    const user = await prisma.user.findUnique({ where: { phone: ph } });
    return { token: verify.body.accessToken, userId: user!.id };
  }
  async function assignRole(userId: string, code: string) {
    const role = await prisma.role.findUnique({ where: { code } });
    await prisma.userRole.create({ data: { userId, roleId: role!.id, grantedBy: null } });
  }
  async function makeAdmin() { const u = await makeUser(); await assignRole(u.userId, 'ADMIN'); return u; }
  async function makeMethodist() { const u = await makeUser(); await assignRole(u.userId, 'METHODIST'); return u; }

  const createSubject = async (token: string) => (await P(`${BASE}/subjects`, token, { slug: `s-${uid()}`, title: 'English — Demo' })).body;
  const createTrack = async (token: string, subjectId: string) => (await P(`${BASE}/subjects/${subjectId}/tracks`, token, { slug: `t-${uid()}`, title: 'Track' })).body;
  const createLevel = async (token: string, trackId: string) => (await P(`${BASE}/tracks/${trackId}/levels`, token, { code: `L${uid()}`, title: 'Level', sortOrder: 0 })).body;
  const createModule = async (token: string, levelId: string) => (await P(`${BASE}/levels/${levelId}/modules`, token, { title: 'Module', sortOrder: 0 })).body;
  const createTopic = async (token: string, moduleId: string) => (await P(`${BASE}/modules/${moduleId}/topics`, token, { title: 'Topic', sortOrder: 0 })).body;
  const createLesson = async (token: string, topicId: string) => (await P(`${BASE}/topics/${topicId}/lessons`, token, { contentKey: `ck-${uid()}`, sortOrder: 0 })).body;
  const listIds = async (token: string): Promise<string[]> => ((await G(`${BASE}/subjects`, token)).body as { id: string }[]).map((s) => s.id);

  // ── SD-01: disposable EMPTY subject → DELETED, gone from list, audit written ──
  it('SD-01 authorized staff can permanently delete a disposable (empty draft) subject', async () => {
    const admin = await makeAdmin();
    const subject = await createSubject(admin.token);
    const res = await DEL(`${BASE}/subjects/${subject.id}`, admin.token);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ outcome: 'DELETED', subjectId: subject.id, reason: null });
    // gone from DB + active list
    expect(await prisma.subject.findUnique({ where: { id: subject.id } })).toBeNull();
    expect(await listIds(admin.token)).not.toContain(subject.id);
    // audit
    const audit = await prisma.staffAudit.findFirst({ where: { actionCode: 'content.subject.delete', targetId: subject.id } });
    expect(audit).toMatchObject({ actorUserId: admin.userId, targetType: 'Subject' });
  });

  // ── SD-02: disposable subject WITH draft content → DELETED (owned cascade) ──
  it('SD-02 deletes a disposable subject and its owned draft content (cascade), leaving no orphans', async () => {
    const admin = await makeAdmin();
    const subject = await createSubject(admin.token);
    const track = await createTrack(admin.token, subject.id);
    const level = await createLevel(admin.token, track.id);
    const mod = await createModule(admin.token, level.id);
    const topic = await createTopic(admin.token, mod.id);
    const lesson = await createLesson(admin.token, topic.id);

    const res = await DEL(`${BASE}/subjects/${subject.id}`, admin.token);
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('DELETED');
    // every owned row is gone
    expect(await prisma.subject.count({ where: { id: subject.id } })).toBe(0);
    expect(await prisma.track.count({ where: { subjectId: subject.id } })).toBe(0);
    expect(await prisma.level.count({ where: { id: level.id } })).toBe(0);
    expect(await prisma.topic.count({ where: { id: topic.id } })).toBe(0);
    expect(await prisma.lesson.count({ where: { id: lesson.id } })).toBe(0);
    expect(await prisma.subjectAssignment.count({ where: { subjectId: subject.id } })).toBe(0);
  });

  // ── SD-03: unknown subject → safe 404 ──
  it('SD-03 unknown subject returns a safe 404 (CONTENT_NOT_FOUND)', async () => {
    const admin = await makeAdmin();
    const res = await DEL(`${BASE}/subjects/01a00000-0000-7000-8000-000000000000`, admin.token);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('CONTENT_NOT_FOUND');
  });

  // ── SD-04: unauthenticated → 401 ──
  it('SD-04 unauthenticated request is rejected (401)', async () => {
    const admin = await makeAdmin();
    const subject = await createSubject(admin.token);
    const res = await request(server()).delete(`${BASE}/subjects/${subject.id}`);
    expect(res.status).toBe(401);
    expect(await prisma.subject.count({ where: { id: subject.id } })).toBe(1); // untouched
  });

  // ── SD-05: lacks content.subject.manage → 403 ──
  it('SD-05 a user without content.subject.manage cannot delete (403)', async () => {
    const admin = await makeAdmin();
    const subject = await createSubject(admin.token);
    const methodist = await makeMethodist(); // author+publish, NOT subject.manage
    const res = await DEL(`${BASE}/subjects/${subject.id}`, methodist.token);
    expect(res.status).toBe(403);
    expect(await prisma.subject.count({ where: { id: subject.id } })).toBe(1);
  });

  // ── SD-06: out-of-scope staff (has subject.manage but not assigned) → 404 (IDOR-safe), no role bypass ──
  it('SD-06 an out-of-scope admin (not assigned to the subject) cannot delete it (404-safe)', async () => {
    const owner = await makeAdmin();
    const subject = await createSubject(owner.token);
    const otherAdmin = await makeAdmin(); // ALSO has content.subject.manage, but no assignment for this subject
    const res = await DEL(`${BASE}/subjects/${subject.id}`, otherAdmin.token);
    expect(res.status).toBe(404); // indistinguishable from not-found; ADMIN role does NOT bypass assignment scope
    expect(res.body.code).toBe('CONTENT_NOT_FOUND');
    expect(await prisma.subject.count({ where: { id: subject.id } })).toBe(1);
  });

  // ── SD-07: published content (no history) → ARCHIVED, preserved, hidden from active list ──
  it('SD-07 a subject with published content (no learner history) is ARCHIVED, not deleted', async () => {
    const admin = await makeAdmin();
    const subject = await createSubject(admin.token);
    await prisma.subject.update({ where: { id: subject.id }, data: { status: ContainerStatus.PUBLISHED } });

    const res = await DEL(`${BASE}/subjects/${subject.id}`, admin.token);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ outcome: 'ARCHIVED', reason: 'PUBLISHED_CONTENT' });
    const after = await prisma.subject.findUnique({ where: { id: subject.id } });
    expect(after?.status).toBe(ContainerStatus.ARCHIVED); // preserved, not destroyed
    expect(await listIds(admin.token)).not.toContain(subject.id); // hidden from active list
    expect(await prisma.staffAudit.count({ where: { actionCode: 'content.subject.archive', targetId: subject.id } })).toBe(1);
  });

  // ── SD-08: learner history → BLOCKED, subject + history intact ──
  it('SD-08 a subject with learner history is BLOCKED (never physically destroyed) and history stays intact', async () => {
    const admin = await makeAdmin();
    const subject = await createSubject(admin.token);
    const learner = await makeUser();
    await prisma.learnerLearningIntent.create({ data: { userId: learner.userId, subjectId: subject.id } });

    const res = await DEL(`${BASE}/subjects/${subject.id}`, admin.token);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ outcome: 'BLOCKED', reason: 'LEARNER_HISTORY' });
    expect(await prisma.subject.count({ where: { id: subject.id } })).toBe(1); // untouched
    expect((await prisma.subject.findUnique({ where: { id: subject.id } }))?.status).toBe(ContainerStatus.DRAFT); // not even archived
    expect(await prisma.learnerLearningIntent.count({ where: { subjectId: subject.id } })).toBe(1); // history intact
  });

  // ── SD-09/SD-12: published content AND learner history (A1-like) → BLOCKED; nothing lost ──
  it('SD-12 a canonical-like subject (published + learner history) cannot lose history through deletion', async () => {
    const admin = await makeAdmin();
    const subject = await createSubject(admin.token);
    await prisma.subject.update({ where: { id: subject.id }, data: { status: ContainerStatus.PUBLISHED } });
    const learner = await makeUser();
    await prisma.learnerLearningIntent.create({ data: { userId: learner.userId, subjectId: subject.id } });

    const res = await DEL(`${BASE}/subjects/${subject.id}`, admin.token);
    expect(res.body.outcome).toBe('BLOCKED'); // history wins over the archive path
    expect((await prisma.subject.findUnique({ where: { id: subject.id } }))?.status).toBe(ContainerStatus.PUBLISHED); // untouched
    expect(await prisma.learnerLearningIntent.count({ where: { subjectId: subject.id } })).toBe(1);
    // BLOCKED performs no mutation → no delete/archive audit (the earlier create audit is unrelated).
    expect(await prisma.staffAudit.count({ where: { targetId: subject.id, actionCode: { in: ['content.subject.delete', 'content.subject.archive'] } } })).toBe(0);
  });

  // ── SD-10: repeated delete is idempotent/safe ──
  it('SD-10 repeated deletion is safe: DELETED→404 second time; ARCHIVED→ARCHIVED (no-op) second time', async () => {
    const admin = await makeAdmin();
    // disposable → delete twice
    const s1 = await createSubject(admin.token);
    expect((await DEL(`${BASE}/subjects/${s1.id}`, admin.token)).body.outcome).toBe('DELETED');
    expect((await DEL(`${BASE}/subjects/${s1.id}`, admin.token)).status).toBe(404); // already gone
    // published (durable: a PUBLISHED descendant track) → archive twice
    const s2 = await createSubject(admin.token);
    const track = await createTrack(admin.token, s2.id);
    await prisma.track.update({ where: { id: track.id }, data: { status: ContainerStatus.PUBLISHED } });
    expect((await DEL(`${BASE}/subjects/${s2.id}`, admin.token)).body.outcome).toBe('ARCHIVED');
    const second = await DEL(`${BASE}/subjects/${s2.id}`, admin.token);
    expect(second.status).toBe(200);
    expect(second.body.outcome).toBe('ARCHIVED'); // still has a published descendant → idempotent no-op
    expect(await prisma.subject.count({ where: { id: s2.id } })).toBe(1);
  });
});
