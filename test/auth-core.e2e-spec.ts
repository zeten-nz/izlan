import { Test, TestingModule } from '@nestjs/testing';
import { UserStatus } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { UsersService, SYSTEM_ROLE } from '../src/users/users.service';
import { OtpService } from '../src/auth/otp/otp.service';
import { OtpPurpose } from '../src/auth/otp/otp-purpose';
import { SessionsService } from '../src/auth/sessions/sessions.service';
import { AuthorizationService } from '../src/authorization/authorization.service';
import { AuthorizationRepository } from '../src/authorization/authorization.repository';
import { hashRefreshToken } from '../src/auth/sessions/refresh-token.crypto';
import { bootstrapSystemRoles } from '../src/bootstrap/system-roles';
import { cleanupAuthTables } from './test-db.helper';
import {
  AccountUnavailableError,
  DuplicatePhoneError,
  OtpCooldownError,
  OtpExpiredError,
  OtpInvalidError,
  OtpLockedError,
  OtpRateLimitError,
  RefreshReuseDetectedError,
  RefreshTokenInvalidError,
  SessionExpiredError,
  SessionRevokedError,
} from '../src/common/errors';

describe('Auth Core (integration, izlan_test)', () => {
  let mod: TestingModule;
  let prisma: PrismaService;
  let users: UsersService;
  let otp: OtpService;
  let sessions: SessionsService;
  let authz: AuthorizationService;
  let authzRepo: AuthorizationRepository;

  const PHONE = '+998901234567';

  beforeAll(async () => {
    mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await mod.init();
    prisma = mod.get(PrismaService);
    users = mod.get(UsersService);
    otp = mod.get(OtpService);
    sessions = mod.get(SessionsService);
    authz = mod.get(AuthorizationService);
    authzRepo = mod.get(AuthorizationRepository);
    await cleanupAuthTables(prisma);
    await prisma.role.deleteMany();
    await bootstrapSystemRoles(authzRepo);
  });

  afterAll(async () => {
    await cleanupAuthTables(prisma);
    await mod.close();
  });

  beforeEach(async () => {
    await cleanupAuthTables(prisma);
  });

  // ── System roles ──
  describe('system role bootstrap', () => {
    it('is idempotent — exactly 4 role codes, no duplicates', async () => {
      await bootstrapSystemRoles(authzRepo);
      await bootstrapSystemRoles(authzRepo);
      const roles = await prisma.role.findMany();
      expect(roles.map((r) => r.code).sort()).toEqual(['ADMIN', 'LEARNER', 'METHODIST', 'MODERATOR']);
    });
  });

  // ── Users ──
  describe('user creation', () => {
    it('creates User + Profile + default LEARNER role atomically', async () => {
      const user = await users.createLearnerAfterVerifiedPhone('90 123 45 67');
      expect(user.phone).toBe(PHONE);
      const profile = await prisma.userProfile.findUnique({ where: { userId: user.id } });
      expect(profile).toBeTruthy();
      const roles = await prisma.userRole.findMany({ where: { userId: user.id }, include: { role: true } });
      expect(roles).toHaveLength(1);
      expect(roles[0].role.code).toBe(SYSTEM_ROLE.LEARNER);
    });

    it('rejects duplicate phone (race-safe, no silent duplicate)', async () => {
      await users.createLearnerAfterVerifiedPhone(PHONE);
      await expect(users.createLearnerAfterVerifiedPhone(PHONE)).rejects.toBeInstanceOf(DuplicatePhoneError);
      expect(await prisma.user.count()).toBe(1);
    });
  });

  // ── Authorization ──
  describe('effective permissions', () => {
    it('unions multiple roles, dedupes, reflects mapping removal (no cache)', async () => {
      const user = await users.createLearnerAfterVerifiedPhone(PHONE);
      const methodist = await authzRepo.findRoleByCode(SYSTEM_ROLE.METHODIST);
      const learner = await authzRepo.findRoleByCode(SYSTEM_ROLE.LEARNER);
      await authzRepo.assignRole(user.id, methodist!.id, null);
      await authzRepo.addRolePermission(learner!.id, 'test.read');
      await authzRepo.addRolePermission(methodist!.id, 'test.read'); // duplicate across roles
      await authzRepo.addRolePermission(methodist!.id, 'test.write');

      const perms = await authz.getEffectivePermissions(user.id);
      expect([...perms].sort()).toEqual(['test.read', 'test.write']); // deduped union
      expect(await authz.hasAllPermissions(user.id, ['test.read', 'test.write'])).toBe(true);

      await prisma.rolePermission.deleteMany({ where: { roleId: methodist!.id, permissionCode: 'test.write' } });
      expect(await authz.hasPermission(user.id, 'test.write')).toBe(false); // next server-side read
    });
  });

  // ── OTP ──
  describe('OTP lifecycle', () => {
    it('issues challenge hash-only (no plaintext stored)', async () => {
      const issued = await otp.issueChallenge({ phone: PHONE, purpose: OtpPurpose.REGISTRATION });
      const row = await prisma.otpChallenge.findUnique({ where: { id: issued.challengeId } });
      expect(row!.codeHash).not.toContain(issued.code);
      expect(row!.codeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(issued.code).toMatch(/^\d{6}$/);
    });

    it('resend invalidates previous active challenge', async () => {
      const first = await otp.issueChallenge({ phone: PHONE, purpose: OtpPurpose.REGISTRATION });
      // cooldown'ni chetlab o'tish uchun birinchini o'tmishga suramiz
      await prisma.otpChallenge.update({ where: { id: first.challengeId }, data: { createdAt: new Date(Date.now() - 120_000) } });
      await otp.issueChallenge({ phone: PHONE, purpose: OtpPurpose.REGISTRATION });
      const firstRow = await prisma.otpChallenge.findUnique({ where: { id: first.challengeId } });
      expect(firstRow!.invalidatedAt).toBeTruthy();
    });

    it('blocks resend within cooldown', async () => {
      await otp.issueChallenge({ phone: PHONE, purpose: OtpPurpose.REGISTRATION });
      await expect(otp.issueChallenge({ phone: PHONE, purpose: OtpPurpose.REGISTRATION })).rejects.toBeInstanceOf(OtpCooldownError);
    });

    it('enforces per-phone hourly limit (DB-backed)', async () => {
      const codeHash = 'x'.repeat(64);
      const past = new Date(Date.now() - 300_000); // 5 min ago (cooldown o'tgan, 1h ichida)
      for (let i = 0; i < 5; i++) {
        await prisma.otpChallenge.create({
          data: { phone: PHONE, purpose: OtpPurpose.REGISTRATION, codeHash, expiresAt: new Date(Date.now() + 60_000), createdAt: past },
        });
      }
      await expect(otp.issueChallenge({ phone: PHONE, purpose: OtpPurpose.REGISTRATION })).rejects.toBeInstanceOf(OtpRateLimitError);
    });

    it('increments attempts on wrong code and locks at max', async () => {
      const issued = await otp.issueChallenge({ phone: PHONE, purpose: OtpPurpose.REGISTRATION });
      for (let i = 0; i < 4; i++) {
        await expect(
          otp.verifyChallenge({ challengeId: issued.challengeId, phone: PHONE, purpose: OtpPurpose.REGISTRATION, code: '000000' }),
        ).rejects.toBeInstanceOf(OtpInvalidError);
      }
      // 5-inchi wrong → lock
      await expect(
        otp.verifyChallenge({ challengeId: issued.challengeId, phone: PHONE, purpose: OtpPurpose.REGISTRATION, code: '000000' }),
      ).rejects.toBeInstanceOf(OtpLockedError);
      const row = await prisma.otpChallenge.findUnique({ where: { id: issued.challengeId } });
      expect(row!.attemptCount).toBe(5);
      expect(row!.invalidatedAt).toBeTruthy();
    });

    it('rejects expired challenge', async () => {
      const issued = await otp.issueChallenge({ phone: PHONE, purpose: OtpPurpose.REGISTRATION });
      await prisma.otpChallenge.update({ where: { id: issued.challengeId }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await expect(
        otp.verifyChallenge({ challengeId: issued.challengeId, phone: PHONE, purpose: OtpPurpose.REGISTRATION, code: issued.code }),
      ).rejects.toBeInstanceOf(OtpExpiredError);
    });

    it('consumes on success, rejects reuse', async () => {
      const issued = await otp.issueChallenge({ phone: PHONE, purpose: OtpPurpose.REGISTRATION });
      const res = await otp.verifyChallenge({ challengeId: issued.challengeId, phone: PHONE, purpose: OtpPurpose.REGISTRATION, code: issued.code });
      expect(res.canonicalPhone).toBe(PHONE);
      const row = await prisma.otpChallenge.findUnique({ where: { id: issued.challengeId } });
      expect(row!.consumedAt).toBeTruthy();
      await expect(
        otp.verifyChallenge({ challengeId: issued.challengeId, phone: PHONE, purpose: OtpPurpose.REGISTRATION, code: issued.code }),
      ).rejects.toBeInstanceOf(OtpInvalidError);
    });

    it('parallel verify → only one success', async () => {
      const issued = await otp.issueChallenge({ phone: PHONE, purpose: OtpPurpose.REGISTRATION });
      const attempt = () => otp.verifyChallenge({ challengeId: issued.challengeId, phone: PHONE, purpose: OtpPurpose.REGISTRATION, code: issued.code });
      const results = await Promise.allSettled([attempt(), attempt()]);
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      expect(ok).toBe(1);
    });
  });

  // ── Sessions / refresh ──
  describe('sessions and refresh rotation', () => {
    async function activeUser() {
      return users.createLearnerAfterVerifiedPhone(PHONE);
    }

    it('creates session for ACTIVE user, stores refresh hash only', async () => {
      const user = await activeUser();
      const created = await sessions.createSession({ userId: user.id, platform: 'web' });
      expect(created.refreshToken).toMatch(/^[A-Za-z0-9_-]+$/);
      const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hashRefreshToken(created.refreshToken) } });
      expect(stored).toBeTruthy();
      // plaintext hech qanday refresh_token qatorida yo'q
      const all = await prisma.refreshToken.findMany();
      for (const t of all) expect(t.tokenHash).not.toBe(created.refreshToken);
    });

    it('denies session for SUSPENDED / DEACTIVATED user', async () => {
      const user = await activeUser();
      await prisma.user.update({ where: { id: user.id }, data: { status: UserStatus.SUSPENDED } });
      await expect(sessions.createSession({ userId: user.id, platform: 'web' })).rejects.toBeInstanceOf(AccountUnavailableError);
      await prisma.user.update({ where: { id: user.id }, data: { status: UserStatus.DEACTIVATED } });
      await expect(sessions.createSession({ userId: user.id, platform: 'web' })).rejects.toBeInstanceOf(AccountUnavailableError);
    });

    it('rotates: old used, new issued, new plaintext returned', async () => {
      const user = await activeUser();
      const created = await sessions.createSession({ userId: user.id, platform: 'web' });
      const rotated = await sessions.rotateRefreshToken(created.refreshToken);
      expect(rotated.refreshToken).not.toBe(created.refreshToken);
      const old = await prisma.refreshToken.findUnique({ where: { tokenHash: hashRefreshToken(created.refreshToken) } });
      expect(old!.usedAt).toBeTruthy();
      expect(old!.replacedById).toBeTruthy();
      const fresh = await prisma.refreshToken.findUnique({ where: { tokenHash: hashRefreshToken(rotated.refreshToken) } });
      expect(fresh!.usedAt).toBeNull();
    });

    it('detects reuse of already-used token → revokes session + security event', async () => {
      const user = await activeUser();
      const created = await sessions.createSession({ userId: user.id, platform: 'web' });
      await sessions.rotateRefreshToken(created.refreshToken); // old now used
      await expect(sessions.rotateRefreshToken(created.refreshToken)).rejects.toBeInstanceOf(RefreshReuseDetectedError);
      const session = await prisma.authSession.findUnique({ where: { id: created.sessionId } });
      expect(session!.revokedAt).toBeTruthy();
      const events = await prisma.securityEvent.findMany({ where: { type: 'refresh_token_reuse_detected' } });
      expect(events.length).toBeGreaterThanOrEqual(1);
    });

    it('rejects unknown token as invalid (not reuse)', async () => {
      await expect(sessions.rotateRefreshToken('unknown-garbage-token')).rejects.toBeInstanceOf(RefreshTokenInvalidError);
    });

    it('rejects rotation on revoked session', async () => {
      const user = await activeUser();
      const created = await sessions.createSession({ userId: user.id, platform: 'web' });
      await sessions.revokeSession(created.sessionId, 'logout');
      await expect(sessions.rotateRefreshToken(created.refreshToken)).rejects.toBeInstanceOf(SessionRevokedError);
    });

    it('rejects rotation on expired session', async () => {
      const user = await activeUser();
      const created = await sessions.createSession({ userId: user.id, platform: 'web' });
      await prisma.authSession.update({ where: { id: created.sessionId }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await expect(sessions.rotateRefreshToken(created.refreshToken)).rejects.toBeInstanceOf(SessionExpiredError);
    });

    it('revokeSession is idempotent', async () => {
      const user = await activeUser();
      const created = await sessions.createSession({ userId: user.id, platform: 'web' });
      await sessions.revokeSession(created.sessionId, 'logout');
      await sessions.revokeSession(created.sessionId, 'logout'); // no throw
      const session = await prisma.authSession.findUnique({ where: { id: created.sessionId } });
      expect(session!.revokedAt).toBeTruthy();
    });

    it('revokeAllUserSessions revokes all sessions', async () => {
      const user = await activeUser();
      const s1 = await sessions.createSession({ userId: user.id, platform: 'web' });
      const s2 = await sessions.createSession({ userId: user.id, platform: 'web' });
      await sessions.revokeAllUserSessions(user.id, 'logout_all');
      for (const id of [s1.sessionId, s2.sessionId]) {
        const s = await prisma.authSession.findUnique({ where: { id } });
        expect(s!.revokedAt).toBeTruthy();
      }
    });

    it('concurrent rotation with same token → at most one new child token', async () => {
      const user = await activeUser();
      const created = await sessions.createSession({ userId: user.id, platform: 'web' });
      const results = await Promise.allSettled([
        sessions.rotateRefreshToken(created.refreshToken),
        sessions.rotateRefreshToken(created.refreshToken),
      ]);
      const succeeded = results.filter((r) => r.status === 'fulfilled');
      expect(succeeded.length).toBeLessThanOrEqual(1);
      // Bir parent token'dan bittadan ortiq aktiv (usedAt=null) child bo'lmasligi kerak.
      const activeChildren = await prisma.refreshToken.findMany({
        where: { session: { id: created.sessionId }, usedAt: null, revokedAt: null },
      });
      expect(activeChildren.length).toBeLessThanOrEqual(1);
    });
  });

  // ── Security event hygiene ──
  describe('security events', () => {
    it('records otp_requested / session_created without OTP or token secrets', async () => {
      const issued = await otp.issueChallenge({ phone: PHONE, purpose: OtpPurpose.REGISTRATION });
      const user = await users.createLearnerAfterVerifiedPhone(PHONE);
      const created = await sessions.createSession({ userId: user.id, platform: 'web' });

      const events = await prisma.securityEvent.findMany();
      const serialized = JSON.stringify(events);
      expect(serialized).not.toContain(issued.code);
      expect(serialized).not.toContain(created.refreshToken);
      expect(serialized).not.toMatch(/postgresql:\/\//);
      // masked phone ishlatilgan (to'liq raw telefon metadata'da emas)
      expect(serialized).toContain('+99890');
      expect(serialized).not.toContain(PHONE); // to'liq canonical telefon metadata'da yo'q (masked)
      expect(events.some((e) => e.type === 'otp_requested')).toBe(true);
      expect(events.some((e) => e.type === 'session_created')).toBe(true);
    });
  });
});
