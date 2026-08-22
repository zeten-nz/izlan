import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { AuthConfig } from '../../config/env.validation';
import {
  RefreshReuseDetectedError,
  RefreshTokenInvalidError,
  SessionExpiredError,
  SessionRevokedError,
} from '../../common/errors';
import { SecurityEventsService, SecurityEventType } from '../../security/security-events.service';
import { UsersService } from '../../users/users.service';
import { AuthSessionRepository } from './auth-session.repository';
import { RefreshTokenRepository } from './refresh-token.repository';
import { generateRefreshTokenPlaintext, hashRefreshToken } from './refresh-token.crypto';

const DAY_MS = 86_400_000;

export interface CreatedSession {
  sessionId: string;
  refreshToken: string; // plaintext — faqat bir marta qaytariladi (§28)
}

@Injectable()
export class SessionsService {
  private readonly cfg: AuthConfig;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly sessions: AuthSessionRepository,
    private readonly tokens: RefreshTokenRepository,
    private readonly users: UsersService,
    private readonly securityEvents: SecurityEventsService,
  ) {
    this.cfg = config.getOrThrow<AuthConfig>('auth');
  }

  /**
   * Session + initial refresh token, atomik (§28/36). ACTIVE user talab qilinadi (SUSPENDED/DEACTIVATED rad).
   * Access token bu yerda YO'Q (§62) — 1.4C.
   */
  async createSession(input: { userId: string; platform: string; clientInfo?: string | null }): Promise<CreatedSession> {
    await this.users.assertAuthAllowed(input.userId); // AccountUnavailableError agar ACTIVE emas

    const now = Date.now();
    const sessionExpiresAt = new Date(now + this.cfg.sessionAbsoluteTtlDays * DAY_MS);
    const tokenExpiresAt = new Date(now + this.cfg.sessionIdleTtlDays * DAY_MS);
    const plaintext = generateRefreshTokenPlaintext();
    const tokenHash = hashRefreshToken(plaintext);

    const sessionId = await this.prisma.$transaction(async (tx) => {
      const session = await this.sessions.create(
        { userId: input.userId, platform: input.platform, clientInfo: input.clientInfo ?? null, expiresAt: sessionExpiresAt },
        tx,
      );
      await this.tokens.create({ sessionId: session.id, tokenHash, expiresAt: tokenExpiresAt }, tx);
      return session.id;
    });

    await this.securityEvents.record({
      type: SecurityEventType.SESSION_CREATED,
      userId: input.userId,
      sessionId,
      clientInfo: input.clientInfo ?? null,
    });

    return { sessionId, refreshToken: plaintext };
  }

  /**
   * Rotating refresh (§30). Atomik: bir eski token'dan IKKITA aktiv child token CHIQMAYDI.
   * Reuse (§31): used/revoked token qayta kelsa → butun session family revoke + security event.
   * Grace window YO'Q (§33) — strict TD-09; parallel false-positive 1.4C'da hal qilinadi.
   */
  async rotateRefreshToken(plaintext: string): Promise<{ sessionId: string; userId: string; refreshToken: string }> {
    const hash = hashRefreshToken(plaintext);
    const token = await this.tokens.findByHash(hash);

    // Unknown random token → invalid (reuse EMAS, §32). Keng lookup yo'q — indexed unique.
    if (!token) throw new RefreshTokenInvalidError('refresh token not recognized');

    const session = token.session;

    // Session revoked → SessionRevokedError (reuse emas).
    if (session.revokedAt) throw new SessionRevokedError('session revoked');

    // Token allaqachon used/revoked va qayta keldi → REUSE.
    if (token.usedAt || token.revokedAt) {
      await this.handleReuse(session.id, session.userId);
      throw new RefreshReuseDetectedError('refresh token reuse detected');
    }

    // Expiry: absolute (session) yoki idle (token).
    const now = Date.now();
    if (session.expiresAt.getTime() < now) throw new SessionExpiredError('session absolute expiry reached');
    if (token.expiresAt.getTime() < now) throw new SessionExpiredError('refresh token idle expiry reached');

    const newPlaintext = generateRefreshTokenPlaintext();
    const newHash = hashRefreshToken(newPlaintext);
    const newTokenExpiresAt = new Date(now + this.cfg.sessionIdleTtlDays * DAY_MS);

    // Atomik rotate — markUsedIfActive count qaror qiladi.
    const rotated = await this.prisma.$transaction(async (tx) => {
      const used = await this.tokens.markUsedIfActive(token.id, tx);
      if (used.count !== 1) return false; // parallel rotation — boshqa request oldin ishlatdi
      const created = await this.tokens.create({ sessionId: session.id, tokenHash: newHash, expiresAt: newTokenExpiresAt }, tx);
      await this.tokens.linkReplacement(token.id, created.id, tx);
      await this.sessions.updateLastActivity(session.id, tx);
      return true;
    });

    if (!rotated) {
      // Bir eski token'dan ikkinchi rotation urinishi → strict reuse semantics.
      await this.handleReuse(session.id, session.userId);
      throw new RefreshReuseDetectedError('refresh token reuse detected (concurrent)');
    }

    return { sessionId: session.id, userId: session.userId, refreshToken: newPlaintext };
  }

  /** Sensitive route live-check (§12) — session revoked/expired bo'lsa throw. */
  async assertSessionActive(sessionId: string): Promise<void> {
    const session = await this.sessions.findById(sessionId);
    if (!session || session.revokedAt) throw new SessionRevokedError('session not active');
    if (session.expiresAt.getTime() < Date.now()) throw new SessionExpiredError('session expired');
  }

  async revokeSession(sessionId: string, reason: string): Promise<void> {
    const result = await this.prisma.$transaction(async (tx) => {
      const r = await this.sessions.revoke(sessionId, reason, tx);
      await this.tokens.revokeAllForSession(sessionId, tx);
      return r.count;
    });
    if (result > 0) {
      const session = await this.sessions.findById(sessionId);
      await this.securityEvents.record({
        type: SecurityEventType.SESSION_REVOKED,
        userId: session?.userId ?? null,
        sessionId,
        metadata: { reason },
      });
    }
  }

  /**
   * Revoke ALL of a user's AuthSessions + their RefreshTokens within a CALLER-SUPPLIED transaction (§10). Preserves the
   * revokedAt/reason + token-revoke semantics; emits NO event (the caller owns event atomicity). Returns the revoked
   * session count. Reused by logout-all AND the atomic password-reset (so credential change + revocation commit together).
   */
  async revokeAllUserSessionsInTransaction(tx: Prisma.TransactionClient, userId: string, reason: string): Promise<number> {
    const r = await this.sessions.revokeAllForUser(userId, reason, tx);
    await this.tokens.revokeAllForUser(userId, tx);
    return r.count;
  }

  async revokeAllUserSessions(userId: string, reason: string): Promise<void> {
    const count = await this.prisma.$transaction((tx) => this.revokeAllUserSessionsInTransaction(tx, userId, reason));
    await this.securityEvents.record({
      type: SecurityEventType.ALL_SESSIONS_REVOKED,
      userId,
      metadata: { reason, revokedCount: count },
    });
  }

  /** Reuse/compromise → session + token family revoke + security event (idempotent). */
  private async handleReuse(sessionId: string, userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.sessions.revoke(sessionId, 'refresh_token_reuse_detected', tx);
      await this.tokens.revokeAllForSession(sessionId, tx);
    });
    await this.securityEvents.record({
      type: SecurityEventType.REFRESH_TOKEN_REUSE_DETECTED,
      userId,
      sessionId,
    });
  }
}
