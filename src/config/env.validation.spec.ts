import { generateKeyPairSync } from 'node:crypto';
import { validateEnv } from './env.validation';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const KID = 'key-test';

describe('validateEnv', () => {
  const base = {
    DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/db',
    AUTH_OTP_PEPPER: 'test-pepper-abcdef0123456789',
    AUTH_JWT_ACTIVE_KID: KID,
    AUTH_JWT_PRIVATE_KEY_B64: Buffer.from(privateKey).toString('base64'),
    AUTH_JWT_PUBLIC_KEYS_JSON: JSON.stringify({ [KID]: Buffer.from(publicKey).toString('base64') }),
    AUTH_JWT_ISSUER: 'izlan-test',
    AUTH_JWT_AUDIENCE: 'izlan-web',
  };

  it('accepts valid env with defaults', () => {
    const env = validateEnv({ ...base });
    expect(env.nodeEnv).toBe('development');
    expect(env.host).toBe('0.0.0.0');
    expect(env.port).toBe(3000);
    expect(env.databaseUrl).toBe(base.DATABASE_URL);
    // auth tuning defaults
    expect(env.auth.otpTtlSeconds).toBe(180);
    expect(env.auth.otpMaxAttempts).toBe(5);
    expect(env.auth.sessionIdleTtlDays).toBe(30);
    expect(env.auth.sessionAbsoluteTtlDays).toBe(90);
  });

  it('fails when AUTH_OTP_PEPPER missing', () => {
    const { AUTH_OTP_PEPPER: _omit, ...noPepper } = base;
    expect(() => validateEnv(noPepper)).toThrow(/AUTH_OTP_PEPPER is required/);
  });

  it('fails when JWT keys missing / active kid not in public map', () => {
    const { AUTH_JWT_PRIVATE_KEY_B64: _p, ...noPriv } = base;
    expect(() => validateEnv(noPriv)).toThrow(/AUTH_JWT_PRIVATE_KEY_B64/);
    expect(() => validateEnv({ ...base, AUTH_JWT_ACTIVE_KID: 'missing-kid' })).toThrow(/AUTH_JWT_ACTIVE_KID must exist/);
  });

  it('fails when AUTH_COOKIE_SECURE=false in production', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production', AUTH_OTP_PEPPER: 'a'.repeat(30), AUTH_COOKIE_SECURE: 'false' })).toThrow(/AUTH_COOKIE_SECURE/);
  });

  it('fails on short AUTH_OTP_PEPPER in production', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production', AUTH_OTP_PEPPER: 'short' })).toThrow(/AUTH_OTP_PEPPER/);
  });

  it('does not leak AUTH_OTP_PEPPER value in error', () => {
    try {
      validateEnv({ ...base, NODE_ENV: 'production', AUTH_OTP_PEPPER: 'secretpepper' });
      fail('should throw');
    } catch (e) {
      expect((e as Error).message).not.toContain('secretpepper');
    }
  });

  it('fails when DATABASE_URL missing (§11 fail-fast)', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL is required/);
  });

  it('fails on non-postgres DATABASE_URL', () => {
    expect(() => validateEnv({ DATABASE_URL: 'mysql://x' })).toThrow(/postgres/);
  });

  it('fails on invalid PORT', () => {
    expect(() => validateEnv({ ...base, PORT: '99999' })).toThrow(/PORT/);
    expect(() => validateEnv({ ...base, PORT: 'abc' })).toThrow(/PORT/);
  });

  it('fails on invalid NODE_ENV', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('does NOT leak DATABASE_URL value in error message (§11)', () => {
    const secret = 'postgresql://admin:supersecret@h:5432/db extra';
    try {
      validateEnv({ DATABASE_URL: secret });
      fail('should have thrown');
    } catch (e) {
      expect((e as Error).message).not.toContain('supersecret');
    }
  });

  it('parses CORS_ORIGINS and TRUST_PROXY', () => {
    const env = validateEnv({ ...base, CORS_ORIGINS: 'http://a, http://b', TRUST_PROXY: 'true' });
    expect(env.corsOrigins).toEqual(['http://a', 'http://b']);
    expect(env.trustProxy).toBe(true);
  });

  it('fails on out-of-range auth tuning', () => {
    expect(() => validateEnv({ ...base, AUTH_OTP_MAX_ATTEMPTS: '0' })).toThrow(/AUTH_OTP_MAX_ATTEMPTS/);
    expect(() => validateEnv({ ...base, AUTH_OTP_TTL_SECONDS: '5' })).toThrow(/AUTH_OTP_TTL_SECONDS/);
  });
});
