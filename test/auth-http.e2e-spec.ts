import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AuthorizationRepository } from '../src/authorization/authorization.repository';
import { AuthExceptionFilter } from '../src/auth/http/auth-exception.filter';
import { SMS_PORT } from '../src/sms/sms.port';
import { SessionsService } from '../src/auth/sessions/sessions.service';
import { bootstrapSystemRoles } from '../src/bootstrap/system-roles';
import { cleanupAuthTables } from './test-db.helper';
import { TestSmsAdapter } from './test-sms.adapter';

const ORIGIN = 'http://localhost:3001';
const PASSWORD = 'Passw0rd!123'; // 12 chars — within the 8..128 policy

function getCookie(res: request.Response, name: string): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const line = raw?.find((c) => c.startsWith(`${name}=`));
  return line?.split(';')[0].split('=').slice(1).join('=');
}
function getCookieLine(res: request.Response, name: string): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  return raw?.find((c) => c.startsWith(`${name}=`));
}

describe('Auth HTTP — phone + password (e2e, izlan_test)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let sessions: SessionsService;
  const sms = new TestSmsAdapter();
  let n = 0;
  const PHONE = '+998901234567';
  const phone = () => `+99890${String(5000000 + n++).slice(-7)}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(SMS_PORT).useValue(sms).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AuthExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = moduleRef.get(PrismaService);
    sessions = moduleRef.get(SessionsService);
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
    jest.restoreAllMocks();
  });

  const server = () => app.getHttpServer();

  async function requestOtp(ph: string, purpose?: string) {
    // Push any prior challenges for this phone into the past so the resend cooldown doesn't block a fresh request.
    await prisma.otpChallenge.updateMany({ where: { phone: ph }, data: { createdAt: new Date(Date.now() - 300_000) } });
    const res = await request(server()).post('/api/auth/otp/request').send(purpose ? { phone: ph, purpose } : { phone: ph });
    return { challengeId: res.body.challengeId as string, code: sms.latestCode()!, res };
  }
  async function registerUser(ph = PHONE, password = PASSWORD) {
    const { challengeId, code } = await requestOtp(ph);
    const res = await request(server()).post('/api/auth/register').send({ challengeId, code, password });
    return { res, accessToken: res.body.accessToken as string, refreshCookie: getCookie(res, 'izlan_refresh') };
  }
  const login = (ph: string, password = PASSWORD) => request(server()).post('/api/auth/login').send({ phone: ph, password });

  // ── OTP request (registration / reset — NOT login) ──
  it('OTP request → 202, enumeration-safe, no code in body', async () => {
    const res = await request(server()).post('/api/auth/otp/request').send({ phone: PHONE });
    expect(res.status).toBe(202);
    expect(res.body).toHaveProperty('challengeId');
    expect(res.body).not.toHaveProperty('code');
    expect(JSON.stringify(res.body)).not.toMatch(/exists|registered|new|user/i);
    expect(res.headers['cache-control']).toContain('no-store');
  });
  it('OTP request invalid phone → 400; unknown DTO field → 400', async () => {
    expect((await request(server()).post('/api/auth/otp/request').send({ phone: '123' })).status).toBe(400);
    expect((await request(server()).post('/api/auth/otp/request').send({ phone: PHONE, hacker: 'x' })).status).toBe(400);
  });

  // ── Registration (REG-PWD) ──
  it('REG-PWD-01 verified phone + password creates User+Profile+LEARNER+PasswordCredential atomically + session', async () => {
    const { res, accessToken, refreshCookie } = await registerUser();
    expect(res.status).toBe(201);
    expect(accessToken.split('.')).toHaveLength(3);
    expect(refreshCookie).toBeTruthy();
    const user = await prisma.user.findUnique({ where: { phone: PHONE }, include: { profile: true, passwordCredential: true, roles: { include: { role: true } } } });
    expect(user?.profile).toBeTruthy();
    expect(user?.roles.map((r) => r.role.code)).toEqual(['LEARNER']);
    expect(user?.passwordCredential).toBeTruthy();
    expect(user?.passwordCredential?.passwordHash).not.toContain(PASSWORD); // encoded argon2 hash, not plaintext
    expect(user?.passwordCredential?.passwordHash).toMatch(/^\$argon2id\$/);
    // response leaks no secret / role / phone
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(refreshCookie!);
    expect(body).not.toMatch(/LEARNER|permission|password|argon/i);
    expect(res.body.user).toEqual({ id: expect.any(String), onboardingCompleted: false });
  });
  it('REG-PWD-02 bad/expired OTP cannot create a credential', async () => {
    const { challengeId } = await requestOtp(PHONE);
    const bad = await request(server()).post('/api/auth/register').send({ challengeId, code: '000000', password: PASSWORD });
    expect(bad.status).toBe(400);
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.passwordCredential.count()).toBe(0);
  });
  it('REG-PWD-03 duplicate registered phone does not create a second account', async () => {
    await registerUser();
    const second = await requestOtp(PHONE);
    const dup = await request(server()).post('/api/auth/register').send({ challengeId: second.challengeId, code: second.code, password: PASSWORD });
    expect(dup.status).toBe(409);
    expect(await prisma.user.count()).toBe(1);
  });
  it('registration enforces the password length policy (short → 400 AUTH_PASSWORD_POLICY, OTP not consumed)', async () => {
    const { challengeId, code } = await requestOtp(PHONE);
    const short = await request(server()).post('/api/auth/register').send({ challengeId, code, password: 'short' });
    expect(short.status).toBe(400);
    expect(short.body.code).toBe('AUTH_PASSWORD_POLICY');
    // policy asserted before OTP verify → challenge still usable
    const ok = await request(server()).post('/api/auth/register').send({ challengeId, code, password: PASSWORD });
    expect(ok.status).toBe(201);
  });

  // ── Primary login (AUTH-PWD) ──
  it('AUTH-PWD-01 valid phone + password → session/access/refresh', async () => {
    await registerUser();
    const res = await login(PHONE);
    expect(res.status).toBe(200);
    expect(res.body.accessToken.split('.')).toHaveLength(3);
    expect(getCookie(res, 'izlan_refresh')).toBeTruthy();
    expect(res.body.user).toEqual({ id: expect.any(String), onboardingCompleted: false });
  });
  it('AUTH-PWD-02 wrong password → generic 401 AUTH_INVALID_CREDENTIALS', async () => {
    await registerUser();
    const res = await login(PHONE, 'WrongPassword!1');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_INVALID_CREDENTIALS');
    expect(JSON.stringify(res.body)).not.toMatch(/not found|no account|password incorrect|exists/i);
  });
  it('AUTH-PWD-03 unknown phone → SAME generic 401', async () => {
    const res = await login('+998901110022');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_INVALID_CREDENTIALS');
  });
  it('AUTH-PWD-04 passwordless legacy user → SAME generic 401', async () => {
    const u = await prisma.user.create({ data: { phone: '+998901110033' } });
    await prisma.userProfile.create({ data: { userId: u.id } });
    const res = await login('+998901110033');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_INVALID_CREDENTIALS');
  });
  it('AUTH-PWD-05 SUSPENDED / DEACTIVATED remain denied (even with the correct password)', async () => {
    await registerUser();
    const user = await prisma.user.findUnique({ where: { phone: PHONE } });
    await prisma.user.update({ where: { id: user!.id }, data: { status: 'SUSPENDED' } });
    expect((await login(PHONE)).status).toBe(403);
    await prisma.user.update({ where: { id: user!.id }, data: { status: 'DEACTIVATED' } });
    expect((await login(PHONE)).status).toBe(403);
  });
  it('AUTH-PWD-06 phone normalization — spaced/local input logs in', async () => {
    await registerUser(PHONE);
    const res = await login('90 123 45 67'); // normalizes to +998901234567
    expect(res.status).toBe(200);
  });
  it('AUTH-PWD-07 successful login updates lastLoginAt', async () => {
    await registerUser();
    await prisma.user.update({ where: { phone: PHONE }, data: { lastLoginAt: null } });
    await login(PHONE);
    const user = await prisma.user.findUnique({ where: { phone: PHONE } });
    expect(user!.lastLoginAt).toBeTruthy();
  });
  it('AUTH-PWD-08 refresh rotation still works after password login', async () => {
    await registerUser();
    const res = await login(PHONE);
    const cookie = getCookie(res, 'izlan_refresh')!;
    const rot = await request(server()).post('/api/auth/refresh').set('Cookie', `izlan_refresh=${cookie}`).set('X-Izlan-CSRF', '1').set('Origin', ORIGIN).send();
    expect(rot.status).toBe(200);
    expect(getCookie(rot, 'izlan_refresh')).not.toBe(cookie);
    // reuse of the old cookie → 401 (strict reuse)
    const reuse = await request(server()).post('/api/auth/refresh').set('Cookie', `izlan_refresh=${cookie}`).set('X-Izlan-CSRF', '1').set('Origin', ORIGIN).send();
    expect(reuse.status).toBe(401);
  });
  it('AUTH-PWD-09 logout/revoke unchanged after password login', async () => {
    await registerUser();
    const res = await login(PHONE);
    const cookie = getCookie(res, 'izlan_refresh')!;
    const out = await request(server()).post('/api/auth/logout').set('Authorization', `Bearer ${res.body.accessToken}`).send();
    expect(out.status).toBe(204);
    const rot = await request(server()).post('/api/auth/refresh').set('Cookie', `izlan_refresh=${cookie}`).set('X-Izlan-CSRF', '1').set('Origin', ORIGIN).send();
    expect(rot.status).toBe(401);
  });
  it('DB stores only the refresh HASH; refresh cookie is HttpOnly/SameSite=Lax/scoped-path/no-Domain', async () => {
    const { refreshCookie, res } = await registerUser();
    const line = getCookieLine(res, 'izlan_refresh')!;
    expect(line).toMatch(/HttpOnly/i);
    expect(line).toMatch(/SameSite=Lax/i);
    expect(line).toMatch(/Path=\/api\/auth\/refresh/i);
    expect(line).not.toMatch(/Domain=/i);
    const tokens = await prisma.refreshToken.findMany();
    for (const t of tokens) expect(t.tokenHash).not.toBe(refreshCookie);
  });

  // ── Password reset (RESET-PWD) ──
  it('RESET-PWD-01..04 reset changes password, old stops, new works, sessions revoked', async () => {
    const { res: reg } = await registerUser();
    const oldCookie = getCookie(reg, 'izlan_refresh')!;
    const NEW = 'BrandNewPass!9';
    const { challengeId, code } = await requestOtp(PHONE, 'PASSWORD_RESET');
    const reset = await request(server()).post('/api/auth/password/reset').send({ challengeId, code, password: NEW });
    expect(reset.status).toBe(200);
    // RESET-PWD-02 old password stops working
    expect((await login(PHONE, PASSWORD)).status).toBe(401);
    // RESET-PWD-03 new password works
    expect((await login(PHONE, NEW)).status).toBe(200);
    // RESET-PWD-04 existing sessions revoked (pre-reset refresh cookie can no longer rotate)
    const rot = await request(server()).post('/api/auth/refresh').set('Cookie', `izlan_refresh=${oldCookie}`).set('X-Izlan-CSRF', '1').set('Origin', ORIGIN).send();
    expect(rot.status).toBe(401);
  });
  it('RESET-PWD-05 invalid reset OTP changes nothing', async () => {
    await registerUser();
    const { challengeId } = await requestOtp(PHONE, 'PASSWORD_RESET');
    const bad = await request(server()).post('/api/auth/password/reset').send({ challengeId, code: '000000', password: 'BrandNewPass!9' });
    expect(bad.status).toBe(400);
    // original password still works
    expect((await login(PHONE, PASSWORD)).status).toBe(200);
  });
  it('reset for an unknown phone is a generic no-op (no enumeration)', async () => {
    const { challengeId, code } = await requestOtp('+998907770088', 'PASSWORD_RESET');
    const res = await request(server()).post('/api/auth/password/reset').send({ challengeId, code, password: 'BrandNewPass!9' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(await prisma.passwordCredential.count()).toBe(0);
  });

  it('RESET-ATOMIC-01 credential change ROLLS BACK when session/token revocation fails', async () => {
    const { res: reg } = await registerUser();
    const oldCookie = getCookie(reg, 'izlan_refresh')!;
    const user = await prisma.user.findUnique({ where: { phone: PHONE } });
    const oldHash = (await prisma.passwordCredential.findUnique({ where: { userId: user!.id } }))!.passwordHash;

    // Inject a failure INSIDE the reset transaction (revoke-all step).
    const spy = jest.spyOn(sessions, 'revokeAllUserSessionsInTransaction').mockRejectedValueOnce(new Error('revoke boom'));
    const { challengeId, code } = await requestOtp(PHONE, 'PASSWORD_RESET');
    const NEW = 'BrandNewPass!9';
    const failed = await request(server()).post('/api/auth/password/reset').send({ challengeId, code, password: NEW });
    expect(failed.status).toBe(500);
    spy.mockRestore();

    // Credential rolled back to the OLD hash → old password still works, new does NOT.
    expect((await prisma.passwordCredential.findUnique({ where: { userId: user!.id } }))!.passwordHash).toBe(oldHash);
    expect((await login(PHONE, PASSWORD)).status).toBe(200);
    expect((await login(PHONE, NEW)).status).toBe(401);
    // Session/token state unchanged (pre-reset refresh cookie still rotates); no success event persisted.
    const rot = await request(server()).post('/api/auth/refresh').set('Cookie', `izlan_refresh=${oldCookie}`).set('X-Izlan-CSRF', '1').set('Origin', ORIGIN).send();
    expect(rot.status).toBe(200);
    expect(await prisma.securityEvent.count({ where: { type: 'password_reset_success', userId: user!.id } })).toBe(0);
  });

  it('RESET-ATOMIC-02 successful reset atomically replaces the credential AND revokes all sessions + tokens', async () => {
    const { res: reg } = await registerUser();
    const regCookie = getCookie(reg, 'izlan_refresh')!;
    const login2 = await login(PHONE);
    const login2Cookie = getCookie(login2, 'izlan_refresh')!;
    const user = await prisma.user.findUnique({ where: { phone: PHONE } });

    const NEW = 'FreshSecret!7';
    const { challengeId, code } = await requestOtp(PHONE, 'PASSWORD_RESET');
    expect((await request(server()).post('/api/auth/password/reset').send({ challengeId, code, password: NEW })).status).toBe(200);

    expect((await login(PHONE, NEW)).status).toBe(200); // new works
    expect((await login(PHONE, PASSWORD)).status).toBe(401); // old fails
    // ALL pre-existing sessions revoked in the DB + their refresh cookies can no longer rotate.
    expect(await prisma.authSession.count({ where: { userId: user!.id, revokedAt: null } })).toBe(1); // only the fresh post-reset login session
    for (const cookie of [regCookie, login2Cookie]) {
      const rot = await request(server()).post('/api/auth/refresh').set('Cookie', `izlan_refresh=${cookie}`).set('X-Izlan-CSRF', '1').set('Origin', ORIGIN).send();
      expect(rot.status).toBe(401);
    }
    expect(await prisma.securityEvent.count({ where: { type: 'password_reset_success', userId: user!.id } })).toBe(1);
    expect(await prisma.securityEvent.count({ where: { type: 'all_sessions_revoked', userId: user!.id } })).toBe(1);
  });

  // ── Refresh / CSRF (unchanged contract) ──
  it('refresh requires CSRF header + trusted Origin', async () => {
    const { refreshCookie } = await registerUser();
    const noCsrf = await request(server()).post('/api/auth/refresh').set('Cookie', `izlan_refresh=${refreshCookie}`).set('Origin', ORIGIN).send();
    expect(noCsrf.status).toBe(403);
    const evil = await request(server()).post('/api/auth/refresh').set('Cookie', `izlan_refresh=${refreshCookie}`).set('X-Izlan-CSRF', '1').set('Origin', 'http://evil.example').send();
    expect(evil.status).toBe(403);
    const noCookie = await request(server()).post('/api/auth/refresh').set('X-Izlan-CSRF', '1').set('Origin', ORIGIN).send();
    expect(noCookie.status).toBe(401);
  });

  // ── me + logout-all ──
  it('GET /auth/me: bearer → 200; none → 401; reflects live suspension', async () => {
    const { accessToken } = await registerUser();
    expect((await request(server()).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`)).status).toBe(200);
    expect((await request(server()).get('/api/auth/me')).status).toBe(401);
    await prisma.user.update({ where: { phone: PHONE }, data: { status: 'SUSPENDED' } });
    expect((await request(server()).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`)).status).toBe(403);
  });
  it('logout-all revokes every session for the user', async () => {
    await registerUser();
    const s1 = await login(PHONE);
    const s2 = await login(PHONE);
    const out = await request(server()).post('/api/auth/logout-all').set('Authorization', `Bearer ${s1.body.accessToken}`).send();
    expect(out.status).toBe(204);
    for (const s of [s1, s2]) {
      const rot = await request(server()).post('/api/auth/refresh').set('Cookie', `izlan_refresh=${getCookie(s, 'izlan_refresh')}`).set('X-Izlan-CSRF', '1').set('Origin', ORIGIN).send();
      expect(rot.status).toBe(401);
    }
  });

  // ── Secret hygiene ──
  it('security events never store the password / OTP / token', async () => {
    await registerUser();
    await login(PHONE); // successful login event
    await login(PHONE, 'WrongPassword!1'); // failed login event
    const events = await prisma.securityEvent.findMany();
    const dump = JSON.stringify(events);
    expect(dump).not.toContain(PASSWORD);
    expect(dump).not.toContain('WrongPassword!1');
    expect(dump).not.toMatch(/\$argon2id\$/);
    expect(events.some((e) => e.type === 'password_login_success')).toBe(true);
    expect(events.some((e) => e.type === 'password_login_failed')).toBe(true);
    expect(events.some((e) => e.type === 'registration_success')).toBe(true);
  });
});
