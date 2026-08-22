import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { AuthConfig } from '../../config/env.validation';
import { SecurityEventType } from '../../security/security-events.service';

// Advisory-lock namespace (domain separation) for password-login rate limiting.
const LOCK_NAMESPACE = 528;
const IP_KEY_PREFIX = 'izlan:password-login-rate-limit:ip:';
const PHONE_FINGERPRINT_DOMAIN = 'izlan:password-login-rate-limit:';

export interface ConsumeInput {
  ip: string | null;
  canonicalPhone: string | null; // null when phone normalization failed → IP-only protection (§6)
  ipLimit: number;
  phoneLimit: number;
  windowMs: number;
}

/**
 * DB-backed, CROSS-PROCESS password-login rate limiter (TD-252 clarified, Blocker A). The authority is the append-only
 * `SecurityEvent` table — NO new schema/migration, so it survives restarts and is shared across PM2/multi-instance
 * workers (unlike the process-local InMemoryAuthRateLimiter, which is NOT the password-login authority). Concurrent
 * attempts are serialized with transaction-scoped Postgres advisory locks acquired in a deterministic order (no
 * deadlock), so attempts cannot overshoot the configured bucket. The raw phone is NEVER stored as a key — only an
 * HMAC-SHA256 fingerprint (peppered, domain-separated).
 */
@Injectable()
export class PasswordLoginRateLimiter {
  private readonly pepper: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.pepper = config.getOrThrow<AuthConfig>('auth').otpPepper;
  }

  /** Deterministic privacy-safe fingerprint of a canonical phone (never the raw phone in storage). */
  fingerprint(canonicalPhone: string): string {
    return createHmac('sha256', this.pepper).update(PHONE_FINGERPRINT_DOMAIN + canonicalPhone).digest('hex');
  }

  /**
   * Atomically: acquire advisory lock(s) → count attempts in the window → deny if a limit is already reached, else
   * record ONE PASSWORD_LOGIN_ATTEMPT and allow. The caller runs Argon2 verification only AFTER this commits.
   */
  async consume(input: ConsumeInput): Promise<{ allowed: boolean }> {
    const windowStart = new Date(Date.now() - input.windowMs);
    const fp = input.canonicalPhone ? this.fingerprint(input.canonicalPhone) : null;
    // Deterministic lock order across processes: sort the lock strings (ip + optional phone-fingerprint bucket).
    const lockKeys = [IP_KEY_PREFIX + (input.ip ?? 'unknown'), ...(fp ? [PHONE_FINGERPRINT_DOMAIN + fp] : [])].sort();

    return this.prisma.$transaction(async (tx) => {
      for (const key of lockKeys) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_NAMESPACE}::int, hashtext(${key})::int)`;
      }

      const ipCount = await tx.securityEvent.count({
        where: { type: SecurityEventType.PASSWORD_LOGIN_ATTEMPT, ip: input.ip, createdAt: { gt: windowStart } },
      });
      if (ipCount >= input.ipLimit) return { allowed: false };

      if (fp) {
        const phoneCount = await tx.securityEvent.count({
          where: { type: SecurityEventType.PASSWORD_LOGIN_ATTEMPT, metadata: { path: ['phoneFingerprint'], equals: fp }, createdAt: { gt: windowStart } },
        });
        if (phoneCount >= input.phoneLimit) return { allowed: false };
      }

      await tx.securityEvent.create({
        data: { type: SecurityEventType.PASSWORD_LOGIN_ATTEMPT, ip: input.ip, metadata: fp ? { phoneFingerprint: fp } : Prisma.JsonNull },
      });
      return { allowed: true };
    });
  }
}
