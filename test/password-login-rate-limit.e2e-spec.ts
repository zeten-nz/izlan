import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { PasswordLoginRateLimiter } from '../src/auth/password/password-login-rate-limiter';
import { cleanupAuthTables } from './test-db.helper';

const WINDOW = 3_600_000;

describe('Password-login rate limiter — DB-backed / cross-process (e2e, izlan_test)', () => {
  let mod: TestingModule;
  let prisma: PrismaService;
  let limiter: PasswordLoginRateLimiter;
  let config: ConfigService;

  beforeAll(async () => {
    mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await mod.init();
    prisma = mod.get(PrismaService);
    limiter = mod.get(PasswordLoginRateLimiter);
    config = mod.get(ConfigService);
    await cleanupAuthTables(prisma);
  });
  afterAll(async () => {
    await cleanupAuthTables(prisma);
    await mod.close();
  });
  beforeEach(async () => {
    await cleanupAuthTables(prisma);
  });

  const ipOnly = (ip: string, ipLimit: number) => limiter.consume({ ip, canonicalPhone: null, ipLimit, phoneLimit: 999, windowMs: WINDOW });

  it('RATE-PWD-01 attempt state survives service-instance recreation (state is in the DB, not memory)', async () => {
    expect((await ipOnly('10.0.0.1', 3)).allowed).toBe(true);
    expect((await ipOnly('10.0.0.1', 3)).allowed).toBe(true);
    expect((await ipOnly('10.0.0.1', 3)).allowed).toBe(true);
    // A brand-new limiter instance sees the same persisted counter.
    const fresh = new PasswordLoginRateLimiter(prisma, config);
    expect((await fresh.consume({ ip: '10.0.0.1', canonicalPhone: null, ipLimit: 3, phoneLimit: 999, windowMs: WINDOW })).allowed).toBe(false);
  });

  it('RATE-PWD-02 two limiter instances sharing the same DB see the SAME counter', async () => {
    const a = new PasswordLoginRateLimiter(prisma, config);
    const b = new PasswordLoginRateLimiter(prisma, config);
    expect((await a.consume({ ip: '10.0.0.2', canonicalPhone: null, ipLimit: 2, phoneLimit: 999, windowMs: WINDOW })).allowed).toBe(true);
    expect((await b.consume({ ip: '10.0.0.2', canonicalPhone: null, ipLimit: 2, phoneLimit: 999, windowMs: WINDOW })).allowed).toBe(true);
    expect((await a.consume({ ip: '10.0.0.2', canonicalPhone: null, ipLimit: 2, phoneLimit: 999, windowMs: WINDOW })).allowed).toBe(false);
  });

  it('RATE-PWD-03 per-phone limit enforced persistently (across varying IPs)', async () => {
    const phone = '+998901112233';
    const call = (ip: string) => limiter.consume({ ip, canonicalPhone: phone, ipLimit: 999, phoneLimit: 2, windowMs: WINDOW });
    expect((await call('1.1.1.1')).allowed).toBe(true);
    expect((await call('2.2.2.2')).allowed).toBe(true);
    expect((await call('3.3.3.3')).allowed).toBe(false); // phone bucket exhausted regardless of IP
  });

  it('RATE-PWD-04 per-IP limit enforced persistently (across varying phones)', async () => {
    const call = (phone: string) => limiter.consume({ ip: '9.9.9.9', canonicalPhone: phone, ipLimit: 2, phoneLimit: 999, windowMs: WINDOW });
    expect((await call('+998901000001')).allowed).toBe(true);
    expect((await call('+998901000002')).allowed).toBe(true);
    expect((await call('+998901000003')).allowed).toBe(false); // IP bucket exhausted regardless of phone
  });

  it('RATE-PWD-05 concurrent attempts at the final remaining slot cannot both consume it', async () => {
    const both = await Promise.all([ipOnly('8.8.8.8', 1), ipOnly('8.8.8.8', 1)]);
    expect(both.filter((r) => r.allowed).length).toBe(1); // advisory-lock serialization — exactly one wins
    expect(await prisma.securityEvent.count({ where: { type: 'password_login_attempt', ip: '8.8.8.8' } })).toBe(1);
  });

  it('RATE-PWD-06 malformed phones still consume the IP budget (no global invalid-phone bucket)', async () => {
    expect((await ipOnly('7.7.7.7', 2)).allowed).toBe(true);
    expect((await ipOnly('7.7.7.7', 2)).allowed).toBe(true);
    expect((await ipOnly('7.7.7.7', 2)).allowed).toBe(false); // IP-limited even with no phone
    const rows = await prisma.securityEvent.findMany({ where: { type: 'password_login_attempt', ip: '7.7.7.7' } });
    for (const r of rows) expect(r.metadata).toBeNull(); // no phone fingerprint bucket for malformed phones
  });

  it('RATE-PWD-07 no raw phone/password appears in SecurityEvent metadata — only an HMAC fingerprint', async () => {
    const phone = '+998907654321';
    await limiter.consume({ ip: '6.6.6.6', canonicalPhone: phone, ipLimit: 999, phoneLimit: 999, windowMs: WINDOW });
    const rows = await prisma.securityEvent.findMany({ where: { type: 'password_login_attempt' } });
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain(phone); // raw phone never stored as a rate-limit key
    expect(dump).not.toContain('+998'); // no raw phone fragment at all (the type name aside)
    const fp = (rows[0]!.metadata as { phoneFingerprint?: string }).phoneFingerprint;
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    expect(fp).toBe(limiter.fingerprint(phone)); // deterministic
  });
});
