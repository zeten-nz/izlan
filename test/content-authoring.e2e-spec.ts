import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ContainerStatus, LessonStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AuthorizationRepository } from '../src/authorization/authorization.repository';
import { AuthExceptionFilter } from '../src/auth/http/auth-exception.filter';
import { SMS_PORT } from '../src/sms/sms.port';
import { bootstrapSystemRoles } from '../src/bootstrap/system-roles';
import { ContentAuditRepository } from '../src/content-authoring/content-audit.repository';
import { CONTENT_AUTHOR, CONTENT_SUBJECT_MANAGE } from '../src/content-authoring/content-authoring.constants';
import { ASSESSMENT_AUTHOR, ASSESSMENT_PUBLISH } from '../src/assessment-authoring/assessment-authoring.constants';
import { cleanupAuthTables } from './test-db.helper';
import { TestSmsAdapter } from './test-sms.adapter';

const BASE = '/api/staff/content';

describe('Content authoring — auth/scope/hierarchy/logical Lesson (e2e, izlan_test)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let authz: AuthorizationRepository;
  let auditRepo: ContentAuditRepository;
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
    auditRepo = moduleRef.get(ContentAuditRepository);
    await reset();
  });
  afterAll(async () => { await reset(); await app.close(); });
  beforeEach(async () => { await reset(); sms.clear(); jest.restoreAllMocks(); });

  async function reset() {
    await prisma.staffAudit.deleteMany();
    await prisma.lessonPrerequisite.deleteMany();
    await prisma.activity.deleteMany();
    await prisma.lesson.updateMany({ data: { publishedRevisionId: null } });
    await prisma.lessonRevision.deleteMany();
    await prisma.lesson.deleteMany();
    await prisma.topic.deleteMany();
    await prisma.module.deleteMany();
    await prisma.level.deleteMany();
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
  const PATCH = (url: string, token: string, body?: unknown) => request(server()).patch(url).set('Authorization', `Bearer ${token}`).send(body ?? {});
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
  async function makeLearner() { return makeUser(); }
  async function makeMethodist() { const u = await makeUser(); await assignRole(u.userId, 'METHODIST'); return u; }
  async function makeAdmin() { const u = await makeUser(); await assignRole(u.userId, 'ADMIN'); return u; }

  const createSubject = async (token: string) => (await P(`${BASE}/subjects`, token, { slug: `s-${uid()}`, title: 'Subject' })).body;
  const createTrack = async (token: string, subjectId: string) => (await P(`${BASE}/subjects/${subjectId}/tracks`, token, { slug: `t-${uid()}`, title: 'Track' })).body;
  const createLevel = async (token: string, trackId: string, so = 0) => (await P(`${BASE}/tracks/${trackId}/levels`, token, { code: `L${so}`, title: 'Level', sortOrder: so })).body;
  const createModule = async (token: string, levelId: string, so = 0) => (await P(`${BASE}/levels/${levelId}/modules`, token, { title: 'Module', sortOrder: so })).body;
  const createTopic = async (token: string, moduleId: string, so = 0) => (await P(`${BASE}/modules/${moduleId}/topics`, token, { title: 'Topic', sortOrder: so })).body;
  const createLesson = async (token: string, topicId: string, so = 0, contentKey = `ck-${uid()}`) => (await P(`${BASE}/topics/${topicId}/lessons`, token, { contentKey, sortOrder: so })).body;

  /** Admin-owned subject + a chain down to a Topic; returns ids + admin token. */
  async function seedChain() {
    const admin = await makeAdmin();
    const subject = await createSubject(admin.token);
    const track = await createTrack(admin.token, subject.id);
    const level = await createLevel(admin.token, track.id);
    const mod = await createModule(admin.token, level.id);
    const topic = await createTopic(admin.token, mod.id);
    return { admin, subject, track, level, mod, topic };
  }

  // ── Authorization / scope (CA-01..09) ──
  it('CA-01 unauthenticated staff request rejected', async () => {
    const res = await request(server()).post(`${BASE}/subjects`).send({ slug: `s-${uid()}`, title: 'x' });
    expect(res.status).toBe(401);
  });

  it('CA-02 authenticated user without content.* rejected (403)', async () => {
    const learner = await makeLearner();
    expect((await P(`${BASE}/subjects`, learner.token, { slug: `s-${uid()}`, title: 'x' })).status).toBe(403);
    expect((await G(`${BASE}/subjects`, learner.token)).status).toBe(403);
  });

  it('CA-03 content.author with NO SubjectAssignment cannot access/write another Subject child content (404)', async () => {
    const admin = await makeAdmin();
    const subject = await createSubject(admin.token);
    const methodist = await makeMethodist(); // has content.author, NOT assigned
    expect((await P(`${BASE}/subjects/${subject.id}/tracks`, methodist.token, { slug: `t-${uid()}`, title: 'x' })).status).toBe(404);
    expect((await G(`${BASE}/subjects/${subject.id}/tracks`, methodist.token)).status).toBe(404);
  });

  it('CA-04 content.author + SubjectAssignment succeeds', async () => {
    const admin = await makeAdmin();
    const subject = await createSubject(admin.token);
    const methodist = await makeMethodist();
    await P(`${BASE}/subjects/${subject.id}/assignments`, admin.token, { userId: methodist.userId }).expect(201);
    const res = await P(`${BASE}/subjects/${subject.id}/tracks`, methodist.token, { slug: `t-${uid()}`, title: 'T' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe(ContainerStatus.DRAFT);
  });

  it('CA-05 assignment to Subject A does not authorize Subject B', async () => {
    const admin = await makeAdmin();
    const a = await createSubject(admin.token);
    const b = await createSubject(admin.token);
    const methodist = await makeMethodist();
    await P(`${BASE}/subjects/${a.id}/assignments`, admin.token, { userId: methodist.userId }).expect(201);
    expect((await P(`${BASE}/subjects/${a.id}/tracks`, methodist.token, { slug: `t-${uid()}`, title: 'A' })).status).toBe(201);
    expect((await P(`${BASE}/subjects/${b.id}/tracks`, methodist.token, { slug: `t-${uid()}`, title: 'B' })).status).toBe(404);
  });

  it('CA-06 content.subject.manage can create a Subject', async () => {
    const admin = await makeAdmin();
    const res = await P(`${BASE}/subjects`, admin.token, { slug: `s-${uid()}`, title: 'S' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe(ContainerStatus.DRAFT);
  });

  it('CA-07 Subject creation auto-creates the actor SubjectAssignment', async () => {
    const admin = await makeAdmin();
    const subject = await createSubject(admin.token);
    const a = await prisma.subjectAssignment.findUnique({ where: { userId_subjectId: { userId: admin.userId, subjectId: subject.id } } });
    expect(a).not.toBeNull();
    expect(a!.assignedBy).toBe(admin.userId);
    // and the creator can immediately author + see it listed
    expect((await P(`${BASE}/subjects/${subject.id}/tracks`, admin.token, { slug: `t-${uid()}`, title: 'T' })).status).toBe(201);
    expect((await G(`${BASE}/subjects`, admin.token)).body.map((s: { id: string }) => s.id)).toContain(subject.id);
  });

  it('CA-08 content.subject.manage can assign another user', async () => {
    const admin = await makeAdmin();
    const subject = await createSubject(admin.token);
    const methodist = await makeMethodist();
    const res = await P(`${BASE}/subjects/${subject.id}/assignments`, admin.token, { userId: methodist.userId });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ userId: methodist.userId, subjectId: subject.id });
    // idempotent re-assign
    expect((await P(`${BASE}/subjects/${subject.id}/assignments`, admin.token, { userId: methodist.userId })).status).toBe(201);
    expect(await prisma.subjectAssignment.count({ where: { userId: methodist.userId, subjectId: subject.id } })).toBe(1);
  });

  it('CA-09 a plain METHODIST (content.author) cannot manage assignments', async () => {
    const admin = await makeAdmin();
    const subject = await createSubject(admin.token);
    const methodist = await makeMethodist();
    await P(`${BASE}/subjects/${subject.id}/assignments`, admin.token, { userId: methodist.userId }).expect(201);
    const other = await makeMethodist();
    expect((await P(`${BASE}/subjects/${subject.id}/assignments`, methodist.token, { userId: other.userId })).status).toBe(403);
    expect((await G(`${BASE}/subjects/${subject.id}/assignments`, methodist.token)).status).toBe(403);
  });

  // ── Hierarchy authoring (CA-10..18) ──
  it('CA-10..13 create DRAFT Track → Level → Module → Topic', async () => {
    const { admin, subject } = await seedChain();
    // seedChain already made track/level/module/topic; re-create fresh to assert each status
    const track = await createTrack(admin.token, subject.id);
    expect(track.status).toBe(ContainerStatus.DRAFT);
    const level = await createLevel(admin.token, track.id, 3);
    expect(level.status).toBe(ContainerStatus.DRAFT);
    const mod = await createModule(admin.token, level.id, 1);
    expect(mod.status).toBe(ContainerStatus.DRAFT);
    const topic = await createTopic(admin.token, mod.id, 1);
    expect(topic.status).toBe(ContainerStatus.DRAFT);
  });

  it('CA-14 create DRAFT Lesson with a unique contentKey', async () => {
    const { admin, topic } = await seedChain();
    const ck = `ck-${uid()}`;
    const res = await P(`${BASE}/topics/${topic.id}/lessons`, admin.token, { contentKey: ck, sortOrder: 0 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ contentKey: ck, status: LessonStatus.DRAFT, topicId: topic.id });
    expect(res.body.publishedRevisionId).toBeNull();
  });

  it('CA-15 duplicate contentKey returns a safe conflict (409)', async () => {
    const { admin, topic } = await seedChain();
    const ck = `ck-${uid()}`;
    await P(`${BASE}/topics/${topic.id}/lessons`, admin.token, { contentKey: ck, sortOrder: 0 }).expect(201);
    const dup = await P(`${BASE}/topics/${topic.id}/lessons`, admin.token, { contentKey: ck, sortOrder: 1 });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('CONTENT_UNIQUE_CONFLICT');
    expect(JSON.stringify(dup.body)).not.toMatch(/P2002|prisma|constraint/i);
  });

  it('CA-16 client cannot choose PUBLISHED status on create (unknown field rejected 400)', async () => {
    const { admin, topic } = await seedChain();
    const res = await P(`${BASE}/topics/${topic.id}/lessons`, admin.token, { contentKey: `ck-${uid()}`, sortOrder: 0, status: 'PUBLISHED' });
    expect(res.status).toBe(400);
  });

  it('CA-17 createdBy always equals the current principal (never the client)', async () => {
    const { admin, topic } = await seedChain();
    const res = await P(`${BASE}/topics/${topic.id}/lessons`, admin.token, { contentKey: `ck-${uid()}`, sortOrder: 0 });
    expect(res.body.createdBy).toBe(admin.userId);
    // an injected createdBy is rejected outright (whitelist)
    expect((await P(`${BASE}/topics/${topic.id}/lessons`, admin.token, { contentKey: `ck-${uid()}`, sortOrder: 1, createdBy: '00000000-0000-7000-8000-000000000000' })).status).toBe(400);
  });

  it('CA-18 cross-subject id injection is rejected (level under a track in an unassigned subject)', async () => {
    const admin = await makeAdmin();
    const other = await createSubject(admin.token);
    const otherTrack = await createTrack(admin.token, other.id);
    const { subject, admin: owner } = await seedChain();
    const methodist = await makeMethodist();
    await P(`${BASE}/subjects/${subject.id}/assignments`, owner.token, { userId: methodist.userId }).expect(201);
    // methodist is assigned to `subject` but tries to create a level under a track of `other`
    expect((await P(`${BASE}/tracks/${otherTrack.id}/levels`, methodist.token, { code: 'B1', title: 'x', sortOrder: 0 })).status).toBe(404);
  });

  // ── Optimistic concurrency (CA-19..23) ──
  it('CA-19 PATCH with the exact expectedUpdatedAt succeeds', async () => {
    const { admin, track } = await seedChain();
    const res = await PATCH(`${BASE}/tracks/${track.id}`, admin.token, { title: 'Renamed', expectedUpdatedAt: track.updatedAt });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Renamed');
    expect(res.body.updatedAt).not.toBe(track.updatedAt);
  });

  it('CA-20/21/22 stale expectedUpdatedAt → 409, DB unchanged, no audit', async () => {
    const { admin, track } = await seedChain();
    const first = await PATCH(`${BASE}/tracks/${track.id}`, admin.token, { title: 'First', expectedUpdatedAt: track.updatedAt });
    expect(first.status).toBe(200);
    const auditsBefore = await prisma.staffAudit.count({ where: { actionCode: 'content.track.update', targetId: track.id } });
    // CA-20 reuse the now-stale original token
    const stale = await PATCH(`${BASE}/tracks/${track.id}`, admin.token, { title: 'Second', expectedUpdatedAt: track.updatedAt });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('CONTENT_EDIT_CONFLICT');
    // CA-21 DB unchanged (still "First")
    const row = await prisma.track.findUnique({ where: { id: track.id } });
    expect(row!.title).toBe('First');
    // CA-22 no new audit for the failed write
    expect(await prisma.staffAudit.count({ where: { actionCode: 'content.track.update', targetId: track.id } })).toBe(auditsBefore);
  });

  it('CA-23 successful write + StaffAudit commit together', async () => {
    const { admin, track } = await seedChain();
    await PATCH(`${BASE}/tracks/${track.id}`, admin.token, { title: 'Audited', expectedUpdatedAt: track.updatedAt }).expect(200);
    const audit = await prisma.staffAudit.findFirst({ where: { actionCode: 'content.track.update', targetId: track.id } });
    expect(audit).not.toBeNull();
    expect(audit!.actorUserId).toBe(admin.userId);
    expect(audit!.targetType).toBe('Track');
  });

  // ── Lesson immutability / move (CA-24..28) ──
  it('CA-24 Lesson PATCH cannot change contentKey (unknown field rejected 400)', async () => {
    const { admin, topic } = await seedChain();
    const lesson = await createLesson(admin.token, topic.id);
    const res = await PATCH(`${BASE}/lessons/${lesson.id}`, admin.token, { contentKey: 'hijacked', expectedUpdatedAt: lesson.updatedAt });
    expect(res.status).toBe(400);
    const row = await prisma.lesson.findUnique({ where: { id: lesson.id } });
    expect(row!.contentKey).toBe(lesson.contentKey);
  });

  it('CA-25 Lesson PATCH cannot change publishedRevisionId/status/createdBy (400)', async () => {
    const { admin, topic } = await seedChain();
    const lesson = await createLesson(admin.token, topic.id);
    for (const bad of [{ status: 'PUBLISHED' }, { publishedRevisionId: '00000000-0000-7000-8000-000000000000' }, { createdBy: '00000000-0000-7000-8000-000000000000' }]) {
      const res = await PATCH(`${BASE}/lessons/${lesson.id}`, admin.token, { ...bad, expectedUpdatedAt: lesson.updatedAt });
      expect(res.status).toBe(400);
    }
  });

  it('CA-26 DRAFT Lesson may move to another Topic in the same Subject', async () => {
    const { admin, mod, topic } = await seedChain();
    const topic2 = await createTopic(admin.token, mod.id, 2);
    const lesson = await createLesson(admin.token, topic.id);
    const res = await P(`${BASE}/lessons/${lesson.id}/move`, admin.token, { toTopicId: topic2.id, expectedUpdatedAt: lesson.updatedAt });
    expect(res.status).toBe(201);
    expect(res.body.topicId).toBe(topic2.id);
  });

  it('CA-27 cross-subject move is rejected', async () => {
    const { admin, topic } = await seedChain();
    const lesson = await createLesson(admin.token, topic.id);
    // a topic in a DIFFERENT subject
    const other = await createSubject(admin.token);
    const oTrack = await createTrack(admin.token, other.id);
    const oLevel = await createLevel(admin.token, oTrack.id);
    const oMod = await createModule(admin.token, oLevel.id);
    const oTopic = await createTopic(admin.token, oMod.id);
    const res = await P(`${BASE}/lessons/${lesson.id}/move`, admin.token, { toTopicId: oTopic.id, expectedUpdatedAt: lesson.updatedAt });
    expect(res.status).toBe(404);
    const row = await prisma.lesson.findUnique({ where: { id: lesson.id } });
    expect(row!.topicId).toBe(topic.id); // unchanged
  });

  it('CA-28 non-DRAFT Lesson move is rejected (409 CONTENT_NOT_DRAFT)', async () => {
    const { admin, mod, topic } = await seedChain();
    const topic2 = await createTopic(admin.token, mod.id, 2);
    const lesson = await createLesson(admin.token, topic.id);
    await prisma.lesson.update({ where: { id: lesson.id }, data: { status: LessonStatus.PUBLISHED } }); // no publish API; force state
    const fresh = await prisma.lesson.findUnique({ where: { id: lesson.id } });
    const res = await P(`${BASE}/lessons/${lesson.id}/move`, admin.token, { toTopicId: topic2.id, expectedUpdatedAt: fresh!.updatedAt.toISOString() });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONTENT_NOT_DRAFT');
  });

  // ── StaffAudit (CA-29..34) ──
  it('CA-29 Subject create → audit (actor + target)', async () => {
    const admin = await makeAdmin();
    const subject = await createSubject(admin.token);
    const audit = await prisma.staffAudit.findFirst({ where: { actionCode: 'content.subject.create', targetId: subject.id } });
    expect(audit).toMatchObject({ actorUserId: admin.userId, targetType: 'Subject' });
  });

  it('CA-30 assignment add + remove → audit', async () => {
    const admin = await makeAdmin();
    const subject = await createSubject(admin.token);
    const methodist = await makeMethodist();
    await P(`${BASE}/subjects/${subject.id}/assignments`, admin.token, { userId: methodist.userId }).expect(201);
    const del = await DEL(`${BASE}/subjects/${subject.id}/assignments/${methodist.userId}`, admin.token);
    expect(del.status).toBe(200);
    expect(del.body.removed).toBe(true);
    expect(await prisma.staffAudit.count({ where: { actionCode: 'content.subject_assignment.add', actorUserId: admin.userId } })).toBe(1);
    expect(await prisma.staffAudit.count({ where: { actionCode: 'content.subject_assignment.remove', actorUserId: admin.userId } })).toBe(1);
    // idempotent remove of a missing assignment → no error, no extra audit
    const del2 = await DEL(`${BASE}/subjects/${subject.id}/assignments/${methodist.userId}`, admin.token);
    expect(del2.status).toBe(200);
    expect(del2.body.removed).toBe(false);
    expect(await prisma.staffAudit.count({ where: { actionCode: 'content.subject_assignment.remove' } })).toBe(1);
  });

  it('CA-31 hierarchy create → audit', async () => {
    const { admin, subject } = await seedChain();
    const track = await createTrack(admin.token, subject.id);
    expect(await prisma.staffAudit.findFirst({ where: { actionCode: 'content.track.create', targetId: track.id } })).not.toBeNull();
  });

  it('CA-32 hierarchy update → audit', async () => {
    const { admin, mod } = await seedChain();
    await PATCH(`${BASE}/modules/${mod.id}`, admin.token, { title: 'M2', expectedUpdatedAt: mod.updatedAt }).expect(200);
    const audit = await prisma.staffAudit.findFirst({ where: { actionCode: 'content.module.update', targetId: mod.id } });
    expect(audit).toMatchObject({ actorUserId: admin.userId, targetType: 'Module' });
  });

  it('CA-33 Lesson move → audit', async () => {
    const { admin, mod, topic } = await seedChain();
    const topic2 = await createTopic(admin.token, mod.id, 2);
    const lesson = await createLesson(admin.token, topic.id);
    await P(`${BASE}/lessons/${lesson.id}/move`, admin.token, { toTopicId: topic2.id, expectedUpdatedAt: lesson.updatedAt }).expect(201);
    const audit = await prisma.staffAudit.findFirst({ where: { actionCode: 'content.lesson.move', targetId: lesson.id } });
    expect(audit).not.toBeNull();
    expect((audit!.metadata as { toTopicId?: string }).toTopicId).toBe(topic2.id);
  });

  it('CA-34 rejected (scope-denied) mutation writes NO audit', async () => {
    const admin = await makeAdmin();
    const subject = await createSubject(admin.token);
    const methodist = await makeMethodist(); // unassigned
    const before = await prisma.staffAudit.count();
    expect((await P(`${BASE}/subjects/${subject.id}/tracks`, methodist.token, { slug: `t-${uid()}`, title: 'x' })).status).toBe(404);
    expect(await prisma.staffAudit.count()).toBe(before); // no audit for the rejected write
  });

  // ── Review corrections (REV-01..06) ──
  it('REV-01 METHODIST (content.author + assignment, NO content.subject.manage) cannot PATCH Subject metadata (403)', async () => {
    const admin = await makeAdmin();
    const subject = await createSubject(admin.token);
    const methodist = await makeMethodist();
    await P(`${BASE}/subjects/${subject.id}/assignments`, admin.token, { userId: methodist.userId }).expect(201);
    const fresh = await prisma.subject.findUnique({ where: { id: subject.id } });
    const res = await PATCH(`${BASE}/subjects/${subject.id}`, methodist.token, { title: 'Hijack', expectedUpdatedAt: fresh!.updatedAt.toISOString() });
    expect(res.status).toBe(403);
    expect((await prisma.subject.findUnique({ where: { id: subject.id } }))!.title).toBe(subject.title);
  });

  it('REV-02 content.subject.manage can PATCH Subject metadata (DRAFT, concurrency, audited)', async () => {
    const admin = await makeAdmin();
    const subject = await createSubject(admin.token);
    const res = await PATCH(`${BASE}/subjects/${subject.id}`, admin.token, { title: 'Renamed', expectedUpdatedAt: subject.updatedAt });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Renamed');
    expect(await prisma.staffAudit.findFirst({ where: { actionCode: 'content.subject.update', targetId: subject.id } })).not.toBeNull();
    // stale token now conflicts
    expect((await PATCH(`${BASE}/subjects/${subject.id}`, admin.token, { title: 'X', expectedUpdatedAt: subject.updatedAt })).status).toBe(409);
  });

  it('REV-03 PATCH Track { title: null } → 400, DB unchanged', async () => {
    const { admin, track } = await seedChain();
    const res = await PATCH(`${BASE}/tracks/${track.id}`, admin.token, { title: null, expectedUpdatedAt: track.updatedAt });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/prisma|column|violat/i);
    const row = await prisma.track.findUnique({ where: { id: track.id } });
    expect(row!.title).toBe('Track');
    expect(row!.updatedAt.toISOString()).toBe(track.updatedAt); // untouched
  });

  it('REV-04 PATCH Level { sortOrder: null } → 400, DB unchanged', async () => {
    const { admin, level } = await seedChain();
    const res = await PATCH(`${BASE}/levels/${level.id}`, admin.token, { sortOrder: null, expectedUpdatedAt: level.updatedAt });
    expect(res.status).toBe(400);
    const row = await prisma.level.findUnique({ where: { id: level.id } });
    expect(row!.sortOrder).toBe(level.sortOrder);
    expect(row!.updatedAt.toISOString()).toBe(level.updatedAt);
  });

  it('REV-05 nullable metadata clearing works (Lesson.slug → null; Track.description → null), audited + concurrency', async () => {
    const { admin, topic } = await seedChain();
    // Lesson slug clear
    const lesson = (await P(`${BASE}/topics/${topic.id}/lessons`, admin.token, { contentKey: `ck-${uid()}`, sortOrder: 0, slug: `sl-${uid()}` })).body;
    expect(lesson.slug).not.toBeNull();
    const cleared = await PATCH(`${BASE}/lessons/${lesson.id}`, admin.token, { slug: null, expectedUpdatedAt: lesson.updatedAt });
    expect(cleared.status).toBe(200);
    expect(cleared.body.slug).toBeNull();
    expect((await prisma.lesson.findUnique({ where: { id: lesson.id } }))!.slug).toBeNull();
    expect(await prisma.staffAudit.findFirst({ where: { actionCode: 'content.lesson.update', targetId: lesson.id } })).not.toBeNull();
    // concurrency preserved: the now-stale token conflicts
    expect((await PATCH(`${BASE}/lessons/${lesson.id}`, admin.token, { slug: null, expectedUpdatedAt: lesson.updatedAt })).status).toBe(409);
  });

  it('REV-06 audit failure rolls the business mutation back (no entity change, no audit row)', async () => {
    const { admin, track } = await seedChain();
    const spy = jest.spyOn(auditRepo, 'write').mockRejectedValueOnce(new Error('audit boom'));
    const res = await PATCH(`${BASE}/tracks/${track.id}`, admin.token, { title: 'ShouldRollBack', expectedUpdatedAt: track.updatedAt });
    expect(res.status).toBe(500); // generic; no leak
    expect(JSON.stringify(res.body)).not.toMatch(/audit boom|prisma/i);
    spy.mockRestore();
    const row = await prisma.track.findUnique({ where: { id: track.id } });
    expect(row!.title).toBe('Track'); // business mutation rolled back
    expect(row!.updatedAt.toISOString()).toBe(track.updatedAt);
    expect(await prisma.staffAudit.count({ where: { actionCode: 'content.track.update', targetId: track.id } })).toBe(0);
  });

  // ── Bootstrap (AUTH-03..06, DB-verified) ──
  it('AUTH-03..06 bootstrap seeds default role permissions and is idempotent', async () => {
    const check = async () => {
      const methodist = await prisma.role.findUnique({ where: { code: 'METHODIST' }, select: { permissions: { select: { permissionCode: true } } } });
      const admin = await prisma.role.findUnique({ where: { code: 'ADMIN' }, select: { permissions: { select: { permissionCode: true } } } });
      const learner = await prisma.role.findUnique({ where: { code: 'LEARNER' }, select: { permissions: { select: { permissionCode: true } } } });
      expect(methodist!.permissions.map((p) => p.permissionCode).sort()).toEqual(['content.author', 'content.publish', ASSESSMENT_AUTHOR, ASSESSMENT_PUBLISH].sort());
      expect(admin!.permissions.map((p) => p.permissionCode).sort()).toEqual([CONTENT_AUTHOR, CONTENT_SUBJECT_MANAGE, 'content.publish', ASSESSMENT_AUTHOR, ASSESSMENT_PUBLISH].sort());
      expect(learner!.permissions).toEqual([]);
    };
    await check();
    await bootstrapSystemRoles(authz); // AUTH-06 second run is idempotent (no duplicates, no throw)
    await check();
  });
});
