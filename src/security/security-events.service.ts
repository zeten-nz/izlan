import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SecurityEventsRepository } from './security-events.repository';

/**
 * Security event kodlari (§24). SecurityEvent ≠ StaffAudit (§60/TD-18/81).
 * Faqat haqiqatan sodir bo'lgan hodisa uchun yozuv (§24 — ishlamaydigan logic uchun row yaratilmaydi).
 */
export const SecurityEventType = {
  OTP_REQUESTED: 'otp_requested',
  OTP_VERIFY_FAILED: 'otp_verify_failed',
  OTP_CHALLENGE_LOCKED: 'otp_challenge_locked',
  LOGIN_SUCCESS: 'login_success',
  // Password auth (TD-252)
  REGISTRATION_SUCCESS: 'registration_success',
  PASSWORD_LOGIN_SUCCESS: 'password_login_success',
  PASSWORD_LOGIN_FAILED: 'password_login_failed',
  PASSWORD_RESET_REQUESTED: 'password_reset_requested',
  PASSWORD_RESET_SUCCESS: 'password_reset_success',
  SESSION_CREATED: 'session_created',
  SESSION_REVOKED: 'session_revoked',
  ALL_SESSIONS_REVOKED: 'all_sessions_revoked',
  REFRESH_TOKEN_REUSE_DETECTED: 'refresh_token_reuse_detected',
  RATE_LIMIT_TRIGGERED: 'rate_limit_triggered',
} as const;

export type SecurityEventType = (typeof SecurityEventType)[keyof typeof SecurityEventType];

@Injectable()
export class SecurityEventsService {
  constructor(private readonly repo: SecurityEventsRepository) {}

  /**
   * Xavfsiz record. metadata FAQAT xavfsiz kalitlarni o'z ichiga olishi kerak —
   * OTP/OTP-hash/refresh/refresh-hash/JWT/secret/DATABASE_URL HECH QACHON (§25).
   * Chaqiruvchi shu shartni ta'minlaydi.
   */
  record(
    input: {
      type: SecurityEventType;
      userId?: string | null;
      sessionId?: string | null;
      ip?: string | null;
      clientInfo?: string | null;
      metadata?: Prisma.InputJsonValue | null;
    },
    tx?: Prisma.TransactionClient,
  ) {
    return this.repo.create(input, tx);
  }
}
