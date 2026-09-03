import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
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
 * Subject ordering + reorder (e2e, izlan_test). Proves automatic server-assigned canonical ordering (no manual input),
 * concurrency safety, deterministic list order, and the backend-authoritative reorder endpoint + its authz.
 */
describe('Subject ordering + reorder (e2e, izlan_test)', () => {
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
    await prisma.staffAudit.deleteMany();
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
  const PUT = (url: string, token: string, body?: unknown) => request(server()).put(url).set('Authorization', `Bearer ${token}`).send(body ?? {});

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

  const create = async (token: string, title: string) => (await P(`${BASE}/subjects`, token, { slug: `s-${uid()}`, title })).body;
  const dbSort = async (id: string) => (await prisma.subject.findUniqueOrThrow({ where: { id }, select: { sortOrder: true } })).sortOrder;
  const listIds = async (token: string): Promise<string[]> => ((await G(`${BASE}/subjects`, token)).body as { id: string }[]).map((s) => s.id);

  it('SO-01 create WITHOUT any order field succeeds; the first subject gets a canonical position', async () => {
    const admin = await makeAdmin();
    const res = await P(`${BASE}/subjects`, admin.token, { slug: `s-${uid()}`, title: 'English' });
    expect(res.status).toBe(201);
    expect(res.body).not.toHaveProperty('sortOrder'); // internal value never exposed to staff
    expect(await dbSort(res.body.id)).toBe(100);
  });

  it('SO-02 successive subjects receive strictly increasing canonical positions (100,200,300)', async () => {
    const admin = await makeAdmin();
    const a = await create(admin.token, 'English');
    const b = await create(admin.token, 'History');
    const c = await create(admin.token, 'Russian');
    expect([await dbSort(a.id), await dbSort(b.id), await dbSort(c.id)]).toEqual([100, 200, 300]);
  });

  it('SO-03 the list returns in canonical order (creation order here), not alphabetical/timestamp accident', async () => {
    const admin = await makeAdmin();
    const zeta = await create(admin.token, 'Zeta');
    const alpha = await create(admin.token, 'Alpha');
    const mid = await create(admin.token, 'Mid');
    expect(await listIds(admin.token)).toEqual([zeta.id, alpha.id, mid.id]); // canonical, not A-Z
  });

  it('SO-04 the client CANNOT set ordering (sortOrder is not an accepted input)', async () => {
    const admin = await makeAdmin();
    const res = await P(`${BASE}/subjects`, admin.token, { slug: `s-${uid()}`, title: 'X', sortOrder: 5 });
    expect(res.status).toBe(400); // forbidNonWhitelisted → ordering is server-owned, never client-supplied
  });

  it('SO-05 concurrent creates never collide on ordering (advisory-lock serialized → all distinct)', async () => {
    const admin = await makeAdmin();
    const created = await Promise.all(Array.from({ length: 6 }, (_, i) => create(admin.token, `Concurrent ${i}`)));
    const sorts = await Promise.all(created.map((s) => dbSort(s.id)));
    expect(new Set(sorts).size).toBe(sorts.length); // no duplicate ordering values
    // and the list is a total order (unique positions → unambiguous)
    expect((await listIds(admin.token)).length).toBe(6);
  });

  it('SO-06 reorder is backend-authoritative and persists (list reflects the new order)', async () => {
    const admin = await makeAdmin();
    const a = await create(admin.token, 'English');
    const b = await create(admin.token, 'History');
    const c = await create(admin.token, 'Russian');
    const reversed = [c.id, b.id, a.id];
    const res = await PUT(`${BASE}/subjects/order`, admin.token, { orderedSubjectIds: reversed });
    expect(res.status).toBe(200);
    expect(res.body.orderedSubjectIds).toEqual(reversed);
    expect(await listIds(admin.token)).toEqual(reversed); // persisted + reflected on reload
    expect([await dbSort(c.id), await dbSort(b.id), await dbSort(a.id)]).toEqual([100, 200, 300]);
  });

  it('SO-07 reorder rejects an ambiguous or non-exact set (duplicate / incomplete / foreign id → 400)', async () => {
    const admin = await makeAdmin();
    const a = await create(admin.token, 'A');
    const b = await create(admin.token, 'B');
    expect((await PUT(`${BASE}/subjects/order`, admin.token, { orderedSubjectIds: [a.id, a.id] })).status).toBe(400); // duplicate
    expect((await PUT(`${BASE}/subjects/order`, admin.token, { orderedSubjectIds: [a.id] })).status).toBe(400); // incomplete (missing b)
    expect((await PUT(`${BASE}/subjects/order`, admin.token, { orderedSubjectIds: [a.id, b.id, '01a00000-0000-7000-8000-000000000000'] })).status).toBe(400); // foreign id
    // ordering unchanged after failed attempts
    expect(await listIds(admin.token)).toEqual([a.id, b.id]);
  });

  it('SO-08 a user without content.subject.manage cannot reorder (403)', async () => {
    const admin = await makeAdmin();
    const a = await create(admin.token, 'A');
    const b = await create(admin.token, 'B');
    const methodist = await makeMethodist(); // author+publish, NOT subject.manage
    const res = await PUT(`${BASE}/subjects/order`, methodist.token, { orderedSubjectIds: [b.id, a.id] });
    expect(res.status).toBe(403);
    expect(await listIds(admin.token)).toEqual([a.id, b.id]); // unchanged
  });

  it('SO-09 reorder is scoped to the actor\'s own assigned subjects (cannot reorder using another admin\'s set)', async () => {
    const admin1 = await makeAdmin();
    const a = await create(admin1.token, 'A1');
    const b = await create(admin1.token, 'B1');
    const admin2 = await makeAdmin();
    const c = await create(admin2.token, 'C2');
    // admin2's exact set is {c}; sending admin1's ids → set mismatch 400 (no cross-scope reorder)
    expect((await PUT(`${BASE}/subjects/order`, admin2.token, { orderedSubjectIds: [a.id, b.id] })).status).toBe(400);
    // admin2 reordering its own single-subject set succeeds
    expect((await PUT(`${BASE}/subjects/order`, admin2.token, { orderedSubjectIds: [c.id] })).status).toBe(200);
  });
});
