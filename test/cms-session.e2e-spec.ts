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
 * Phase 2.2C — CMS capability endpoint GET /api/staff/content/session. Returns ONLY CMS-safe capability booleans
 * derived from effective permission codes (no role names, no PII, no unrelated permissions). content.author is
 * required (guard 403s otherwise). BACKEND stays the final authorization authority.
 */
describe('CMS session capability endpoint (e2e, izlan_test)', () => {
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
    await cleanupAuthTables(prisma);
    await bootstrapSystemRoles(authz);
  }

  const server = () => app.getHttpServer();
  const phone = () => `+99890${String(5200000 + n++).slice(-7)}`;
  const G = (url: string, token: string) => request(server()).get(url).set('Authorization', `Bearer ${token}`);

  async function makeUser() {
    const ph = phone();
    const req = await request(server()).post('/api/auth/otp/request').send({ phone: ph });
    const verify = await request(server()).post('/api/auth/otp/verify').send({ challengeId: req.body.challengeId, code: sms.latestCode() });
    const user = await prisma.user.findUnique({ where: { phone: ph } });
    return { token: verify.body.accessToken, userId: user!.id };
  }
  async function grantRole(userId: string, code: string) {
    const role = await prisma.role.findUnique({ where: { code } });
    await prisma.userRole.create({ data: { userId, roleId: role!.id, grantedBy: null } });
  }
  async function makeAuthorOnly() {
    const u = await makeUser();
    const role = await prisma.role.upsert({ where: { code: 'AUTHOR_ONLY_CMS' }, update: {}, create: { code: 'AUTHOR_ONLY_CMS', name: 'AuthorOnly' } });
    await prisma.rolePermission.createMany({ data: [{ roleId: role.id, permissionCode: 'content.author' }], skipDuplicates: true });
    await prisma.userRole.create({ data: { userId: u.userId, roleId: role.id, grantedBy: null } });
    return u;
  }

  const SESSION = '/api/staff/content/session';

  it('CMS-SESSION-01 author-only → author=true, publish=false, subjectManage=false', async () => {
    const u = await makeAuthorOnly();
    const res = await G(SESSION, u.token);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(u.userId);
    expect(res.body.capabilities).toEqual({ author: true, publish: false, subjectManage: false });
    // no role names / PII / unrelated permissions leaked
    const json = JSON.stringify(res.body);
    expect(json).not.toMatch(/AUTHOR_ONLY_CMS|METHODIST|ADMIN|phone|\+99890|permissions|roles/i);
  });

  it('CMS-SESSION-02 Methodist → author=true, publish=true, subjectManage=false', async () => {
    const u = await makeUser();
    await grantRole(u.userId, 'METHODIST');
    const res = await G(SESSION, u.token);
    expect(res.status).toBe(200);
    expect(res.body.capabilities.author).toBe(true);
    expect(res.body.capabilities.publish).toBe(true);
    expect(res.body.capabilities.subjectManage).toBe(false);
  });

  it('CMS-SESSION-03 Admin → author=true, publish=true, subjectManage=true', async () => {
    const u = await makeUser();
    await grantRole(u.userId, 'ADMIN');
    const res = await G(SESSION, u.token);
    expect(res.status).toBe(200);
    expect(res.body.capabilities).toEqual({ author: true, publish: true, subjectManage: true });
  });

  it('CMS-SESSION-04 learner / no content.author → 403 (backend is the authority)', async () => {
    const learner = await makeUser(); // fresh account has no content permissions
    expect((await G(SESSION, learner.token)).status).toBe(403);
    const moderator = await makeUser();
    await grantRole(moderator.userId, 'MODERATOR'); // MODERATOR has no content permissions
    expect((await G(SESSION, moderator.token)).status).toBe(403);
  });

  it('CMS-SESSION-05 unauthenticated → 401', async () => {
    expect((await request(server()).get(SESSION)).status).toBe(401);
  });
});
