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

const ORIGIN = 'http://localhost:3001';

function getCookie(res: request.Response, name: string): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  if (!raw) return undefined;
  const line = raw.find((c) => c.startsWith(`${name}=`));
  if (!line) return undefined;
  return line.split(';')[0].split('=').slice(1).join('=');
}
function getCookieLine(res: request.Response, name: string): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  return raw?.find((c) => c.startsWith(`${name}=`));
}

describe('Auth HTTP (e2e, izlan_test)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  const sms = new TestSmsAdapter();
  const PHONE = '+998901234567';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_PORT)
      .useValue(sms)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AuthExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = moduleRef.get(PrismaService);
    await cleanupAuthTables(prisma);
    await prisma.role.deleteMany();
    await bootstrapSystemRoles(moduleRef.get(AuthorizationRepository));
  });

  afterAll(async () => {
    await cleanupAuthTables(prisma);
    await app.close();
  });

  beforeEach(async () => {
    await cleanupAuthTables(prisma);
    sms.clear();
  });

  const server = () => app.getHttpServer();

  async function login(phone = PHONE): Promise<{ accessToken: string; refreshCookie: string }> {
    // Test-only cooldown bypass: shu phone'ning oldingi challenge'larini o'tmishga surish (HTTP flow buzilmaydi).
    await prisma.otpChallenge.updateMany({ where: { phone }, data: { createdAt: new Date(Date.now() - 300_000) } });
    const reqRes = await request(server()).post('/api/auth/otp/request').send({ phone });
    expect(reqRes.status).toBe(202);
    const code = sms.latestCode()!;
    const verifyRes = await request(server())
      .post('/api/auth/otp/verify')
      .send({ challengeId: reqRes.body.challengeId, code });
    expect(verifyRes.status).toBe(200);
    return { accessToken: verifyRes.body.accessToken, refreshCookie: getCookie(verifyRes, 'izlan_refresh')! };
  }

  // ── OTP request/verify ──
  it('OTP request → 202, no account-status leak', async () => {
    const res = await request(server()).post('/api/auth/otp/request').send({ phone: PHONE });
    expect(res.status).toBe(202);
    expect(res.body).toHaveProperty('challengeId');
    expect(res.body).toHaveProperty('expiresIn');
    expect(JSON.stringify(res.body)).not.toMatch(/exists|registered|new|user/i);
    expect(res.body).not.toHaveProperty('code');
    expect(res.headers['cache-control']).toContain('no-store');
  });

  it('OTP verify (new phone) → creates Learner, returns access token, refresh cookie HttpOnly, hash-only DB', async () => {
    const { accessToken, refreshCookie } = await login();
    expect(accessToken.split('.')).toHaveLength(3);
    // User + LEARNER created
    const user = await prisma.user.findUnique({ where: { phone: PHONE } });
    expect(user).toBeTruthy();
    const roles = await prisma.userRole.findMany({ where: { userId: user!.id }, include: { role: true } });
    expect(roles.map((r) => r.role.code)).toEqual(['LEARNER']);
    // refresh cookie present, HttpOnly, not in body
    expect(refreshCookie).toBeTruthy();
    // DB stores hash, not plaintext
    const tokens = await prisma.refreshToken.findMany();
    for (const t of tokens) expect(t.tokenHash).not.toBe(refreshCookie);
  });

  it('verify response does not contain refresh token, roles, or permissions', async () => {
    const reqRes = await request(server()).post('/api/auth/otp/request').send({ phone: PHONE });
    const verifyRes = await request(server()).post('/api/auth/otp/verify').send({ challengeId: reqRes.body.challengeId, code: sms.latestCode() });
    const body = JSON.stringify(verifyRes.body);
    expect(body).not.toContain(getCookie(verifyRes, 'izlan_refresh')!);
    expect(verifyRes.body).not.toHaveProperty('refreshToken');
    expect(body).not.toMatch(/LEARNER|permission|phone/i);
    expect(verifyRes.body.user).toEqual({ id: expect.any(String), onboardingCompleted: false });
  });

  it('refresh cookie attributes: HttpOnly, SameSite=Lax, Path, no Domain, Secure=false (dev)', async () => {
    const reqRes = await request(server()).post('/api/auth/otp/request').send({ phone: PHONE });
    const verifyRes = await request(server()).post('/api/auth/otp/verify').send({ challengeId: reqRes.body.challengeId, code: sms.latestCode() });
    const line = getCookieLine(verifyRes, 'izlan_refresh')!;
    expect(line).toMatch(/HttpOnly/i);
    expect(line).toMatch(/SameSite=Lax/i);
    expect(line).toMatch(/Path=\/api\/auth\/refresh/i);
    expect(line).not.toMatch(/Domain=/i);
    expect(line).not.toMatch(/Secure/i); // dev
  });

  it('existing user login does not create duplicate', async () => {
    await login();
    await login();
    expect(await prisma.user.count()).toBe(1);
  });

  // ── OTP bad flows ──
  it('invalid phone → 400', async () => {
    const res = await request(server()).post('/api/auth/otp/request').send({ phone: '123' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('AUTH_INVALID_INPUT');
  });

  it('rejects unknown DTO field (forbidNonWhitelisted)', async () => {
    const res = await request(server()).post('/api/auth/otp/request').send({ phone: PHONE, hacker: 'x' });
    expect(res.status).toBe(400);
  });

  it('invalid OTP code → generic 400 AUTH_OTP_INVALID', async () => {
    const reqRes = await request(server()).post('/api/auth/otp/request').send({ phone: PHONE });
    const res = await request(server()).post('/api/auth/otp/verify').send({ challengeId: reqRes.body.challengeId, code: '000000' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('AUTH_OTP_INVALID');
    expect(JSON.stringify(res.body)).not.toMatch(/exists|registered/i);
  });

  it('malformed code (not 6 digits) → 400 validation', async () => {
    const reqRes = await request(server()).post('/api/auth/otp/request').send({ phone: PHONE });
    const res = await request(server()).post('/api/auth/otp/verify').send({ challengeId: reqRes.body.challengeId, code: '12' });
    expect(res.status).toBe(400);
  });

  it('reused challenge → 400', async () => {
    const reqRes = await request(server()).post('/api/auth/otp/request').send({ phone: PHONE });
    const code = sms.latestCode()!;
    await request(server()).post('/api/auth/otp/verify').send({ challengeId: reqRes.body.challengeId, code });
    const res = await request(server()).post('/api/auth/otp/verify').send({ challengeId: reqRes.body.challengeId, code });
    expect(res.status).toBe(400);
  });

  // ── Refresh + CSRF ──
  it('refresh with valid cookie + CSRF header + allowed Origin → 200 new token + new cookie; old invalid', async () => {
    const { refreshCookie } = await login();
    const res = await request(server())
      .post('/api/auth/refresh')
      .set('Cookie', `izlan_refresh=${refreshCookie}`)
      .set('X-Izlan-CSRF', '1')
      .set('Origin', ORIGIN)
      .send();
    expect(res.status).toBe(200);
    expect(res.body.accessToken.split('.')).toHaveLength(3);
    const newCookie = getCookie(res, 'izlan_refresh');
    expect(newCookie).toBeTruthy();
    expect(newCookie).not.toBe(refreshCookie);
    expect(res.headers['cache-control']).toContain('no-store');
    // old cookie reuse → 401 (+ strict reuse revoke)
    const reuse = await request(server())
      .post('/api/auth/refresh')
      .set('Cookie', `izlan_refresh=${refreshCookie}`)
      .set('X-Izlan-CSRF', '1')
      .set('Origin', ORIGIN)
      .send();
    expect(reuse.status).toBe(401);
  });

  it('CSRF: missing header → 403', async () => {
    const { refreshCookie } = await login();
    const res = await request(server()).post('/api/auth/refresh').set('Cookie', `izlan_refresh=${refreshCookie}`).set('Origin', ORIGIN).send();
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('AUTH_CSRF_REJECTED');
  });

  it('CSRF: untrusted Origin → 403', async () => {
    const { refreshCookie } = await login();
    const res = await request(server())
      .post('/api/auth/refresh')
      .set('Cookie', `izlan_refresh=${refreshCookie}`)
      .set('X-Izlan-CSRF', '1')
      .set('Origin', 'http://evil.example')
      .send();
    expect(res.status).toBe(403);
  });

  it('CSRF: Sec-Fetch-Site=cross-site → 403', async () => {
    const { refreshCookie } = await login();
    const res = await request(server())
      .post('/api/auth/refresh')
      .set('Cookie', `izlan_refresh=${refreshCookie}`)
      .set('X-Izlan-CSRF', '1')
      .set('Sec-Fetch-Site', 'cross-site')
      .send();
    expect(res.status).toBe(403);
  });

  it('refresh without cookie → 401', async () => {
    const res = await request(server()).post('/api/auth/refresh').set('X-Izlan-CSRF', '1').set('Origin', ORIGIN).send();
    expect(res.status).toBe(401);
  });

  // ── Bearer-protected routes (no CSRF header needed) ──
  it('GET /auth/me with bearer → 200; no bearer → 401', async () => {
    const { accessToken } = await login();
    const ok = await request(server()).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ id: expect.any(String), onboardingCompleted: false });
    const no = await request(server()).get('/api/auth/me');
    expect(no.status).toBe(401);
  });

  it('refresh token cannot be used as Bearer access token', async () => {
    const { refreshCookie } = await login();
    const res = await request(server()).get('/api/auth/me').set('Authorization', `Bearer ${refreshCookie}`);
    expect(res.status).toBe(401);
  });

  it('me reflects live suspension (sensitive live-check)', async () => {
    const { accessToken } = await login();
    const user = await prisma.user.findUnique({ where: { phone: PHONE } });
    await prisma.user.update({ where: { id: user!.id }, data: { status: 'SUSPENDED' } });
    const res = await request(server()).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(403);
  });

  // ── Logout ──
  it('logout revokes session, clears cookie, old refresh cannot rotate, repeat safe', async () => {
    const { accessToken, refreshCookie } = await login();
    const res = await request(server()).post('/api/auth/logout').set('Authorization', `Bearer ${accessToken}`).send();
    expect(res.status).toBe(204);
    const clearLine = getCookieLine(res, 'izlan_refresh')!;
    expect(clearLine).toMatch(/Path=\/api\/auth\/refresh/i);
    // old refresh cannot rotate
    const rot = await request(server()).post('/api/auth/refresh').set('Cookie', `izlan_refresh=${refreshCookie}`).set('X-Izlan-CSRF', '1').set('Origin', ORIGIN).send();
    expect(rot.status).toBe(401);
    // repeat logout safe
    const again = await request(server()).post('/api/auth/logout').set('Authorization', `Bearer ${accessToken}`).send();
    expect(again.status).toBe(204);
  });

  it('logout-all revokes all sessions', async () => {
    const s1 = await login();
    const s2 = await login();
    const res = await request(server()).post('/api/auth/logout-all').set('Authorization', `Bearer ${s1.accessToken}`).send();
    expect(res.status).toBe(204);
    for (const s of [s1, s2]) {
      const rot = await request(server()).post('/api/auth/refresh').set('Cookie', `izlan_refresh=${s.refreshCookie}`).set('X-Izlan-CSRF', '1').set('Origin', ORIGIN).send();
      expect(rot.status).toBe(401);
    }
  });

  it('concurrent HTTP refresh with same cookie → at most one succeeds', async () => {
    const { refreshCookie } = await login();
    const doRefresh = () =>
      request(server()).post('/api/auth/refresh').set('Cookie', `izlan_refresh=${refreshCookie}`).set('X-Izlan-CSRF', '1').set('Origin', ORIGIN).send();
    const [a, b] = await Promise.all([doRefresh(), doRefresh()]);
    const okCount = [a, b].filter((r) => r.status === 200).length;
    expect(okCount).toBeLessThanOrEqual(1);
  });
});
