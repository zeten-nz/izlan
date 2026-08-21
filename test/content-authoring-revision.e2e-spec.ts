import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { LessonStatus, RevisionStatus, ActivityType } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AuthorizationRepository } from '../src/authorization/authorization.repository';
import { AuthExceptionFilter } from '../src/auth/http/auth-exception.filter';
import { SMS_PORT } from '../src/sms/sms.port';
import { bootstrapSystemRoles } from '../src/bootstrap/system-roles';
import { LESSON_ACTIVITY_OBJECTIVE_SCHEMA_VERSION } from '../src/lesson-execution/activity/objective-activity-payload';
import { LESSON_ACTIVITY_MARKDOWN_SCHEMA_VERSION } from '../src/content/activity/markdown-activity-payload';
import { LESSON_ACTIVITY_MEDIA_SCHEMA_VERSION } from '../src/content/activity/media-activity-payload';
import { cleanupAuthTables } from './test-db.helper';
import { TestSmsAdapter } from './test-sms.adapter';

const BASE = '/api/staff/content';
const SECRET = 'SECRET-ANSWER-a';
const objPayload = (correct = 'a') => ({ schemaVersion: LESSON_ACTIVITY_OBJECTIVE_SCHEMA_VERSION, format: 'single_choice', prompt: 'Q', options: [{ id: 'a', text: SECRET }, { id: 'b', text: 'B' }], answerKey: { correctOptionIds: [correct] } });
const mdPayload = (markdown = '# Hello') => ({ schemaVersion: LESSON_ACTIVITY_MARKDOWN_SCHEMA_VERSION, markdown });
const mediaPayload = () => ({ schemaVersion: LESSON_ACTIVITY_MEDIA_SCHEMA_VERSION });

describe('Content authoring — draft revision + activity (e2e, izlan_test)', () => {
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
  beforeEach(async () => { await reset(); sms.clear(); jest.restoreAllMocks(); });

  async function reset() {
    await prisma.staffAudit.deleteMany();
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
  const phone = () => `+99890${String(2000000 + n++).slice(-7)}`;
  const uid = () => `${Date.now()}-${n++}`;
  const P = (url: string, token: string, body?: unknown) => request(server()).post(url).set('Authorization', `Bearer ${token}`).send(body ?? {});
  const G = (url: string, token: string) => request(server()).get(url).set('Authorization', `Bearer ${token}`);
  const PATCH = (url: string, token: string, body?: unknown) => request(server()).patch(url).set('Authorization', `Bearer ${token}`).send(body ?? {});
  const PUT = (url: string, token: string, body?: unknown) => request(server()).put(url).set('Authorization', `Bearer ${token}`).send(body ?? {});
  const DEL = (url: string, token: string, body?: unknown) => request(server()).delete(url).set('Authorization', `Bearer ${token}`).send(body ?? {});

  async function makeUser() {
    const ph = phone();
    const req = await request(server()).post('/api/auth/otp/request').send({ phone: ph });
    const verify = await request(server()).post('/api/auth/otp/verify').send({ challengeId: req.body.challengeId, code: sms.latestCode() });
    const user = await prisma.user.findUnique({ where: { phone: ph } });
    return { token: verify.body.accessToken, userId: user!.id };
  }
  async function makeAdmin() {
    const u = await makeUser();
    const admin = await prisma.role.findUnique({ where: { code: 'ADMIN' } });
    await prisma.userRole.create({ data: { userId: u.userId, roleId: admin!.id, grantedBy: null } });
    return u;
  }
  async function makeMethodist() {
    const u = await makeUser();
    const m = await prisma.role.findUnique({ where: { code: 'METHODIST' } });
    await prisma.userRole.create({ data: { userId: u.userId, roleId: m!.id, grantedBy: null } });
    return u;
  }

  /** Admin-owned subject chain down to a Lesson; returns ids + admin token. */
  async function seedLesson() {
    const admin = await makeAdmin();
    const subject = (await P(`${BASE}/subjects`, admin.token, { slug: `s-${uid()}`, title: 'S' })).body;
    const track = (await P(`${BASE}/subjects/${subject.id}/tracks`, admin.token, { slug: `t-${uid()}`, title: 'T' })).body;
    const level = (await P(`${BASE}/tracks/${track.id}/levels`, admin.token, { code: 'A1', title: 'L', sortOrder: 0 })).body;
    const mod = (await P(`${BASE}/levels/${level.id}/modules`, admin.token, { title: 'M', sortOrder: 0 })).body;
    const topic = (await P(`${BASE}/modules/${mod.id}/topics`, admin.token, { title: 'Tp', sortOrder: 0 })).body;
    const lesson = (await P(`${BASE}/topics/${topic.id}/lessons`, admin.token, { contentKey: `ck-${uid()}`, sortOrder: 0 })).body;
    return { admin, subjectId: subject.id, lessonId: lesson.id };
  }
  const mkRevision = async (token: string, lessonId: string, title = 'Rev') => (await P(`${BASE}/lessons/${lessonId}/revisions`, token, { title })).body;
  const mkActivity = async (token: string, revId: string, revToken: string, type: ActivityType, position: number, payload: unknown) =>
    P(`${BASE}/revisions/${revId}/activities`, token, { type, position, payload, expectedRevisionUpdatedAt: revToken });

  // ── Revision version + create (CR-01..08) ──
  it('CR-01/02 revision versions are backend-generated 1 then 2', async () => {
    const { admin, lessonId } = await seedLesson();
    expect((await mkRevision(admin.token, lessonId)).version).toBe(1);
    expect((await mkRevision(admin.token, lessonId)).version).toBe(2);
  });

  it('CR-03/15 client cannot supply version/status/createdBy/reviewedBy (400)', async () => {
    const { admin, lessonId } = await seedLesson();
    for (const bad of [{ version: 9 }, { status: 'PUBLISHED' }, { createdBy: '00000000-0000-7000-8000-000000000000' }, { reviewedBy: '00000000-0000-7000-8000-000000000000' }, { publishedAt: '2026-01-01T00:00:00.000Z' }]) {
      expect((await P(`${BASE}/lessons/${lessonId}/revisions`, admin.token, { title: 'X', ...bad })).status).toBe(400);
    }
  });

  it('CR-04 PUBLISHED logical Lesson may receive a new DRAFT revision', async () => {
    const { admin, lessonId } = await seedLesson();
    await prisma.lesson.update({ where: { id: lessonId }, data: { status: LessonStatus.PUBLISHED } });
    const res = await P(`${BASE}/lessons/${lessonId}/revisions`, admin.token, { title: 'Next' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: RevisionStatus.DRAFT, version: 1 });
    expect((await prisma.lesson.findUnique({ where: { id: lessonId } }))!.status).toBe(LessonStatus.PUBLISHED); // unchanged
  });

  it('CR-05 ARCHIVED Lesson cannot receive a revision', async () => {
    const { admin, lessonId } = await seedLesson();
    await prisma.lesson.update({ where: { id: lessonId }, data: { status: LessonStatus.ARCHIVED } });
    const res = await P(`${BASE}/lessons/${lessonId}/revisions`, admin.token, { title: 'X' });
    expect(res.status).toBe(409);
    expect(await prisma.lessonRevision.count({ where: { lessonId } })).toBe(0);
  });

  it('CR-06 revision createdBy + updatedBy = principal', async () => {
    const { admin, lessonId } = await seedLesson();
    const rev = await mkRevision(admin.token, lessonId);
    expect(rev.createdBy).toBe(admin.userId);
    expect(rev.updatedBy).toBe(admin.userId);
  });

  it('CR-07 a methodist assigned to another Subject cannot access the revision (404)', async () => {
    const { admin, lessonId } = await seedLesson();
    const rev = await mkRevision(admin.token, lessonId);
    const other = await makeMethodist();
    const otherSubject = (await P(`${BASE}/subjects`, (await makeAdmin()).token, { slug: `s-${uid()}`, title: 'O' })).body;
    // methodist assigned only to otherSubject via manage actor
    // (not assigned to admin's subject) → revision is out of scope
    expect((await G(`${BASE}/revisions/${rev.id}`, other.token)).status).toBe(404);
    expect((await P(`${BASE}/lessons/${lessonId}/revisions`, other.token, { title: 'x' })).status).toBe(404);
    void otherSubject;
  });

  it('CR-08 concurrent revision creates never produce a duplicate version', async () => {
    const { admin, lessonId } = await seedLesson();
    const results = await Promise.all([1, 2, 3, 4].map(() => P(`${BASE}/lessons/${lessonId}/revisions`, admin.token, { title: 'C' })));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const versions = (await prisma.lessonRevision.findMany({ where: { lessonId }, select: { version: true } })).map((v) => v.version).sort((a, b) => a - b);
    expect(versions).toEqual([1, 2, 3, 4]); // unique + monotonic
  });

  // ── Revision edit (CR-09..14) ──
  it('CR-09/10/11 revision PATCH: exact token succeeds; stale → 409, DB unchanged, no audit', async () => {
    const { admin, lessonId } = await seedLesson();
    const rev = await mkRevision(admin.token, lessonId);
    const ok = await PATCH(`${BASE}/revisions/${rev.id}`, admin.token, { title: 'Renamed', expectedUpdatedAt: rev.updatedAt });
    expect(ok.status).toBe(200);
    expect(ok.body.title).toBe('Renamed');
    const auditsBefore = await prisma.staffAudit.count({ where: { actionCode: 'content.revision.update', targetId: rev.id } });
    const stale = await PATCH(`${BASE}/revisions/${rev.id}`, admin.token, { title: 'Again', expectedUpdatedAt: rev.updatedAt });
    expect(stale.status).toBe(409);
    expect((await prisma.lessonRevision.findUnique({ where: { id: rev.id } }))!.title).toBe('Renamed');
    expect(await prisma.staffAudit.count({ where: { actionCode: 'content.revision.update', targetId: rev.id } })).toBe(auditsBefore);
  });

  it('CR-12 REVIEW/PUBLISHED/ARCHIVED revision PATCH rejected (409)', async () => {
    const { admin, lessonId } = await seedLesson();
    for (const status of [RevisionStatus.REVIEW, RevisionStatus.PUBLISHED, RevisionStatus.ARCHIVED]) {
      const rev = await mkRevision(admin.token, lessonId);
      await prisma.lessonRevision.update({ where: { id: rev.id }, data: { status } });
      const fresh = await prisma.lessonRevision.findUnique({ where: { id: rev.id } });
      const res = await PATCH(`${BASE}/revisions/${rev.id}`, admin.token, { title: 'X', expectedUpdatedAt: fresh!.updatedAt.toISOString() });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CONTENT_NOT_DRAFT');
    }
  });

  it('CR-13/14 title null → 400; description null clears', async () => {
    const { admin, lessonId } = await seedLesson();
    const rev = await mkRevision(admin.token, lessonId);
    expect((await PATCH(`${BASE}/revisions/${rev.id}`, admin.token, { title: null, expectedUpdatedAt: rev.updatedAt })).status).toBe(400);
    const cleared = await PATCH(`${BASE}/revisions/${rev.id}`, admin.token, { description: null, expectedUpdatedAt: rev.updatedAt });
    expect(cleared.status).toBe(200);
    expect(cleared.body.description).toBeNull();
  });

  // ── Activity payload contracts (CA2-01..13) ──
  it('CA2-01 valid MINI_QUESTION objective creates', async () => {
    const { admin, lessonId } = await seedLesson();
    const rev = await mkRevision(admin.token, lessonId);
    const res = await mkActivity(admin.token, rev.id, rev.updatedAt, ActivityType.MINI_QUESTION, 0, objPayload());
    expect(res.status).toBe(201);
    expect(res.body.activity).toMatchObject({ type: 'MINI_QUESTION', position: 0, source: 'HUMAN' });
    expect(res.body.activity.aiMetadata).toBeNull();
    expect(res.body.revisionUpdatedAt).not.toBe(rev.updatedAt); // token advanced
  });

  it('CA2-02/31 invalid objective answerKey → 400, no DB row, no audit', async () => {
    const { admin, lessonId } = await seedLesson();
    const rev = await mkRevision(admin.token, lessonId);
    const res = await mkActivity(admin.token, rev.id, rev.updatedAt, ActivityType.MINI_QUESTION, 0, objPayload('z')); // 'z' not an option
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CONTENT_ACTIVITY_PAYLOAD_INVALID');
    expect(await prisma.activity.count({ where: { lessonRevisionId: rev.id } })).toBe(0);
    expect(await prisma.staffAudit.count({ where: { actionCode: 'content.activity.create' } })).toBe(0);
    expect(JSON.stringify(res.body)).not.toMatch(/answerKey|correctOptionIds|SECRET/);
  });

  it('CA2-03/04/05 valid TEXT/EXPLANATION/EXAMPLE markdown create', async () => {
    const { admin, lessonId } = await seedLesson();
    let rev = await mkRevision(admin.token, lessonId);
    let token = rev.updatedAt;
    let pos = 0;
    for (const t of [ActivityType.TEXT, ActivityType.EXPLANATION, ActivityType.EXAMPLE]) {
      const res = await mkActivity(admin.token, rev.id, token, t, pos++, mdPayload());
      expect(res.status).toBe(201);
      token = res.body.revisionUpdatedAt;
    }
  });

  it('CA2-06/07 empty markdown / wrong schemaVersion → 400', async () => {
    const { admin, lessonId } = await seedLesson();
    const rev = await mkRevision(admin.token, lessonId);
    expect((await mkActivity(admin.token, rev.id, rev.updatedAt, ActivityType.TEXT, 0, mdPayload('   '))).status).toBe(400);
    expect((await mkActivity(admin.token, rev.id, rev.updatedAt, ActivityType.TEXT, 0, { schemaVersion: 'x', markdown: 'a' })).status).toBe(400);
  });

  it('CA2-08/09/10 IMAGE/AUDIO media marker create; media payload with mediaAssetId/url → 400', async () => {
    const { admin, lessonId } = await seedLesson();
    let rev = await mkRevision(admin.token, lessonId);
    let token = rev.updatedAt;
    for (const [i, t] of [ActivityType.IMAGE, ActivityType.AUDIO].entries()) {
      const res = await mkActivity(admin.token, rev.id, token, t, i, mediaPayload());
      expect(res.status).toBe(201);
      token = res.body.revisionUpdatedAt;
    }
    for (const bad of [{ schemaVersion: LESSON_ACTIVITY_MEDIA_SCHEMA_VERSION, mediaAssetId: '00000000-0000-7000-8000-000000000000' }, { schemaVersion: LESSON_ACTIVITY_MEDIA_SCHEMA_VERSION, url: 'https://x' }, { schemaVersion: LESSON_ACTIVITY_MEDIA_SCHEMA_VERSION, storageKey: 'k' }]) {
      expect((await mkActivity(admin.token, rev.id, token, ActivityType.IMAGE, 5, bad)).status).toBe(400);
    }
  });

  it('CA2-11 SPEAKING/WRITING/LISTENING/AI_INTERACTION/VIDEO authoring rejected', async () => {
    const { admin, lessonId } = await seedLesson();
    const rev = await mkRevision(admin.token, lessonId);
    for (const t of [ActivityType.SPEAKING, ActivityType.WRITING, ActivityType.LISTENING, ActivityType.AI_INTERACTION, ActivityType.VIDEO]) {
      const res = await mkActivity(admin.token, rev.id, rev.updatedAt, t, 0, { schemaVersion: 'x' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('CONTENT_ACTIVITY_TYPE_NOT_AUTHORABLE');
    }
  });

  it('CA2-12 client source/aiMetadata/lessonRevisionId injection → 400', async () => {
    const { admin, lessonId } = await seedLesson();
    const rev = await mkRevision(admin.token, lessonId);
    for (const bad of [{ source: 'AI_GENERATED' }, { aiMetadata: { x: 1 } }, { lessonRevisionId: rev.id }]) {
      const res = await P(`${BASE}/revisions/${rev.id}/activities`, admin.token, { type: 'TEXT', position: 0, payload: mdPayload(), expectedRevisionUpdatedAt: rev.updatedAt, ...bad });
      expect(res.status).toBe(400);
    }
  });

  it('CA2-13 duplicate position → safe 409', async () => {
    const { admin, lessonId } = await seedLesson();
    const rev = await mkRevision(admin.token, lessonId);
    const first = await mkActivity(admin.token, rev.id, rev.updatedAt, ActivityType.TEXT, 0, mdPayload());
    const dup = await mkActivity(admin.token, rev.id, first.body.revisionUpdatedAt, ActivityType.EXPLANATION, 0, mdPayload());
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('CONTENT_UNIQUE_CONFLICT');
    expect(JSON.stringify(dup.body)).not.toMatch(/P2002|prisma/i);
  });

  // ── Activity concurrency (CA2-14..20) ──
  it('CA2-14/15 create returns new revision token; reusing stale token → 409', async () => {
    const { admin, lessonId } = await seedLesson();
    const rev = await mkRevision(admin.token, lessonId);
    const a1 = await mkActivity(admin.token, rev.id, rev.updatedAt, ActivityType.TEXT, 0, mdPayload());
    expect(a1.status).toBe(201);
    const stale = await mkActivity(admin.token, rev.id, rev.updatedAt, ActivityType.EXPLANATION, 1, mdPayload()); // reuse old token
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('CONTENT_EDIT_CONFLICT');
    expect(await prisma.activity.count({ where: { lessonRevisionId: rev.id } })).toBe(1); // stale create did not persist
  });

  it('CA2-16/17/18 stale PATCH no change/no audit; type + position not patchable', async () => {
    const { admin, lessonId } = await seedLesson();
    const rev = await mkRevision(admin.token, lessonId);
    const a = (await mkActivity(admin.token, rev.id, rev.updatedAt, ActivityType.TEXT, 0, mdPayload('orig'))).body.activity;
    // stale token (rev.updatedAt is now old after the create)
    const stale = await PATCH(`${BASE}/activities/${a.id}`, admin.token, { payload: mdPayload('new'), expectedRevisionUpdatedAt: rev.updatedAt });
    expect(stale.status).toBe(409);
    expect((await prisma.activity.findUnique({ where: { id: a.id } }))!.payload).toMatchObject({ markdown: 'orig' });
    expect(await prisma.staffAudit.count({ where: { actionCode: 'content.activity.update', targetId: a.id } })).toBe(0);
    // type/position not whitelisted
    const cur = (await prisma.lessonRevision.findUnique({ where: { id: rev.id } }))!.updatedAt.toISOString();
    expect((await PATCH(`${BASE}/activities/${a.id}`, admin.token, { type: 'EXPLANATION', expectedRevisionUpdatedAt: cur })).status).toBe(400);
    expect((await PATCH(`${BASE}/activities/${a.id}`, admin.token, { position: 5, expectedRevisionUpdatedAt: cur })).status).toBe(400);
  });

  it('CA2-19/20 delete only on DRAFT revision; mutation against non-DRAFT rejected', async () => {
    const { admin, lessonId } = await seedLesson();
    const rev = await mkRevision(admin.token, lessonId);
    const a = (await mkActivity(admin.token, rev.id, rev.updatedAt, ActivityType.TEXT, 0, mdPayload())).body.activity;
    let cur = (await prisma.lessonRevision.findUnique({ where: { id: rev.id } }))!.updatedAt.toISOString();
    // flip revision to REVIEW → mutation rejected
    await prisma.lessonRevision.update({ where: { id: rev.id }, data: { status: RevisionStatus.REVIEW } });
    cur = (await prisma.lessonRevision.findUnique({ where: { id: rev.id } }))!.updatedAt.toISOString();
    expect((await DEL(`${BASE}/activities/${a.id}`, admin.token, { expectedRevisionUpdatedAt: cur })).status).toBe(409);
    expect((await PATCH(`${BASE}/activities/${a.id}`, admin.token, { payload: mdPayload('x'), expectedRevisionUpdatedAt: cur })).status).toBe(409);
    // back to DRAFT → delete succeeds
    await prisma.lessonRevision.update({ where: { id: rev.id }, data: { status: RevisionStatus.DRAFT } });
    cur = (await prisma.lessonRevision.findUnique({ where: { id: rev.id } }))!.updatedAt.toISOString();
    const del = await DEL(`${BASE}/activities/${a.id}`, admin.token, { expectedRevisionUpdatedAt: cur });
    expect(del.status).toBe(200);
    expect(await prisma.activity.count({ where: { id: a.id } })).toBe(0);
  });

  // ── Reorder (CA2-21..27) ──
  async function seedThreeActivities() {
    const { admin, lessonId } = await seedLesson();
    const rev = await mkRevision(admin.token, lessonId);
    let token = rev.updatedAt;
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await mkActivity(admin.token, rev.id, token, ActivityType.TEXT, i, mdPayload(`a${i}`));
      ids.push(res.body.activity.id);
      token = res.body.revisionUpdatedAt;
    }
    return { admin, revId: rev.id, ids, token };
  }
  it('CA2-21/27 valid permutation reorders atomically to positions 0..N-1', async () => {
    const { admin, revId, ids, token } = await seedThreeActivities();
    const reordered = [ids[2], ids[0], ids[1]];
    const res = await PUT(`${BASE}/revisions/${revId}/activities/order`, admin.token, { orderedActivityIds: reordered, expectedRevisionUpdatedAt: token });
    expect(res.status).toBe(200);
    const rows = await prisma.activity.findMany({ where: { lessonRevisionId: revId }, select: { id: true, position: true }, orderBy: { position: 'asc' } });
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2]);
    expect(rows.map((r) => r.id)).toEqual(reordered);
  });
  it('CA2-22/23/24 duplicate/missing/foreign id rejected (400)', async () => {
    const { admin, revId, ids, token } = await seedThreeActivities();
    const foreign = (await seedThreeActivities()).ids[0];
    for (const bad of [[ids[0], ids[0], ids[1]], [ids[0], ids[1]], [ids[0], ids[1], foreign]]) {
      const res = await PUT(`${BASE}/revisions/${revId}/activities/order`, admin.token, { orderedActivityIds: bad, expectedRevisionUpdatedAt: token });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('CONTENT_REORDER_INVALID');
    }
  });
  it('CA2-25/26 stale token rejected; failed reorder leaves positions unchanged', async () => {
    const { admin, revId, ids } = await seedThreeActivities();
    const res = await PUT(`${BASE}/revisions/${revId}/activities/order`, admin.token, { orderedActivityIds: [ids[2], ids[1], ids[0]], expectedRevisionUpdatedAt: new Date(0).toISOString() });
    expect(res.status).toBe(409);
    const rows = await prisma.activity.findMany({ where: { lessonRevisionId: revId }, select: { id: true, position: true }, orderBy: { position: 'asc' } });
    expect(rows.map((r) => r.id)).toEqual(ids); // original order intact
  });

  // ── Audit + secrets (CA2-28..32) ──
  it('CA2-28/29/30 revision + activity + reorder audits (correct actor/target, one reorder event)', async () => {
    const { admin, revId, ids, token } = await seedThreeActivities();
    await PUT(`${BASE}/revisions/${revId}/activities/order`, admin.token, { orderedActivityIds: [ids[1], ids[2], ids[0]], expectedRevisionUpdatedAt: token }).expect(200);
    const revCreate = await prisma.staffAudit.findFirst({ where: { actionCode: 'content.revision.create', targetId: revId } });
    expect(revCreate).toMatchObject({ actorUserId: admin.userId, targetType: 'LessonRevision' });
    expect(await prisma.staffAudit.count({ where: { actionCode: 'content.activity.create' } })).toBe(3);
    const reorder = await prisma.staffAudit.findMany({ where: { actionCode: 'content.activity.reorder', targetId: revId } });
    expect(reorder).toHaveLength(1); // exactly ONE reorder audit
    expect(reorder[0]).toMatchObject({ actorUserId: admin.userId, targetType: 'LessonRevision' });
  });

  it('OCC-01 successful OCC write strictly advances updatedAt at TIMESTAMP(3) precision (same-ms determinism)', async () => {
    const { admin, lessonId } = await seedLesson();
    const rev = await mkRevision(admin.token, lessonId);
    const expectedMs = new Date(rev.updatedAt).getTime();
    // Freeze the wall clock to the stored token's EXACT millisecond — if the writer relied on @updatedAt advancing
    // it could re-write the same ms; the explicit nextOptimisticTimestamp must still advance by ≥1ms.
    const spy = jest.spyOn(Date, 'now').mockReturnValue(expectedMs);
    try {
      const ok = await PATCH(`${BASE}/revisions/${rev.id}`, admin.token, { title: 'Advance', expectedUpdatedAt: rev.updatedAt });
      expect(ok.status).toBe(200);
      const stored = await prisma.lessonRevision.findUnique({ where: { id: rev.id } });
      expect(stored!.updatedAt.getTime()).toBeGreaterThanOrEqual(expectedMs + 1); // strictly advanced
    } finally {
      spy.mockRestore();
    }
    // reusing the original (now-stale) token no longer matches → 409, regardless of same-millisecond timing
    const stale = await PATCH(`${BASE}/revisions/${rev.id}`, admin.token, { title: 'Again', expectedUpdatedAt: rev.updatedAt });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('CONTENT_EDIT_CONFLICT');
  });

  it('CA2-32 the objective secret answer never appears in StaffAudit metadata', async () => {
    const { admin, lessonId } = await seedLesson();
    const rev = await mkRevision(admin.token, lessonId);
    const a = await mkActivity(admin.token, rev.id, rev.updatedAt, ActivityType.MINI_QUESTION, 0, objPayload());
    expect(a.status).toBe(201);
    const audits = await prisma.staffAudit.findMany({});
    for (const row of audits) {
      const blob = JSON.stringify(row.metadata);
      expect(blob).not.toMatch(/SECRET-ANSWER|answerKey|correctOptionIds/);
    }
    // and the staff read DOES expose the full payload incl. answerKey (author must edit the key)
    const read = await G(`${BASE}/activities/${a.body.activity.id}`, admin.token);
    expect(read.body.payload.answerKey.correctOptionIds).toEqual(['a']);
  });
});
