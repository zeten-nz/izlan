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

/**
 * Phase 07C1 — Admin Users READ APIs (GET /api/admin/users, GET /api/admin/users/:id). Permission-code RBAC via
 * users.read; NO ADMIN role-name bypass; bounded keyset list; safe projections (never password/OTP/DOB/session token).
 */
describe('Admin Users read APIs (e2e, izlan_test)', () => {
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
  beforeEach(async () => { await reset(); sms.clear(); n = 0; });

  async function reset() {
    await cleanupAuthTables(prisma);
    await bootstrapSystemRoles(authz);
  }

  const server = () => app.getHttpServer();
  const phone = () => `+99890${String(4100000 + n++).slice(-7)}`;
  const G = (url: string, token: string) => request(server()).get(url).set('Authorization', `Bearer ${token}`);

  async function makeUser(): Promise<{ token: string; userId: string; phone: string }> {
    const ph = phone();
    const req = await request(server()).post('/api/auth/otp/request').send({ phone: ph });
    const verify = await request(server()).post('/api/auth/register').send({ challengeId: req.body.challengeId, code: sms.latestCode(), password: 'Passw0rd!123' });
    const user = await prisma.user.findUnique({ where: { phone: ph } });
    return { token: verify.body.accessToken, userId: user!.id, phone: ph };
  }
  async function grantSystemRole(userId: string, code: string) {
    const role = await prisma.role.findUnique({ where: { code } });
    await prisma.userRole.create({ data: { userId, roleId: role!.id, grantedBy: null } });
  }
  /** A user holding ONLY the given permission code via a NON-system role (proves code-based authz, no role-name). */
  async function makeUserWithPermission(permCode: string): Promise<{ token: string; userId: string }> {
    const u = await makeUser();
    const role = await prisma.role.upsert({ where: { code: `E2E_${permCode}` }, update: {}, create: { code: `E2E_${permCode}`, name: 'e2e' } });
    await prisma.rolePermission.createMany({ data: [{ roleId: role.id, permissionCode: permCode }], skipDuplicates: true });
    await prisma.userRole.create({ data: { userId: u.userId, roleId: role.id, grantedBy: null } });
    return u;
  }
  async function admin() {
    const u = await makeUser();
    await grantSystemRole(u.userId, 'ADMIN');
    return u;
  }

  const LIST = '/api/admin/users';

  // ── Authorization ──
  it('ADMINUSERS-E2E-01 unauthenticated → 401', async () => {
    expect((await request(server()).get(LIST)).status).toBe(401);
  });

  it('ADMINUSERS-E2E-02 learner (no users.read) → 403 on list + detail', async () => {
    const learner = await makeUser();
    expect((await G(LIST, learner.token)).status).toBe(403);
    expect((await G(`${LIST}/${learner.userId}`, learner.token)).status).toBe(403);
  });

  it('ADMINUSERS-E2E-03 METHODIST (content perms only) → 403', async () => {
    const u = await makeUser();
    await grantSystemRole(u.userId, 'METHODIST');
    expect((await G(LIST, u.token)).status).toBe(403);
  });

  it('ADMINUSERS-E2E-04 a NON-admin role holding only users.read → 200 (no ADMIN role-name bypass)', async () => {
    const u = await makeUserWithPermission('users.read');
    const res = await G(LIST, u.token);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it('ADMINUSERS-E2E-05 ADMIN (seeded users.read) → 200', async () => {
    const a = await admin();
    expect((await G(LIST, a.token)).status).toBe(200);
  });

  // ── List behavior ──
  it('ADMINUSERS-E2E-06 list returns a safe projection and leaks no secrets', async () => {
    const a = await admin();
    const res = await G(LIST, a.token);
    expect(res.status).toBe(200);
    const item = res.body.items.find((i: { id: string }) => i.id === a.userId);
    expect(item).toBeDefined();
    expect(Object.keys(item).sort()).toEqual(['createdAt', 'displayName', 'id', 'lastLoginAt', 'onboardingCompleted', 'phone', 'roles', 'status'].sort());
    expect(item.roles).toContain('ADMIN');
    const json = JSON.stringify(res.body);
    expect(json).not.toMatch(/Passw0rd|passwordHash|password_credential|refreshToken|refresh_token|dateOfBirth|date_of_birth|\botp\b/i);
  });

  it('ADMINUSERS-E2E-07 limit is bounded (limit > max → 400)', async () => {
    const a = await admin();
    expect((await G(`${LIST}?limit=101`, a.token)).status).toBe(400);
    expect((await G(`${LIST}?limit=0`, a.token)).status).toBe(400);
    expect((await G(`${LIST}?limit=5`, a.token)).status).toBe(200);
  });

  it('ADMINUSERS-E2E-08 keyset pagination is stable (no dup/skip; exhausts to null)', async () => {
    const a = await admin();
    await makeUser(); await makeUser(); await makeUser(); // ≥4 users total incl. admin
    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url: string = `${LIST}?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const res = await G(url, a.token);
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeLessThanOrEqual(2);
      for (const it of res.body.items) {
        expect(seen.has(it.id)).toBe(false); // no duplicate across pages
        seen.add(it.id);
      }
      cursor = res.body.nextCursor;
      pages += 1;
      expect(pages).toBeLessThan(20); // safety
    } while (cursor);
    const total = await prisma.user.count();
    expect(seen.size).toBe(total); // covered everyone exactly once
  });

  it('ADMINUSERS-E2E-09 a malformed cursor → deterministic 400', async () => {
    const a = await admin();
    const res = await G(`${LIST}?cursor=not-a-valid-cursor`, a.token);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ADMIN_USERS_INVALID_CURSOR');
  });

  it('ADMINUSERS-E2E-10 phone exact search', async () => {
    const a = await admin();
    const target = await makeUser();
    const res = await G(`${LIST}?q=${encodeURIComponent(target.phone)}`, a.token);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe(target.userId);
  });

  it('ADMINUSERS-E2E-11 displayName prefix search (bounded)', async () => {
    const a = await admin();
    const target = await makeUser();
    await prisma.userProfile.update({ where: { userId: target.userId }, data: { displayName: 'Dilnoza Karimova' } });
    const res = await G(`${LIST}?q=Diln`, a.token);
    expect(res.status).toBe(200);
    expect(res.body.items.some((i: { id: string }) => i.id === target.userId)).toBe(true);
    // a non-matching prefix returns empty
    expect((await G(`${LIST}?q=ZzzzNoSuchName`, a.token)).body.items).toHaveLength(0);
  });

  it('ADMINUSERS-E2E-12 status filter uses real UserStatus values', async () => {
    const a = await admin();
    const suspended = await makeUser();
    await prisma.user.update({ where: { id: suspended.userId }, data: { status: 'SUSPENDED' } });
    const res = await G(`${LIST}?status=SUSPENDED`, a.token);
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([suspended.userId]);
    expect(res.body.items[0].status).toBe('SUSPENDED');
    expect((await G(`${LIST}?status=BOGUS`, a.token)).status).toBe(400); // invalid enum → 400
  });

  it('ADMINUSERS-E2E-13 role filter uses real role codes', async () => {
    const a = await admin();
    const m = await makeUser();
    await grantSystemRole(m.userId, 'METHODIST');
    const res = await G(`${LIST}?role=METHODIST`, a.token);
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { id: string }) => i.id)).toContain(m.userId);
    expect(res.body.items.every((i: { roles: string[] }) => i.roles.includes('METHODIST'))).toBe(true);
    expect((await G(`${LIST}?role=BOGUS`, a.token)).status).toBe(400);
  });

  // ── Detail behavior ──
  it('ADMINUSERS-E2E-14 detail returns a safe projection + active session count; no secrets', async () => {
    const a = await admin();
    const target = await makeUser(); // registration created one active session
    const res = await G(`${LIST}/${target.userId}`, a.token);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(target.userId);
    expect(res.body.roles.map((r: { code: string }) => r.code)).toContain('LEARNER');
    expect(Array.isArray(res.body.subjectAssignments)).toBe(true);
    expect(res.body.activeSessionCount).toBeGreaterThanOrEqual(1);
    const json = JSON.stringify(res.body);
    expect(json).not.toMatch(/Passw0rd|passwordHash|refreshToken|dateOfBirth|date_of_birth|revoked|sessionId|\btoken\b/i);
  });

  it('ADMINUSERS-E2E-15 unknown user → 404; invalid uuid → 400', async () => {
    const a = await admin();
    expect((await G(`${LIST}/01a0346f-0000-7000-8000-000000000000`, a.token)).status).toBe(404);
    expect((await G(`${LIST}/not-a-uuid`, a.token)).status).toBe(400);
  });
});
