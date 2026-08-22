import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { LessonStatus, RevisionStatus, SkillStatus, ActivityType } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AuthorizationRepository } from '../src/authorization/authorization.repository';
import { AuthExceptionFilter } from '../src/auth/http/auth-exception.filter';
import { SMS_PORT } from '../src/sms/sms.port';
import { bootstrapSystemRoles } from '../src/bootstrap/system-roles';
import { ContentAuditRepository } from '../src/content-authoring/content-audit.repository';
import { SubjectScopeService } from '../src/content-authoring/subject-scope.service';
import { ContentNotFoundError } from '../src/common/errors';
import { LESSON_ACTIVITY_MARKDOWN_SCHEMA_VERSION } from '../src/content/activity/markdown-activity-payload';
import { cleanupAuthTables } from './test-db.helper';
import { TestSmsAdapter } from './test-sms.adapter';

const BASE = '/api/staff/content';
const md = () => ({ schemaVersion: LESSON_ACTIVITY_MARKDOWN_SCHEMA_VERSION, markdown: '# x' });

describe('Content authoring — skill mapping + prerequisite DAG (e2e, izlan_test)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let authz: AuthorizationRepository;
  let auditRepo: ContentAuditRepository;
  let scope: SubjectScopeService;
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
    scope = moduleRef.get(SubjectScopeService);
    await reset();
  });
  afterAll(async () => { await reset(); await app.close(); });
  beforeEach(async () => { await reset(); sms.clear(); jest.restoreAllMocks(); });

  async function reset() {
    await prisma.staffAudit.deleteMany();
    await prisma.lessonPrerequisite.deleteMany();
    await prisma.lessonSkill.deleteMany();
    await prisma.activitySkill.deleteMany();
    await prisma.activity.deleteMany();
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

  const server = () => app.getHttpServer();
  const phone = () => `+99890${String(3000000 + n++).slice(-7)}`;
  const uid = () => `${Date.now()}-${n++}`;
  const P = (url: string, token: string, body?: unknown) => request(server()).post(url).set('Authorization', `Bearer ${token}`).send(body ?? {});
  const G = (url: string, token: string) => request(server()).get(url).set('Authorization', `Bearer ${token}`);
  const PATCH = (url: string, token: string, body?: unknown) => request(server()).patch(url).set('Authorization', `Bearer ${token}`).send(body ?? {});
  const DEL = (url: string, token: string, body?: unknown) => request(server()).delete(url).set('Authorization', `Bearer ${token}`).send(body ?? {});

  async function makeAdmin() {
    const ph = phone();
    const req = await request(server()).post('/api/auth/otp/request').send({ phone: ph });
    const verify = await request(server()).post('/api/auth/register').send({ challengeId: req.body.challengeId, code: sms.latestCode(), password: 'Passw0rd!123' });
    const user = await prisma.user.findUnique({ where: { phone: ph } });
    const admin = await prisma.role.findUnique({ where: { code: 'ADMIN' } });
    await prisma.userRole.create({ data: { userId: user!.id, roleId: admin!.id, grantedBy: null } });
    return { token: verify.body.accessToken, userId: user!.id };
  }

  async function seedSubject(admin: { token: string }) {
    const subject = (await P(`${BASE}/subjects`, admin.token, { slug: `s-${uid()}`, title: 'S' })).body;
    const track = (await P(`${BASE}/subjects/${subject.id}/tracks`, admin.token, { slug: `t-${uid()}`, title: 'T' })).body;
    const level = (await P(`${BASE}/tracks/${track.id}/levels`, admin.token, { code: 'A1', title: 'L', sortOrder: 0 })).body;
    const mod = (await P(`${BASE}/levels/${level.id}/modules`, admin.token, { title: 'M', sortOrder: 0 })).body;
    const topic = (await P(`${BASE}/modules/${mod.id}/topics`, admin.token, { title: 'Tp', sortOrder: 0 })).body;
    return { subjectId: subject.id, topicId: topic.id };
  }
  const mkLesson = async (token: string, topicId: string, so: number) => (await P(`${BASE}/topics/${topicId}/lessons`, token, { contentKey: `ck-${uid()}`, sortOrder: so })).body;
  const mkSkill = async (token: string, subjectId: string, name = `Skill-${uid()}`, code?: string) => (await P(`${BASE}/subjects/${subjectId}/skills`, token, { name, ...(code ? { code } : {}) })).body;

  // ── Skill authoring (SA3-01..08) ──
  it('SA3-01/07 create ACTIVE Skill; client cannot set subjectId/status', async () => {
    const admin = await makeAdmin();
    const { subjectId } = await seedSubject(admin);
    const res = await P(`${BASE}/subjects/${subjectId}/skills`, admin.token, { name: 'Grammar', code: 'GR' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ subjectId, name: 'Grammar', code: 'GR', status: SkillStatus.ACTIVE });
    for (const bad of [{ subjectId: '00000000-0000-7000-8000-000000000000' }, { status: 'ARCHIVED' }, { createdAt: '2026-01-01T00:00:00.000Z' }]) {
      expect((await P(`${BASE}/subjects/${subjectId}/skills`, admin.token, { name: `x-${uid()}`, ...bad })).status).toBe(400);
    }
  });

  it('SA3-24 Skill create enforces SubjectAssignment INSIDE the mutation transaction (tx-scoped; reject → no row/no audit)', async () => {
    const admin = await makeAdmin();
    const { subjectId } = await seedSubject(admin);
    // (a) a valid create invokes requireScope with a Prisma transaction client (3rd arg present)
    const spy = jest.spyOn(scope, 'requireScope');
    await P(`${BASE}/subjects/${subjectId}/skills`, admin.token, { name: 'TxScoped' }).expect(201);
    expect(spy).toHaveBeenCalled();
    const call = spy.mock.calls[0]; // first requireScope after the spy = the skill-create scope check
    expect(call[1]).toBe(subjectId);
    expect(call[2]).toBeDefined(); // the transaction client
    spy.mockRestore();
    // (b) if scope rejects, neither the Skill row nor the StaffAudit persists (one transaction)
    const auditsBefore = await prisma.staffAudit.count({ where: { actionCode: 'content.skill.create' } });
    const reject = jest.spyOn(scope, 'requireScope').mockRejectedValueOnce(new ContentNotFoundError('denied'));
    const res = await P(`${BASE}/subjects/${subjectId}/skills`, admin.token, { name: 'ShouldNotPersist' });
    expect(res.status).toBe(404);
    reject.mockRestore();
    expect(await prisma.skill.count({ where: { subjectId, name: 'ShouldNotPersist' } })).toBe(0);
    expect(await prisma.staffAudit.count({ where: { actionCode: 'content.skill.create' } })).toBe(auditsBefore);
  });

  it('SA3-02 another Subject assignment cannot read/create Skill (404)', async () => {
    const a1 = await makeAdmin();
    const s1 = await seedSubject(a1);
    const skill = await mkSkill(a1.token, s1.subjectId);
    const a2 = await makeAdmin(); // assigned only to their own subjects
    expect((await G(`${BASE}/skills/${skill.id}`, a2.token)).status).toBe(404);
    expect((await P(`${BASE}/subjects/${s1.subjectId}/skills`, a2.token, { name: 'X' })).status).toBe(404);
    expect((await G(`${BASE}/subjects/${s1.subjectId}/skills`, a2.token)).status).toBe(404);
  });

  it('SA3-03/04 duplicate name / duplicate code → safe 409', async () => {
    const admin = await makeAdmin();
    const { subjectId } = await seedSubject(admin);
    await P(`${BASE}/subjects/${subjectId}/skills`, admin.token, { name: 'Dup', code: 'D1' }).expect(201);
    const dupName = await P(`${BASE}/subjects/${subjectId}/skills`, admin.token, { name: 'Dup', code: 'D2' });
    expect(dupName.status).toBe(409);
    expect(dupName.body.code).toBe('CONTENT_UNIQUE_CONFLICT');
    const dupCode = await P(`${BASE}/subjects/${subjectId}/skills`, admin.token, { name: 'Other', code: 'D1' });
    expect(dupCode.status).toBe(409);
    expect(JSON.stringify(dupName.body)).not.toMatch(/P2002|prisma|constraint/i);
  });

  it('SA3-05/06 Skill PATCH: exact token advances; stale → 409 unchanged no audit', async () => {
    const admin = await makeAdmin();
    const { subjectId } = await seedSubject(admin);
    const skill = await mkSkill(admin.token, subjectId, 'Sk');
    const ok = await PATCH(`${BASE}/skills/${skill.id}`, admin.token, { name: 'Renamed', expectedUpdatedAt: skill.updatedAt });
    expect(ok.status).toBe(200);
    expect(ok.body.name).toBe('Renamed');
    expect(new Date(ok.body.updatedAt).getTime()).toBeGreaterThan(new Date(skill.updatedAt).getTime());
    const before = await prisma.staffAudit.count({ where: { actionCode: 'content.skill.update', targetId: skill.id } });
    const stale = await PATCH(`${BASE}/skills/${skill.id}`, admin.token, { name: 'Again', expectedUpdatedAt: skill.updatedAt });
    expect(stale.status).toBe(409);
    expect((await prisma.skill.findUnique({ where: { id: skill.id } }))!.name).toBe('Renamed');
    expect(await prisma.staffAudit.count({ where: { actionCode: 'content.skill.update', targetId: skill.id } })).toBe(before);
  });

  it('SA3-08 ARCHIVED Skill cannot be PATCHed', async () => {
    const admin = await makeAdmin();
    const { subjectId } = await seedSubject(admin);
    const skill = await mkSkill(admin.token, subjectId, 'Sk');
    await prisma.skill.update({ where: { id: skill.id }, data: { status: SkillStatus.ARCHIVED } });
    const fresh = await prisma.skill.findUnique({ where: { id: skill.id } });
    const res = await PATCH(`${BASE}/skills/${skill.id}`, admin.token, { name: 'x', expectedUpdatedAt: fresh!.updatedAt.toISOString() });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONTENT_SKILL_ARCHIVED');
  });

  // ── LessonSkill (SA3-09..16) ──
  it('SA3-09/16 add same-subject ACTIVE skill to DRAFT lesson advances token + audits', async () => {
    const admin = await makeAdmin();
    const { subjectId, topicId } = await seedSubject(admin);
    const lesson = await mkLesson(admin.token, topicId, 0);
    const skill = await mkSkill(admin.token, subjectId);
    const res = await P(`${BASE}/lessons/${lesson.id}/skills`, admin.token, { skillId: skill.id, expectedLessonUpdatedAt: lesson.updatedAt });
    expect(res.status).toBe(201);
    expect(new Date(res.body.lessonUpdatedAt).getTime()).toBeGreaterThan(new Date(lesson.updatedAt).getTime());
    expect(await prisma.lessonSkill.count({ where: { lessonId: lesson.id, skillId: skill.id } })).toBe(1);
    expect(await prisma.staffAudit.findFirst({ where: { actionCode: 'content.lesson_skill.add', targetId: lesson.id } })).toMatchObject({ actorUserId: admin.userId });
    // remove
    const rm = await DEL(`${BASE}/lessons/${lesson.id}/skills/${skill.id}`, admin.token, { expectedLessonUpdatedAt: res.body.lessonUpdatedAt });
    expect(rm.status).toBe(200);
    expect(await prisma.lessonSkill.count({ where: { lessonId: lesson.id } })).toBe(0);
  });

  it('SA3-10/11 cross-subject skill rejected (404); ARCHIVED skill cannot be assigned', async () => {
    const admin = await makeAdmin();
    const { subjectId, topicId } = await seedSubject(admin);
    const other = await seedSubject(admin);
    const lesson = await mkLesson(admin.token, topicId, 0);
    const foreignSkill = await mkSkill(admin.token, other.subjectId);
    expect((await P(`${BASE}/lessons/${lesson.id}/skills`, admin.token, { skillId: foreignSkill.id, expectedLessonUpdatedAt: lesson.updatedAt })).status).toBe(404);
    const archived = await mkSkill(admin.token, subjectId);
    await prisma.skill.update({ where: { id: archived.id }, data: { status: SkillStatus.ARCHIVED } });
    const res = await P(`${BASE}/lessons/${lesson.id}/skills`, admin.token, { skillId: archived.id, expectedLessonUpdatedAt: lesson.updatedAt });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONTENT_SKILL_ARCHIVED');
  });

  it('SA3-12 PUBLISHED Lesson mapping mutation rejected', async () => {
    const admin = await makeAdmin();
    const { subjectId, topicId } = await seedSubject(admin);
    const lesson = await mkLesson(admin.token, topicId, 0);
    const skill = await mkSkill(admin.token, subjectId);
    await prisma.lesson.update({ where: { id: lesson.id }, data: { status: LessonStatus.PUBLISHED } });
    const fresh = await prisma.lesson.findUnique({ where: { id: lesson.id } });
    const res = await P(`${BASE}/lessons/${lesson.id}/skills`, admin.token, { skillId: skill.id, expectedLessonUpdatedAt: fresh!.updatedAt.toISOString() });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONTENT_NOT_DRAFT');
  });

  it('SA3-13/14/15 idempotency: existing add / missing remove no-op with current token; stale → 409', async () => {
    const admin = await makeAdmin();
    const { subjectId, topicId } = await seedSubject(admin);
    const lesson = await mkLesson(admin.token, topicId, 0);
    const skill = await mkSkill(admin.token, subjectId);
    const add = await P(`${BASE}/lessons/${lesson.id}/skills`, admin.token, { skillId: skill.id, expectedLessonUpdatedAt: lesson.updatedAt });
    const t1 = add.body.lessonUpdatedAt;
    // SA3-13 idempotent add with CURRENT token → no advance, no extra audit
    const again = await P(`${BASE}/lessons/${lesson.id}/skills`, admin.token, { skillId: skill.id, expectedLessonUpdatedAt: t1 });
    expect(again.status).toBe(201);
    expect(again.body.lessonUpdatedAt).toBe(t1);
    expect(await prisma.staffAudit.count({ where: { actionCode: 'content.lesson_skill.add', targetId: lesson.id } })).toBe(1);
    // SA3-15 stale token even though already-mapped → 409
    expect((await P(`${BASE}/lessons/${lesson.id}/skills`, admin.token, { skillId: skill.id, expectedLessonUpdatedAt: lesson.updatedAt })).status).toBe(409);
    // SA3-14 missing remove no-op with current token (different lesson has no such mapping)
    const skill2 = await mkSkill(admin.token, subjectId);
    const rm = await DEL(`${BASE}/lessons/${lesson.id}/skills/${skill2.id}`, admin.token, { expectedLessonUpdatedAt: t1 });
    expect(rm.status).toBe(200);
    expect(rm.body.lessonUpdatedAt).toBe(t1); // no advance
  });

  // ── ActivitySkill (SA3-17..23) ──
  async function seedActivity(admin: { token: string }, subjectId: string, topicId: string) {
    const lesson = await mkLesson(admin.token, topicId, 0);
    const rev = (await P(`${BASE}/lessons/${lesson.id}/revisions`, admin.token, { title: 'R' })).body;
    const act = (await P(`${BASE}/revisions/${rev.id}/activities`, admin.token, { type: 'TEXT', position: 0, payload: md(), expectedRevisionUpdatedAt: rev.updatedAt })).body;
    return { revisionId: rev.id, activityId: act.activity.id, revToken: act.revisionUpdatedAt };
  }
  it('SA3-17/20/23 add same-subject skill to DRAFT-revision Activity uses revision token + advances it', async () => {
    const admin = await makeAdmin();
    const { subjectId, topicId } = await seedSubject(admin);
    const { activityId, revToken } = await seedActivity(admin, subjectId, topicId);
    const skill = await mkSkill(admin.token, subjectId);
    const res = await P(`${BASE}/activities/${activityId}/skills`, admin.token, { skillId: skill.id, expectedRevisionUpdatedAt: revToken });
    expect(res.status).toBe(201);
    expect(new Date(res.body.revisionUpdatedAt).getTime()).toBeGreaterThan(new Date(revToken).getTime());
    expect(await prisma.activitySkill.count({ where: { activityId, skillId: skill.id } })).toBe(1);
  });
  it('SA3-18/19/21 cross-subject rejected; non-DRAFT revision rejected; stale revision token → 409 no mutation', async () => {
    const admin = await makeAdmin();
    const { subjectId, topicId } = await seedSubject(admin);
    const other = await seedSubject(admin);
    const { activityId, revisionId, revToken } = await seedActivity(admin, subjectId, topicId);
    const foreign = await mkSkill(admin.token, other.subjectId);
    expect((await P(`${BASE}/activities/${activityId}/skills`, admin.token, { skillId: foreign.id, expectedRevisionUpdatedAt: revToken })).status).toBe(404);
    // stale token
    const skill = await mkSkill(admin.token, subjectId);
    const stale = await P(`${BASE}/activities/${activityId}/skills`, admin.token, { skillId: skill.id, expectedRevisionUpdatedAt: new Date(0).toISOString() });
    expect(stale.status).toBe(409);
    expect(await prisma.activitySkill.count({ where: { activityId } })).toBe(0);
    // non-DRAFT revision
    await prisma.lessonRevision.update({ where: { id: revisionId }, data: { status: RevisionStatus.REVIEW } });
    const cur = (await prisma.lessonRevision.findUnique({ where: { id: revisionId } }))!.updatedAt.toISOString();
    expect((await P(`${BASE}/activities/${activityId}/skills`, admin.token, { skillId: skill.id, expectedRevisionUpdatedAt: cur })).status).toBe(409);
  });

  // ── Prerequisites (PR-01..09) ──
  it('PR-01/07/08 A requires B; idempotent add + missing remove no-op with current token', async () => {
    const admin = await makeAdmin();
    const { topicId } = await seedSubject(admin);
    const a = await mkLesson(admin.token, topicId, 0);
    const b = await mkLesson(admin.token, topicId, 1);
    const add = await P(`${BASE}/lessons/${a.id}/prerequisites`, admin.token, { prerequisiteLessonId: b.id, expectedLessonUpdatedAt: a.updatedAt });
    expect(add.status).toBe(201);
    const t1 = add.body.lessonUpdatedAt;
    const again = await P(`${BASE}/lessons/${a.id}/prerequisites`, admin.token, { prerequisiteLessonId: b.id, expectedLessonUpdatedAt: t1 });
    expect(again.status).toBe(201);
    expect(again.body.lessonUpdatedAt).toBe(t1); // idempotent, no advance
    expect(await prisma.lessonPrerequisite.count({ where: { lessonId: a.id } })).toBe(1);
    const rm = await DEL(`${BASE}/lessons/${a.id}/prerequisites/${b.id}`, admin.token, { expectedLessonUpdatedAt: t1 });
    expect(rm.status).toBe(200);
    const rmMissing = await DEL(`${BASE}/lessons/${a.id}/prerequisites/${b.id}`, admin.token, { expectedLessonUpdatedAt: rm.body.lessonUpdatedAt });
    expect(rmMissing.status).toBe(200);
    expect(rmMissing.body.lessonUpdatedAt).toBe(rm.body.lessonUpdatedAt); // missing remove no-op
  });

  it('PR-02 cross-subject prerequisite rejected (404)', async () => {
    const admin = await makeAdmin();
    const s1 = await seedSubject(admin);
    const s2 = await seedSubject(admin);
    const a = await mkLesson(admin.token, s1.topicId, 0);
    const b = await mkLesson(admin.token, s2.topicId, 0);
    expect((await P(`${BASE}/lessons/${a.id}/prerequisites`, admin.token, { prerequisiteLessonId: b.id, expectedLessonUpdatedAt: a.updatedAt })).status).toBe(404);
  });

  it('PR-03/04 self-loop rejected by service (and DB CHECK remains defense-in-depth)', async () => {
    const admin = await makeAdmin();
    const { topicId } = await seedSubject(admin);
    const a = await mkLesson(admin.token, topicId, 0);
    const res = await P(`${BASE}/lessons/${a.id}/prerequisites`, admin.token, { prerequisiteLessonId: a.id, expectedLessonUpdatedAt: a.updatedAt });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CONTENT_PREREQUISITE_INVALID');
    // PR-04: the DB CHECK exists (self-loop insert directly fails)
    await expect(prisma.lessonPrerequisite.create({ data: { lessonId: a.id, prerequisiteLessonId: a.id } })).rejects.toThrow(/chk_lesson_prerequisite_no_self_loop|check constraint|violat|23514/i);
  });

  it('PR-05/06 target ARCHIVED rejected; PUBLISHED source mutation rejected', async () => {
    const admin = await makeAdmin();
    const { topicId } = await seedSubject(admin);
    const a = await mkLesson(admin.token, topicId, 0);
    const b = await mkLesson(admin.token, topicId, 1);
    await prisma.lesson.update({ where: { id: b.id }, data: { status: LessonStatus.ARCHIVED } });
    expect((await P(`${BASE}/lessons/${a.id}/prerequisites`, admin.token, { prerequisiteLessonId: b.id, expectedLessonUpdatedAt: a.updatedAt })).status).toBe(400);
    // PUBLISHED source
    const c = await mkLesson(admin.token, topicId, 2);
    await prisma.lesson.update({ where: { id: a.id }, data: { status: LessonStatus.PUBLISHED } });
    const fresh = await prisma.lesson.findUnique({ where: { id: a.id } });
    expect((await P(`${BASE}/lessons/${a.id}/prerequisites`, admin.token, { prerequisiteLessonId: c.id, expectedLessonUpdatedAt: fresh!.updatedAt.toISOString() })).status).toBe(409);
  });

  it('PR-09 stale source Lesson token → 409', async () => {
    const admin = await makeAdmin();
    const { topicId } = await seedSubject(admin);
    const a = await mkLesson(admin.token, topicId, 0);
    const b = await mkLesson(admin.token, topicId, 1);
    expect((await P(`${BASE}/lessons/${a.id}/prerequisites`, admin.token, { prerequisiteLessonId: b.id, expectedLessonUpdatedAt: new Date(0).toISOString() })).status).toBe(409);
  });

  // ── DAG cycle prevention (DAG e2e + concurrent) ──
  it('DAG-E1 sequential cycle rejected (A→B then B→A) with no touch/edge/audit', async () => {
    const admin = await makeAdmin();
    const { topicId } = await seedSubject(admin);
    const a = await mkLesson(admin.token, topicId, 0);
    const b = await mkLesson(admin.token, topicId, 1);
    await P(`${BASE}/lessons/${a.id}/prerequisites`, admin.token, { prerequisiteLessonId: b.id, expectedLessonUpdatedAt: a.updatedAt }).expect(201);
    const bBefore = (await prisma.lesson.findUnique({ where: { id: b.id } }))!.updatedAt.toISOString();
    const cyc = await P(`${BASE}/lessons/${b.id}/prerequisites`, admin.token, { prerequisiteLessonId: a.id, expectedLessonUpdatedAt: b.updatedAt });
    expect(cyc.status).toBe(409);
    expect(cyc.body.code).toBe('CONTENT_PREREQUISITE_CYCLE');
    expect((await prisma.lesson.findUnique({ where: { id: b.id } }))!.updatedAt.toISOString()).toBe(bBefore); // no touch
    expect(await prisma.lessonPrerequisite.count({ where: { lessonId: b.id, prerequisiteLessonId: a.id } })).toBe(0);
    expect(await prisma.staffAudit.count({ where: { actionCode: 'content.prerequisite.add', targetId: b.id } })).toBe(0);
  });

  it('DAG-E2 3-node cycle rejected (A→B, B→C, add C→A)', async () => {
    const admin = await makeAdmin();
    const { topicId } = await seedSubject(admin);
    const a = await mkLesson(admin.token, topicId, 0);
    const b = await mkLesson(admin.token, topicId, 1);
    const c = await mkLesson(admin.token, topicId, 2);
    const ab = await P(`${BASE}/lessons/${a.id}/prerequisites`, admin.token, { prerequisiteLessonId: b.id, expectedLessonUpdatedAt: a.updatedAt });
    await P(`${BASE}/lessons/${b.id}/prerequisites`, admin.token, { prerequisiteLessonId: c.id, expectedLessonUpdatedAt: b.updatedAt }).expect(201);
    const cyc = await P(`${BASE}/lessons/${c.id}/prerequisites`, admin.token, { prerequisiteLessonId: a.id, expectedLessonUpdatedAt: c.updatedAt });
    expect(cyc.status).toBe(409);
    expect(cyc.body.code).toBe('CONTENT_PREREQUISITE_CYCLE');
    void ab;
  });

  it('DAG-E3 CONCURRENT inverse edges cannot both commit (Subject-lock serialization) — MERGE BLOCKER', async () => {
    const admin = await makeAdmin();
    const { topicId } = await seedSubject(admin);
    const a = await mkLesson(admin.token, topicId, 0);
    const b = await mkLesson(admin.token, topicId, 1);
    const [r1, r2] = await Promise.all([
      P(`${BASE}/lessons/${a.id}/prerequisites`, admin.token, { prerequisiteLessonId: b.id, expectedLessonUpdatedAt: a.updatedAt }),
      P(`${BASE}/lessons/${b.id}/prerequisites`, admin.token, { prerequisiteLessonId: a.id, expectedLessonUpdatedAt: b.updatedAt }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses[0]).toBe(201);        // exactly one succeeds
    expect(statuses[1]).toBeGreaterThanOrEqual(400); // the other is a safe rejection (409)
    // final graph MUST be acyclic: A→B and B→A cannot both exist
    const edges = await prisma.lessonPrerequisite.findMany({ where: { lessonId: { in: [a.id, b.id] } }, select: { lessonId: true, prerequisiteLessonId: true } });
    const hasAB = edges.some((e) => e.lessonId === a.id && e.prerequisiteLessonId === b.id);
    const hasBA = edges.some((e) => e.lessonId === b.id && e.prerequisiteLessonId === a.id);
    expect(hasAB && hasBA).toBe(false);
    expect(edges.length).toBe(1);
  });

  it('GA-1 audit-failure during prerequisite add rolls the edge + Lesson touch back', async () => {
    const admin = await makeAdmin();
    const { topicId } = await seedSubject(admin);
    const a = await mkLesson(admin.token, topicId, 0);
    const b = await mkLesson(admin.token, topicId, 1);
    const spy = jest.spyOn(auditRepo, 'write').mockRejectedValueOnce(new Error('audit boom'));
    const res = await P(`${BASE}/lessons/${a.id}/prerequisites`, admin.token, { prerequisiteLessonId: b.id, expectedLessonUpdatedAt: a.updatedAt });
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/audit boom|prisma/i);
    spy.mockRestore();
    expect(await prisma.lessonPrerequisite.count({ where: { lessonId: a.id } })).toBe(0); // edge rolled back
    expect((await prisma.lesson.findUnique({ where: { id: a.id } }))!.updatedAt.toISOString()).toBe(a.updatedAt); // touch rolled back
    expect(await prisma.staffAudit.count({ where: { actionCode: 'content.prerequisite.add' } })).toBe(0);
  });
});
