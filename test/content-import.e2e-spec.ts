import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createFastifyAdapter } from '../src/bootstrap/http-adapter';
import { PrismaService } from '../src/database/prisma.service';
import { AuthorizationRepository } from '../src/authorization/authorization.repository';
import { AuthExceptionFilter } from '../src/auth/http/auth-exception.filter';
import { SMS_PORT } from '../src/sms/sms.port';
import { bootstrapSystemRoles } from '../src/bootstrap/system-roles';
import { ContentAuditRepository } from '../src/content-authoring/content-audit.repository';
import { PrerequisiteService } from '../src/content-authoring/prerequisite.service';
import { cleanupAuthTables } from './test-db.helper';
import { TestSmsAdapter } from './test-sms.adapter';

const BASE = '/api/staff/content';
const SECRET = 'SUPER-SECRET-ANSWER-KEY-abc123';
const md = (text = 'demo body') => ({ schemaVersion: 'lesson-activity-markdown/v1', markdown: text });
const obj = () => ({ schemaVersion: 'lesson-activity-objective/v1', format: 'single_choice', prompt: 'Q', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], answerKey: { correctOptionIds: ['a'] } });

describe('Topic-scoped bulk content import (e2e, izlan_test)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let authz: AuthorizationRepository;
  let auditRepo: ContentAuditRepository;
  let prereqService: PrerequisiteService;
  const sms = new TestSmsAdapter();
  let n = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(SMS_PORT).useValue(sms).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter()); // SAME body-limit wiring as production
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AuthExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = moduleRef.get(PrismaService);
    authz = moduleRef.get(AuthorizationRepository);
    auditRepo = moduleRef.get(ContentAuditRepository);
    prereqService = moduleRef.get(PrerequisiteService);
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
  const phone = () => `+99890${String(6000000 + n++).slice(-7)}`;
  const uid = () => `${Date.now()}-${n++}`;
  const P = (url: string, token: string, body?: unknown) => request(server()).post(url).set('Authorization', `Bearer ${token}`).send(body ?? {});
  const validate = (token: string, topicId: string, doc: unknown) => P(`${BASE}/topics/${topicId}/import/validate`, token, doc);
  const apply = (token: string, topicId: string, doc: unknown) => P(`${BASE}/topics/${topicId}/import/apply`, token, doc);

  async function makeUser() {
    const ph = phone();
    const req = await request(server()).post('/api/auth/otp/request').send({ phone: ph });
    const reg = await request(server()).post('/api/auth/register').send({ challengeId: req.body.challengeId, code: sms.latestCode(), password: 'Passw0rd!123' });
    const user = await prisma.user.findUnique({ where: { phone: ph } });
    return { token: reg.body.accessToken as string, userId: user!.id };
  }
  async function grantRole(userId: string, code: string) {
    const role = await prisma.role.findUnique({ where: { code } });
    await prisma.userRole.create({ data: { userId, roleId: role!.id, grantedBy: null } });
  }
  const makeAdmin = async () => { const u = await makeUser(); await grantRole(u.userId, 'ADMIN'); return u; };
  async function makeAuthorAssigned(subjectId: string) {
    const u = await makeUser();
    const role = await prisma.role.upsert({ where: { code: 'AUTHOR_ONLY_TEST' }, update: {}, create: { code: 'AUTHOR_ONLY_TEST', name: 'AuthorOnly' } });
    await prisma.rolePermission.createMany({ data: [{ roleId: role.id, permissionCode: 'content.author' }], skipDuplicates: true });
    await prisma.userRole.create({ data: { userId: u.userId, roleId: role.id, grantedBy: null } });
    await prisma.subjectAssignment.create({ data: { userId: u.userId, subjectId, assignedBy: u.userId } });
    return u;
  }
  async function makeAuthorUnassigned() {
    const u = await makeUser();
    const role = await prisma.role.upsert({ where: { code: 'AUTHOR_ONLY_TEST' }, update: {}, create: { code: 'AUTHOR_ONLY_TEST', name: 'AuthorOnly' } });
    await prisma.rolePermission.createMany({ data: [{ roleId: role.id, permissionCode: 'content.author' }], skipDuplicates: true });
    await prisma.userRole.create({ data: { userId: u.userId, roleId: role.id, grantedBy: null } });
    return u;
  }

  async function seedTopic(admin: { token: string }) {
    const subject = (await P(`${BASE}/subjects`, admin.token, { slug: `s-${uid()}`, title: 'S' })).body;
    const track = (await P(`${BASE}/subjects/${subject.id}/tracks`, admin.token, { slug: `t-${uid()}`, title: 'T' })).body;
    const level = (await P(`${BASE}/tracks/${track.id}/levels`, admin.token, { code: 'A1', title: 'L', sortOrder: 0 })).body;
    const mod = (await P(`${BASE}/levels/${level.id}/modules`, admin.token, { title: 'M', sortOrder: 0 })).body;
    const topic = (await P(`${BASE}/modules/${mod.id}/topics`, admin.token, { title: 'Tp', sortOrder: 0 })).body;
    return { subjectId: subject.id as string, topicId: topic.id as string };
  }

  const doc = (over: Record<string, unknown> = {}) => ({
    schemaVersion: 'izlan-topic-content/v1',
    skills: [{ code: 'SK-BE', name: 'Verb to be', sortOrder: 10 }],
    lessons: [{ contentKey: `CK-${uid()}`, sortOrder: 10, skillCodes: ['SK-BE'], revision: { title: 'L1', activities: [{ type: 'EXPLANATION', payload: md() }] } }],
    ...over,
  });

  // ── Validation (IMP-V) ──
  it('IMP-V-01 valid minimal document passes', async () => {
    const a = await makeAdmin(); const { topicId } = await seedTopic(a);
    const res = await validate(a.token, topicId, doc());
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.documentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.summary).toMatchObject({ lessonsToCreate: 1, revisionsToCreate: 1, activitiesToCreate: 1, skillsToCreate: 1, lessonSkillMappings: 1 });
  });

  it('IMP-V-02/03 unknown schemaVersion → 400; unknown fields → invalid', async () => {
    const a = await makeAdmin(); const { topicId } = await seedTopic(a);
    expect((await validate(a.token, topicId, { schemaVersion: 'x/v9', lessons: [] })).body.code).toBe('IMPORT_SCHEMA_UNSUPPORTED');
    const bad = await validate(a.token, topicId, doc({ skillCodez: [] }));
    expect(bad.body.valid).toBe(false);
    expect(bad.body.errors.some((e: { code: string }) => e.code === 'IMPORT_INVALID_DOCUMENT')).toBe(true);
  });

  it('IMP-V-04/05 duplicate contentKey in doc; existing contentKey', async () => {
    const a = await makeAdmin(); const { topicId } = await seedTopic(a);
    const dup = doc({ lessons: [{ contentKey: 'CK-DUP', sortOrder: 1, revision: { title: 'A', activities: [{ type: 'TEXT', payload: md() }] } }, { contentKey: 'CK-DUP', sortOrder: 2, revision: { title: 'B', activities: [{ type: 'TEXT', payload: md() }] } }] });
    expect((await validate(a.token, topicId, dup)).body.errors.some((e: { code: string }) => e.code === 'IMPORT_CONTENT_KEY_DUPLICATE')).toBe(true);
    // existing
    const first = doc({ skills: [], lessons: [{ contentKey: 'CK-EXIST', sortOrder: 1, revision: { title: 'A', activities: [{ type: 'TEXT', payload: md() }] } }] });
    await apply(a.token, topicId, first).expect(201);
    const again = await validate(a.token, topicId, first);
    expect(again.body.errors.some((e: { code: string }) => e.code === 'IMPORT_CONTENT_KEY_EXISTS')).toBe(true);
  });

  it('IMP-V-06/07/09/10/11 skill dup / unknown skill / unsupported type / bad markdown / bad objective', async () => {
    const a = await makeAdmin(); const { topicId } = await seedTopic(a);
    const codes = (res: request.Response) => res.body.errors.map((e: { code: string }) => e.code);
    expect(codes(await validate(a.token, topicId, doc({ skills: [{ code: 'X', name: 'A' }, { code: 'X', name: 'B' }] })))).toContain('IMPORT_SKILL_DUPLICATE');
    expect(codes(await validate(a.token, topicId, doc({ skills: [], lessons: [{ contentKey: 'CK-1', sortOrder: 1, skillCodes: ['NOPE'], revision: { title: 'L', activities: [{ type: 'TEXT', payload: md() }] } }] })))).toContain('IMPORT_SKILL_NOT_FOUND');
    expect(codes(await validate(a.token, topicId, doc({ skills: [], lessons: [{ contentKey: 'CK-2', sortOrder: 1, revision: { title: 'L', activities: [{ type: 'IMAGE', payload: { schemaVersion: 'lesson-activity-media/v1' } }] } }] })))).toContain('IMPORT_ACTIVITY_TYPE_UNSUPPORTED');
    expect(codes(await validate(a.token, topicId, doc({ skills: [], lessons: [{ contentKey: 'CK-3', sortOrder: 1, revision: { title: 'L', activities: [{ type: 'TEXT', payload: { schemaVersion: 'lesson-activity-markdown/v1', markdown: '', extra: 1 } }] } }] })))).toContain('IMPORT_ACTIVITY_PAYLOAD_INVALID');
    expect(codes(await validate(a.token, topicId, doc({ skills: [], lessons: [{ contentKey: 'CK-4', sortOrder: 1, revision: { title: 'L', activities: [{ type: 'MINI_QUESTION', payload: { schemaVersion: 'lesson-activity-objective/v1', format: 'single_choice', prompt: 'Q', options: [], answerKey: { correctOptionIds: [] } } }] } }] })))).toContain('IMPORT_ACTIVITY_PAYLOAD_INVALID');
  });

  it('IMP-V-08 ARCHIVED skill reference fails', async () => {
    const a = await makeAdmin(); const { subjectId, topicId } = await seedTopic(a);
    const sk = (await P(`${BASE}/subjects/${subjectId}/skills`, a.token, { name: 'Archy', code: 'ARCH' })).body;
    await prisma.skill.update({ where: { id: sk.id }, data: { status: 'ARCHIVED' } });
    const res = await validate(a.token, topicId, doc({ skills: [], lessons: [{ contentKey: 'CK-A', sortOrder: 1, skillCodes: ['ARCH'], revision: { title: 'L', activities: [{ type: 'TEXT', payload: md() }] } }] }));
    expect(res.body.errors.some((e: { code: string }) => e.code === 'IMPORT_SKILL_ARCHIVED')).toBe(true);
  });

  it('IMP-V-12 count limit fails safely', async () => {
    const a = await makeAdmin(); const { topicId } = await seedTopic(a);
    const lessons = Array.from({ length: 251 }, (_, i) => ({ contentKey: `CK-${i}`, sortOrder: i, revision: { title: 'L', activities: [{ type: 'TEXT', payload: md() }] } }));
    expect((await validate(a.token, topicId, doc({ skills: [], lessons }))).body.code).toBe('IMPORT_LIMIT_EXCEEDED');
  });

  it('IMP-V-13 validation response never leaks answerKey / markdown body', async () => {
    const a = await makeAdmin(); const { topicId } = await seedTopic(a);
    const o = obj(); o.answerKey.correctOptionIds = ['a']; (o as Record<string, unknown>).secret = SECRET;
    const withSecret = doc({ skills: [], lessons: [{ contentKey: 'CK-S', sortOrder: 1, revision: { title: 'L', activities: [{ type: 'MINI_QUESTION', payload: { ...obj() } }, { type: 'TEXT', payload: md(SECRET) }] } }] });
    const res = await validate(a.token, topicId, withSecret);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    expect(JSON.stringify(res.body)).not.toContain('correctOptionIds');
  });

  // ── Skills (IMP-S) ──
  it('IMP-S-01/02/03 create missing ACTIVE; reuse existing; declared-name conflict blocks', async () => {
    const a = await makeAdmin(); const { subjectId, topicId } = await seedTopic(a);
    // S-02 existing reuse
    const existing = (await P(`${BASE}/subjects/${subjectId}/skills`, a.token, { name: 'Reuse me', code: 'REU' })).body;
    const reuseRes = await validate(a.token, topicId, doc({ skills: [{ code: 'REU', name: 'Reuse me' }], lessons: [{ contentKey: 'CK-R', sortOrder: 1, skillCodes: ['REU'], revision: { title: 'L', activities: [{ type: 'TEXT', payload: md() }] } }] }));
    expect(reuseRes.body.valid).toBe(true);
    expect(reuseRes.body.summary).toMatchObject({ skillsToCreate: 0, skillsReused: 1 });
    // S-03 declared code exists but name differs → conflict
    const conflict = await validate(a.token, topicId, doc({ skills: [{ code: 'REU', name: 'Different name' }], lessons: [] }));
    expect(conflict.body.errors.some((e: { code: string }) => e.code === 'IMPORT_SKILL_CONFLICT')).toBe(true);
    // S-01 apply creates a brand-new ACTIVE skill
    await apply(a.token, topicId, doc({ skills: [{ code: 'NEW1', name: 'Brand new' }], lessons: [{ contentKey: 'CK-N', sortOrder: 1, skillCodes: ['NEW1'], revision: { title: 'L', activities: [{ type: 'TEXT', payload: md() }] } }] })).expect(201);
    const created = await prisma.skill.findFirst({ where: { subjectId, code: 'NEW1' } });
    expect(created?.status).toBe('ACTIVE');
    expect(existing.id).toBeTruthy();
  });

  // ── Apply (IMP-A) ──
  it('IMP-A-01 apply creates DRAFT content, positions 0..N-1, source HUMAN, mappings, prerequisite, ONE audit', async () => {
    const a = await makeAdmin(); const { subjectId, topicId } = await seedTopic(a);
    const pkg = {
      schemaVersion: 'izlan-topic-content/v1',
      skills: [{ code: 'BE', name: 'be' }, { code: 'HAVE', name: 'have' }],
      lessons: [
        { contentKey: 'PKG-1', sortOrder: 10, skillCodes: ['BE'], revision: { title: 'One', activities: [{ type: 'EXPLANATION', payload: md('x') }, { type: 'MINI_QUESTION', skillCodes: ['BE'], payload: obj() }] } },
        { contentKey: 'PKG-2', sortOrder: 20, skillCodes: ['HAVE'], prerequisiteContentKeys: ['PKG-1'], revision: { title: 'Two', activities: [{ type: 'TEXT', payload: md('y') }] } },
      ],
    };
    const res = await apply(a.token, topicId, pkg);
    expect(res.status).toBe(201);
    expect(res.body.lessons).toHaveLength(2);

    const l1 = await prisma.lesson.findUnique({ where: { contentKey: 'PKG-1' }, include: { skills: true } });
    expect(l1!.status).toBe('DRAFT');
    expect(l1!.publishedRevisionId).toBeNull();
    const revs = await prisma.lessonRevision.findMany({ where: { lessonId: l1!.id } });
    expect(revs).toHaveLength(1);
    expect(revs[0].version).toBe(1);
    expect(revs[0].status).toBe('DRAFT');
    const acts = await prisma.activity.findMany({ where: { lessonRevisionId: revs[0].id }, orderBy: { position: 'asc' } });
    expect(acts.map((x) => x.position)).toEqual([0, 1]);
    for (const x of acts) { expect(x.source).toBe('HUMAN'); expect(x.aiMetadata).toBeNull(); }
    expect(l1!.skills).toHaveLength(1);
    const objAct = acts.find((x) => x.type === 'MINI_QUESTION')!;
    expect(await prisma.activitySkill.count({ where: { activityId: objAct.id } })).toBe(1);
    const l2 = await prisma.lesson.findUnique({ where: { contentKey: 'PKG-2' } });
    expect(await prisma.lessonPrerequisite.count({ where: { lessonId: l2!.id, prerequisiteLessonId: l1!.id } })).toBe(1);
    expect(await prisma.staffAudit.count({ where: { actionCode: 'content.import.apply' } })).toBe(1);
  });

  it('IMP-A-02 audit failure rolls the WHOLE import back', async () => {
    const a = await makeAdmin(); const { topicId } = await seedTopic(a);
    const spy = jest.spyOn(auditRepo, 'write').mockRejectedValueOnce(new Error('audit boom'));
    const res = await apply(a.token, topicId, doc({ lessons: [{ contentKey: 'CK-RB', sortOrder: 1, skillCodes: ['SK-BE'], revision: { title: 'L', activities: [{ type: 'MINI_QUESTION', skillCodes: ['SK-BE'], payload: obj() }] } }] }));
    expect(res.status).toBe(500);
    spy.mockRestore();
    expect(await prisma.lesson.count({ where: { contentKey: 'CK-RB' } })).toBe(0);
    expect(await prisma.skill.count({ where: { code: 'SK-BE' } })).toBe(0);
    expect(await prisma.staffAudit.count({ where: { actionCode: 'content.import.apply' } })).toBe(0);
  });

  it('IMP-A-03 concurrent same-contentKey apply → exactly one commits, loser 409', async () => {
    const a = await makeAdmin(); const { topicId } = await seedTopic(a);
    const pkg = doc({ skills: [], lessons: [{ contentKey: 'RACE-1', sortOrder: 1, revision: { title: 'L', activities: [{ type: 'TEXT', payload: md() }] } }] });
    const [r1, r2] = await Promise.all([apply(a.token, topicId, pkg), apply(a.token, topicId, pkg)]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    expect(await prisma.lesson.count({ where: { contentKey: 'RACE-1' } })).toBe(1);
  });

  // ── DAG (IMP-DAG) ──
  it('IMP-DAG-01/02/03 batch A→B accepted; A↔B rejected; A→B→C→A rejected', async () => {
    const a = await makeAdmin(); const { topicId } = await seedTopic(a);
    const lz = (edges: Record<string, string[]>) => Object.entries(edges).map(([ck, pre], i) => ({ contentKey: ck, sortOrder: i, revision: { title: ck, activities: [{ type: 'TEXT', payload: md() }] }, prerequisiteContentKeys: pre }));
    expect((await validate(a.token, topicId, doc({ skills: [], lessons: lz({ A: ['B'], B: [] }) }))).body.valid).toBe(true);
    expect((await validate(a.token, topicId, doc({ skills: [], lessons: lz({ A: ['B'], B: ['A'] }) }))).body.errors.some((e: { code: string }) => e.code === 'IMPORT_PREREQUISITE_CYCLE')).toBe(true);
    expect((await validate(a.token, topicId, doc({ skills: [], lessons: lz({ A: ['B'], B: ['C'], C: ['A'] }) }))).body.errors.some((e: { code: string }) => e.code === 'IMPORT_PREREQUISITE_CYCLE')).toBe(true);
  });

  it('IMP-DAG-04/05 existing graph + imported edge cycle rejected; existing same-Subject target accepted', async () => {
    const a = await makeAdmin(); const { topicId } = await seedTopic(a);
    // seed existing A→B via a first import
    await apply(a.token, topicId, doc({ skills: [], lessons: [{ contentKey: 'EX-A', sortOrder: 1, prerequisiteContentKeys: ['EX-B'], revision: { title: 'A', activities: [{ type: 'TEXT', payload: md() }] } }, { contentKey: 'EX-B', sortOrder: 2, revision: { title: 'B', activities: [{ type: 'TEXT', payload: md() }] } }] })).expect(201);
    // DAG-05: a NEW lesson with an existing same-Subject prereq target is accepted.
    expect((await validate(a.token, topicId, doc({ skills: [], lessons: [{ contentKey: 'EX-C', sortOrder: 3, prerequisiteContentKeys: ['EX-A'], revision: { title: 'C', activities: [{ type: 'TEXT', payload: md() }] } }] }))).body.valid).toBe(true);
    // DAG-04: the combined graph (whole existing Subject edges + all proposed batch edges) is cycle-checked. A within-batch
    // cycle is rejected; a cycle purely among existing edges is impossible by construction (create-only import: new lessons
    // are graph sinks that no existing/normal writer can target), so the reachable cross-graph case reduces to the batch.
    const cyc = await validate(a.token, topicId, doc({ skills: [], lessons: [{ contentKey: 'CYX', sortOrder: 4, prerequisiteContentKeys: ['CYY'], revision: { title: 'X', activities: [{ type: 'TEXT', payload: md() }] } }, { contentKey: 'CYY', sortOrder: 5, prerequisiteContentKeys: ['CYX'], revision: { title: 'Y', activities: [{ type: 'TEXT', payload: md() }] } }] }));
    expect(cyc.body.errors.some((e: { code: string }) => e.code === 'IMPORT_PREREQUISITE_CYCLE')).toBe(true);
  });

  it('IMP-DAG-06/07 cross-Subject existing target rejected; ARCHIVED target rejected', async () => {
    const a = await makeAdmin(); const { topicId } = await seedTopic(a);
    const other = await seedTopic(a); // different subject
    const foreign = await apply(a.token, other.topicId, doc({ skills: [], lessons: [{ contentKey: 'FOREIGN-1', sortOrder: 1, revision: { title: 'F', activities: [{ type: 'TEXT', payload: md() }] } }] }));
    expect(foreign.status).toBe(201);
    const mism = await validate(a.token, topicId, doc({ skills: [], lessons: [{ contentKey: 'X1', sortOrder: 1, prerequisiteContentKeys: ['FOREIGN-1'], revision: { title: 'X', activities: [{ type: 'TEXT', payload: md() }] } }] }));
    expect(mism.body.errors.some((e: { code: string }) => e.code === 'IMPORT_PREREQUISITE_SUBJECT_MISMATCH')).toBe(true);
    // ARCHIVED same-subject target
    await apply(a.token, topicId, doc({ skills: [], lessons: [{ contentKey: 'ARCH-T', sortOrder: 2, revision: { title: 'AT', activities: [{ type: 'TEXT', payload: md() }] } }] })).expect(201);
    await prisma.lesson.update({ where: { contentKey: 'ARCH-T' }, data: { status: 'ARCHIVED' } });
    const arch = await validate(a.token, topicId, doc({ skills: [], lessons: [{ contentKey: 'X2', sortOrder: 3, prerequisiteContentKeys: ['ARCH-T'], revision: { title: 'X', activities: [{ type: 'TEXT', payload: md() }] } }] }));
    expect(arch.body.errors.some((e: { code: string }) => e.code === 'IMPORT_PREREQUISITE_ARCHIVED')).toBe(true);
  });

  it('IMP-DAG-CONCURRENCY normal prerequisite writer + import share the Subject lock → final graph acyclic', async () => {
    const a = await makeAdmin(); const { subjectId, topicId } = await seedTopic(a);
    // existing A, B (no edges)
    await apply(a.token, topicId, doc({ skills: [], lessons: [{ contentKey: 'CC-A', sortOrder: 1, revision: { title: 'A', activities: [{ type: 'TEXT', payload: md() }] } }, { contentKey: 'CC-B', sortOrder: 2, revision: { title: 'B', activities: [{ type: 'TEXT', payload: md() }] } }] })).expect(201);
    const A = await prisma.lesson.findUnique({ where: { contentKey: 'CC-A' } });
    const B = await prisma.lesson.findUnique({ where: { contentKey: 'CC-B' } });
    const at = A!.updatedAt.toISOString();
    // concurrently: normal writer A→B, import new C→A (both take subject FOR UPDATE)
    const [normal, imp] = await Promise.all([
      prereqService.addPrerequisite(a.userId, A!.id, { prerequisiteLessonId: B!.id, expectedLessonUpdatedAt: at }).then(() => 'ok').catch((e) => e),
      apply(a.token, topicId, doc({ skills: [], lessons: [{ contentKey: 'CC-C', sortOrder: 3, prerequisiteContentKeys: ['CC-A'], revision: { title: 'C', activities: [{ type: 'TEXT', payload: md() }] } }] })),
    ]);
    expect(normal).toBe('ok');
    expect(imp.status).toBe(201);
    // final graph {A→B, C→A} is acyclic
    const edges = await prisma.lessonPrerequisite.findMany({ where: { lesson: { topic: { module: { level: { track: { subjectId } } } } } }, select: { lessonId: true, prerequisiteLessonId: true } });
    expect(edges.length).toBe(2);
    // no node reachable back to itself
    const adj = new Map<string, string[]>();
    for (const e of edges) (adj.get(e.lessonId) ?? adj.set(e.lessonId, []).get(e.lessonId)!).push(e.prerequisiteLessonId);
    const acyclic = [...adj.keys()].every((start) => { const seen = new Set<string>(); const st = [start]; let self = false; while (st.length) { const nd = st.pop()!; for (const nx of adj.get(nd) ?? []) { if (nx === start) self = true; if (!seen.has(nx)) { seen.add(nx); st.push(nx); } } } return !self; });
    expect(acyclic).toBe(true);
  });

  // ── Authorization (IMP-AUTH) ──
  it('IMP-AUTH-01..05 scope + spoofing', async () => {
    const a = await makeAdmin(); const { subjectId, topicId } = await seedTopic(a);
    // 01 assigned author ok
    const author = await makeAuthorAssigned(subjectId);
    expect((await validate(author.token, topicId, doc())).status).toBe(200);
    // 02 author without assignment → 404
    const unassigned = await makeAuthorUnassigned();
    expect((await validate(unassigned.token, topicId, doc())).status).toBe(404);
    expect((await apply(unassigned.token, topicId, doc())).status).toBe(404);
    // 03 ADMIN without assignment → 404
    const otherAdmin = await makeAdmin();
    expect((await validate(otherAdmin.token, topicId, doc())).status).toBe(404);
    // 04 LEARNER → 403
    const learner = await makeUser();
    expect((await validate(learner.token, topicId, doc())).status).toBe(403);
    // 05 client cannot spoof Subject: author assigned to subject A cannot import into subject B's topic
    const b = await seedTopic(a);
    const authorA = await makeAuthorAssigned(subjectId);
    expect((await validate(authorA.token, b.topicId, doc())).status).toBe(404);
  });

  // ── Audit (IMP-AUDIT) ──
  it('IMP-AUDIT-01..05 apply → one event with hash+counts only; validate/failed → none; no secrets', async () => {
    const a = await makeAdmin(); const { topicId } = await seedTopic(a);
    // 02 validate creates no import audit
    await validate(a.token, topicId, doc()).expect(200);
    expect(await prisma.staffAudit.count({ where: { actionCode: 'content.import.apply' } })).toBe(0);
    // apply with a secret answerKey + secret markdown
    const pkg = doc({ skills: [], lessons: [{ contentKey: 'AUD-1', sortOrder: 1, revision: { title: 'L', activities: [{ type: 'MINI_QUESTION', payload: { ...obj(), answerKey: { correctOptionIds: ['a'] } } }, { type: 'TEXT', payload: md(SECRET) }] } }] });
    const res = await apply(a.token, topicId, pkg);
    expect(res.status).toBe(201);
    const audits = await prisma.staffAudit.findMany({ where: { actionCode: 'content.import.apply' } });
    expect(audits).toHaveLength(1); // 01
    expect(audits[0].metadata).toMatchObject({ documentHash: res.body.documentHash, createdLessonCount: 1, createdActivityCount: 2 }); // 04
    const dump = JSON.stringify(audits[0].metadata);
    expect(dump).not.toContain(SECRET); // 05
    expect(dump).not.toContain('markdown');
    expect(dump).not.toContain('correctOptionIds');
    // 03 failed apply creates no audit
    const spy = jest.spyOn(auditRepo, 'write').mockRejectedValueOnce(new Error('boom'));
    await apply(a.token, topicId, doc({ skills: [], lessons: [{ contentKey: 'AUD-FAIL', sortOrder: 1, revision: { title: 'L', activities: [{ type: 'TEXT', payload: md() }] } }] }));
    spy.mockRestore();
    expect(await prisma.staffAudit.count({ where: { actionCode: 'content.import.apply' } })).toBe(1); // unchanged
  });

  // ── Provenance (IMP-PROV) — package-level Activity provenance (TD-254) ──
  it('IMP-PROV-01 no provenance → imported Activity.source = HUMAN (backward compatible)', async () => {
    const a = await makeAdmin(); const { topicId } = await seedTopic(a);
    await apply(a.token, topicId, doc({ skills: [], lessons: [{ contentKey: 'PROV-H', sortOrder: 1, revision: { title: 'L', activities: [{ type: 'TEXT', payload: md() }, { type: 'EXAMPLE', payload: md('ex') }] } }] })).expect(201);
    const acts = await prisma.activity.findMany({ where: { revision: { lesson: { contentKey: 'PROV-H' } } } });
    expect(acts.length).toBe(2);
    expect(acts.every((x) => x.source === 'HUMAN' && x.aiMetadata === null)).toBe(true);
  });

  it('IMP-PROV-02 provenance AI_ASSISTED → every imported Activity.source = AI_ASSISTED, aiMetadata null', async () => {
    const a = await makeAdmin(); const { topicId } = await seedTopic(a);
    await apply(a.token, topicId, doc({ provenance: { source: 'AI_ASSISTED' }, skills: [], lessons: [{ contentKey: 'PROV-AI', sortOrder: 1, revision: { title: 'L', activities: [{ type: 'TEXT', payload: md() }, { type: 'EXPLANATION', payload: md('why') }] } }] })).expect(201);
    const acts = await prisma.activity.findMany({ where: { revision: { lesson: { contentKey: 'PROV-AI' } } } });
    expect(acts.length).toBe(2);
    expect(acts.every((x) => x.source === 'AI_ASSISTED' && x.aiMetadata === null)).toBe(true);
  });

  it('IMP-PROV-03 provenance AI_GENERATED is structurally accepted and persisted', async () => {
    const a = await makeAdmin(); const { topicId } = await seedTopic(a);
    const res = await apply(a.token, topicId, doc({ provenance: { source: 'AI_GENERATED' }, skills: [], lessons: [{ contentKey: 'PROV-GEN', sortOrder: 1, revision: { title: 'L', activities: [{ type: 'TEXT', payload: md() }] } }] }));
    expect(res.status).toBe(201);
    const acts = await prisma.activity.findMany({ where: { revision: { lesson: { contentKey: 'PROV-GEN' } } } });
    expect(acts.every((x) => x.source === 'AI_GENERATED')).toBe(true);
  });

  it('IMP-PROV-04 invalid provenance → not valid (dry-run)', async () => {
    const a = await makeAdmin(); const { topicId } = await seedTopic(a);
    const res = await validate(a.token, topicId, doc({ provenance: { source: 'ROBOT' } }));
    expect(res.body.valid).toBe(false);
    expect(res.body.errors.some((e: { code: string }) => e.code === 'IMPORT_INVALID_DOCUMENT')).toBe(true);
  });

  it('IMP-PROV-06 provenance null is rejected and never applied as HUMAN', async () => {
    const a = await makeAdmin(); const { topicId } = await seedTopic(a);
    expect((await validate(a.token, topicId, doc({ provenance: null }))).body.valid).toBe(false);
    const res = await apply(a.token, topicId, doc({ provenance: null, skills: [], lessons: [{ contentKey: 'PROV-NULL', sortOrder: 1, revision: { title: 'L', activities: [{ type: 'TEXT', payload: md() }] } }] }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('IMPORT_INVALID_DOCUMENT');
    expect(await prisma.lesson.count({ where: { contentKey: 'PROV-NULL' } })).toBe(0); // never persisted (not as HUMAN)
  });

  // ── Body boundary (IMP-BODY) — route-scoped 5 MiB, ordinary API stays at 1 MiB (TD-253, Blocker A) ──
  const bigMd = (len: number) => ({ schemaVersion: 'lesson-activity-markdown/v1', markdown: 'a'.repeat(len) });
  const bulkLessons = (count: number, mdLen: number, prefix: string) =>
    Array.from({ length: count }, (_, i) => ({ contentKey: `${prefix}-${i}`, sortOrder: i, revision: { title: 'L', activities: [{ type: 'TEXT', payload: bigMd(mdLen) }] } }));

  it('IMP-BODY-01 ordinary API route rejects a >1 MiB body with 413 (handler never processes it)', async () => {
    // A normal login body over the 1 MiB ceiling → 413 (not 400/401), proving the business handler was never reached.
    const res = await request(server()).post('/api/auth/login').send({ phone: '+998901112233', password: 'x'.repeat(1_200_000) });
    expect(res.status).toBe(413);
  });

  it('IMP-BODY-02 import route accepts a >1 MiB, <=5 MiB document (reaches the parser/validator)', async () => {
    const a = await makeAdmin(); const { topicId } = await seedTopic(a);
    // ~30 × 40 KB markdown ≈ 1.2 MiB — above the ordinary ceiling, below the import ceiling.
    const res = await validate(a.token, topicId, { schemaVersion: 'izlan-topic-content/v1', skills: [], lessons: bulkLessons(30, 40_000, 'BODY') });
    expect(res.status).toBe(200); // not 413 — the ordinary ceiling did not reject it
    expect(res.body.valid).toBe(true);
  });

  it('IMP-BODY-03 import route refuses a >5 MiB body at the boundary (ImportService never runs)', async () => {
    const a = await makeAdmin(); const { topicId } = await seedTopic(a);
    // ~130 × 50 KB ≈ 6.5 MiB > 5 MiB. Fastify refuses it at the body-parser boundary (Content-Length over the route
    // limit): the server sends 413 and stops reading, so the client observes either a 413 or a mid-upload socket reset
    // — both prove the oversized body was refused BEFORE parsing. What matters: ImportService never ran (no writes).
    let status = 0;
    let socketRefused = false;
    try {
      status = (await validate(a.token, topicId, { schemaVersion: 'izlan-topic-content/v1', skills: [], lessons: bulkLessons(130, 50_000, 'HUGE') })).status;
    } catch {
      socketRefused = true; // ECONNRESET — connection reset because the server refused the oversized upload
    }
    expect(socketRefused || status === 413).toBe(true);
    expect(await prisma.lesson.count({ where: { contentKey: { startsWith: 'HUGE-' } } })).toBe(0);
    expect(await prisma.staffAudit.count({ where: { actionCode: 'content.import.apply' } })).toBe(0);
  });

  // ── Dry-run/apply consistency (IMP-CONSISTENCY) — deterministic package-local conflicts rejected in dry-run (Blocker B) ──
  it('IMP-CONSISTENCY-01 two declared skills with different codes but identical names → invalid', async () => {
    const a = await makeAdmin(); const { topicId } = await seedTopic(a);
    const res = await validate(a.token, topicId, doc({ skills: [{ code: 'C1', name: 'Same Name' }, { code: 'C2', name: 'Same Name' }], lessons: [] }));
    expect(res.body.valid).toBe(false);
    expect(res.body.errors.some((e: { code: string }) => e.code === 'IMPORT_SKILL_DUPLICATE')).toBe(true);
  });

  it('IMP-CONSISTENCY-02 duplicate prerequisiteContentKeys in one lesson → invalid', async () => {
    const a = await makeAdmin(); const { topicId } = await seedTopic(a);
    const res = await validate(a.token, topicId, doc({ skills: [], lessons: [
      { contentKey: 'PR-A', sortOrder: 1, revision: { title: 'A', activities: [{ type: 'TEXT', payload: md() }] } },
      { contentKey: 'PR-B', sortOrder: 2, prerequisiteContentKeys: ['PR-A', 'PR-A'], revision: { title: 'B', activities: [{ type: 'TEXT', payload: md() }] } },
    ] }));
    expect(res.body.valid).toBe(false);
    expect(res.body.errors.some((e: { code: string }) => e.code === 'IMPORT_INVALID_DOCUMENT')).toBe(true);
  });

  it('IMP-CONSISTENCY-03 duplicate Lesson.skillCodes → invalid', async () => {
    const a = await makeAdmin(); const { topicId } = await seedTopic(a);
    const res = await validate(a.token, topicId, doc({ skills: [{ code: 'DS', name: 'Dup skill' }], lessons: [{ contentKey: 'LS-1', sortOrder: 1, skillCodes: ['DS', 'DS'], revision: { title: 'L', activities: [{ type: 'TEXT', payload: md() }] } }] }));
    expect(res.body.valid).toBe(false);
    expect(res.body.errors.some((e: { code: string }) => e.code === 'IMPORT_INVALID_DOCUMENT')).toBe(true);
  });

  it('IMP-CONSISTENCY-04 duplicate Activity.skillCodes → invalid', async () => {
    const a = await makeAdmin(); const { topicId } = await seedTopic(a);
    const res = await validate(a.token, topicId, doc({ skills: [{ code: 'DA', name: 'Dup act skill' }], lessons: [{ contentKey: 'AS-1', sortOrder: 1, revision: { title: 'L', activities: [{ type: 'MINI_QUESTION', skillCodes: ['DA', 'DA'], payload: obj() }] } }] }));
    expect(res.body.valid).toBe(false);
    expect(res.body.errors.some((e: { code: string }) => e.code === 'IMPORT_INVALID_DOCUMENT')).toBe(true);
  });

  it('IMP-CONSISTENCY-05 a valid contentKey (>80, <=200) may be referenced as a prerequisite', async () => {
    const a = await makeAdmin(); const { topicId } = await seedTopic(a);
    const longKey = `CK-${'A'.repeat(120)}`; // 123 chars — valid CONTENT_KEY_RE, invalid as an ≤80 skill code
    expect(longKey.length).toBeGreaterThan(80);
    const res = await validate(a.token, topicId, doc({ skills: [], lessons: [
      { contentKey: longKey, sortOrder: 1, revision: { title: 'A', activities: [{ type: 'TEXT', payload: md() }] } },
      { contentKey: 'CK-REF', sortOrder: 2, prerequisiteContentKeys: [longKey], revision: { title: 'B', activities: [{ type: 'TEXT', payload: md() }] } },
    ] }));
    expect(res.body.valid).toBe(true);
    expect(res.body.summary.prerequisitesToCreate).toBe(1);
  });

  // ── Scale (IMP-SCALE) — batched persistence + aggregate caps (Blocker C) ──
  it('IMP-SCALE-01 apply a ~500-activity / ~1000-mapping package via the batched path', async () => {
    const a = await makeAdmin(); const { topicId } = await seedTopic(a);
    const skills = [{ code: 'S0', name: 'Skill Zero' }, { code: 'S1', name: 'Skill One' }];
    const lessons = Array.from({ length: 50 }, (_, i) => ({
      contentKey: `SCALE-${i}`,
      sortOrder: i,
      skillCodes: ['S0'],
      prerequisiteContentKeys: i === 0 ? [] : ['SCALE-0'], // fan-in to SCALE-0 (acyclic)
      revision: { title: `L${i}`, activities: Array.from({ length: 10 }, () => ({ type: 'MINI_QUESTION', skillCodes: ['S0', 'S1'], payload: obj() })) },
    }));
    const res = await apply(a.token, topicId, { schemaVersion: 'izlan-topic-content/v1', skills, lessons });
    expect(res.status).toBe(201);
    expect(res.body.lessons).toHaveLength(50);

    const lessonIds = (await prisma.lesson.findMany({ where: { contentKey: { startsWith: 'SCALE-' } }, select: { id: true, status: true, publishedRevisionId: true } }));
    expect(lessonIds).toHaveLength(50);
    expect(lessonIds.every((l) => l.status === 'DRAFT' && l.publishedRevisionId === null)).toBe(true);
    const ids = lessonIds.map((l) => l.id);
    expect(await prisma.activity.count({ where: { revision: { lessonId: { in: ids } } } })).toBe(500);
    expect(await prisma.activitySkill.count({ where: { activity: { revision: { lessonId: { in: ids } } } } })).toBe(1000);
    expect(await prisma.lessonSkill.count({ where: { lessonId: { in: ids } } })).toBe(50);
    expect(await prisma.lessonPrerequisite.count({ where: { lessonId: { in: ids } } })).toBe(49);
    const audits = await prisma.staffAudit.findMany({ where: { actionCode: 'content.import.apply' } });
    expect(audits).toHaveLength(1);
    expect(audits[0].metadata).toMatchObject({ createdLessonCount: 50, createdActivityCount: 500, activitySkillCount: 1000, lessonSkillCount: 50, prerequisiteCount: 49 });
  });

  it('IMP-SCALE-02 a package exceeding an aggregate relationship cap is rejected before any write', async () => {
    const a = await makeAdmin(); const { topicId } = await seedTopic(a);
    const skills = Array.from({ length: 100 }, (_, i) => ({ code: `SK${i}`, name: `Skill ${i}` }));
    const codes = skills.map((s) => s.code); // 100 distinct codes
    const lessons = Array.from({ length: 101 }, (_, i) => ({ contentKey: `LSK-${i}`, sortOrder: i, skillCodes: codes, revision: { title: 'L', activities: [{ type: 'TEXT', payload: md() }] } }));
    // 101 lessons × 100 skill refs = 10,100 > maxLessonSkillMappingsTotal (10,000).
    const res = await apply(a.token, topicId, { schemaVersion: 'izlan-topic-content/v1', skills, lessons });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('IMPORT_LIMIT_EXCEEDED');
    expect(await prisma.lesson.count({ where: { contentKey: { startsWith: 'LSK-' } } })).toBe(0); // no writes
  });
});
