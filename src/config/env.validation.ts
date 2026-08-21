/**
 * Startup environment validation (Phase 1.4A/B/C).
 * Explicit fail-fast. Xatoda qiymatlar (DATABASE_URL, pepper, JWT key, parollar) HECH QACHON log qilinmaydi.
 */
import { createPrivateKey, createPublicKey } from 'node:crypto';

export type NodeEnv = 'development' | 'test' | 'production';

/** JWT (RS256) config — 1.4C. Kalitlar startup'da decode+parse qilinadi (fail-fast); qiymatlar log qilinmaydi. */
export interface JwtConfig {
  activeKid: string;
  privateKeyPem: string; // decoded PEM
  publicKeysPem: Record<string, string>; // kid → decoded PEM (rotation-ready map, §62/63)
  issuer: string;
  audience: string;
  accessTtlSeconds: number;
}

/** Auth tuning — product qarori EMAS (implementation tuning, TD-11/29). */
export interface AuthConfig {
  otpPepper: string;
  otpTtlSeconds: number;
  otpResendCooldownSeconds: number;
  otpMaxAttempts: number;
  otpPhoneHourlyLimit: number;
  otpPhoneDailyLimit: number;
  otpIpHourlyLimit: number;
  sessionIdleTtlDays: number;
  sessionAbsoluteTtlDays: number;
  cookieSecure: boolean;
}

export interface AppEnv {
  nodeEnv: NodeEnv;
  host: string;
  port: number;
  databaseUrl: string;
  corsOrigins: string[];
  trustProxy: boolean;
  auth: AuthConfig;
  jwt: JwtConfig;
}

/** RSA PEM decode+validate. Malformed → throw (qiymat log qilinmaydi). */
function decodeRsaKey(b64: string, kind: 'private' | 'public'): string {
  const pem = Buffer.from(b64, 'base64').toString('utf8');
  if (kind === 'private') {
    const k = createPrivateKey(pem);
    if (k.asymmetricKeyType !== 'rsa') throw new Error('not an RSA private key');
  } else {
    const k = createPublicKey(pem);
    if (k.asymmetricKeyType !== 'rsa') throw new Error('not an RSA public key');
  }
  return pem;
}

function buildJwtConfig(raw: Record<string, unknown>, nodeEnv: NodeEnv, errors: string[]): JwtConfig {
  const activeKid = ((raw.AUTH_JWT_ACTIVE_KID as string) ?? '').trim();
  if (!activeKid) errors.push('AUTH_JWT_ACTIVE_KID is required');

  let privateKeyPem = '';
  try {
    const b64 = (raw.AUTH_JWT_PRIVATE_KEY_B64 as string) ?? '';
    if (!b64) throw new Error('missing');
    privateKeyPem = decodeRsaKey(b64, 'private');
  } catch {
    errors.push('AUTH_JWT_PRIVATE_KEY_B64 is required and must be a valid base64 RSA PKCS8 PEM');
  }

  const publicKeysPem: Record<string, string> = {};
  try {
    const json = (raw.AUTH_JWT_PUBLIC_KEYS_JSON as string) ?? '';
    if (!json) throw new Error('missing');
    const map = JSON.parse(json) as Record<string, string>;
    for (const [kid, b64] of Object.entries(map)) publicKeysPem[kid] = decodeRsaKey(b64, 'public');
  } catch {
    errors.push('AUTH_JWT_PUBLIC_KEYS_JSON is required and must map kid → base64 RSA public PEM');
  }

  if (activeKid && !publicKeysPem[activeKid]) {
    errors.push('AUTH_JWT_ACTIVE_KID must exist in AUTH_JWT_PUBLIC_KEYS_JSON');
  }

  const issuer = ((raw.AUTH_JWT_ISSUER as string) ?? '').trim();
  if (!issuer) errors.push('AUTH_JWT_ISSUER is required');
  const audience = ((raw.AUTH_JWT_AUDIENCE as string) ?? '').trim();
  if (!audience) errors.push('AUTH_JWT_AUDIENCE is required');

  const accessTtlSeconds = parseIntEnv(raw, 'AUTH_ACCESS_TTL_SECONDS', 900, 60, 3600, errors);

  return { activeKid, privateKeyPem, publicKeysPem, issuer, audience, accessTtlSeconds };
}

function parseIntEnv(
  raw: Record<string, unknown>,
  key: string,
  def: number,
  min: number,
  max: number,
  errors: string[],
): number {
  const v = (raw[key] as string) ?? String(def);
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    errors.push(`${key} must be an integer in ${min}..${max} (got: ${v})`);
    return def;
  }
  return n;
}

export function validateEnv(raw: Record<string, unknown>): AppEnv {
  const errors: string[] = [];

  const nodeEnvRaw = (raw.NODE_ENV as string) ?? 'development';
  if (!['development', 'test', 'production'].includes(nodeEnvRaw)) {
    errors.push(`NODE_ENV must be development|test|production (got: ${nodeEnvRaw})`);
  }
  const nodeEnv = nodeEnvRaw as NodeEnv;

  const host = ((raw.HOST as string) ?? '0.0.0.0').trim();
  if (host.length === 0) errors.push('HOST must be non-empty');

  const portRaw = (raw.PORT as string) ?? '3000';
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push(`PORT must be an integer in 1..65535 (got: ${portRaw})`);
  }

  const databaseUrl = (raw.DATABASE_URL as string) ?? '';
  if (databaseUrl.length === 0) {
    errors.push('DATABASE_URL is required');
  } else if (!/^postgres(ql)?:\/\/.+/.test(databaseUrl)) {
    errors.push('DATABASE_URL must be a postgres:// connection URL');
  }

  const corsOrigins = ((raw.CORS_ORIGINS as string) ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);

  const trustProxy = (raw.TRUST_PROXY as string) === 'true';

  // ---- Auth (1.4B) ----
  const otpPepper = ((raw.AUTH_OTP_PEPPER as string) ?? '').trim();
  if (otpPepper.length === 0) {
    errors.push('AUTH_OTP_PEPPER is required');
  } else if (nodeEnv === 'production' && otpPepper.length < 24) {
    // Production'da trivial/qisqa placeholder taqiqlanadi (qiymat log qilinmaydi).
    errors.push('AUTH_OTP_PEPPER must be at least 24 chars in production');
  }

  // Cookie secure — production'da MAJBURIY true (§27); dev/test'da false ruxsat.
  const cookieSecureRaw = (raw.AUTH_COOKIE_SECURE as string) ?? (nodeEnv === 'production' ? 'true' : 'false');
  const cookieSecure = cookieSecureRaw === 'true';
  if (nodeEnv === 'production' && !cookieSecure) {
    errors.push('AUTH_COOKIE_SECURE must be true in production');
  }

  const auth: AuthConfig = {
    otpPepper,
    otpTtlSeconds: parseIntEnv(raw, 'AUTH_OTP_TTL_SECONDS', 180, 30, 3600, errors),
    otpResendCooldownSeconds: parseIntEnv(raw, 'AUTH_OTP_RESEND_COOLDOWN_SECONDS', 60, 0, 3600, errors),
    otpMaxAttempts: parseIntEnv(raw, 'AUTH_OTP_MAX_ATTEMPTS', 5, 1, 20, errors),
    otpPhoneHourlyLimit: parseIntEnv(raw, 'AUTH_OTP_PHONE_HOURLY_LIMIT', 5, 1, 100, errors),
    otpPhoneDailyLimit: parseIntEnv(raw, 'AUTH_OTP_PHONE_DAILY_LIMIT', 10, 1, 500, errors),
    otpIpHourlyLimit: parseIntEnv(raw, 'AUTH_OTP_IP_HOURLY_LIMIT', 10, 1, 1000, errors),
    sessionIdleTtlDays: parseIntEnv(raw, 'AUTH_SESSION_IDLE_TTL_DAYS', 30, 1, 365, errors),
    sessionAbsoluteTtlDays: parseIntEnv(raw, 'AUTH_SESSION_ABSOLUTE_TTL_DAYS', 90, 1, 730, errors),
    cookieSecure,
  };

  const jwt = buildJwtConfig(raw, nodeEnv, errors);

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n- ${errors.join('\n- ')}`);
  }

  return { nodeEnv, host, port, databaseUrl, corsOrigins, trustProxy, auth, jwt };
}
