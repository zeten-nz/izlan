import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import type { AuthConfig } from '../../config/env.validation';
import {
  OtpChallengeNotFoundError,
  OtpCooldownError,
  OtpExpiredError,
  OtpInvalidError,
  OtpLockedError,
  OtpRateLimitError,
} from '../../common/errors';
import { normalizeUzPhone } from '../../users/phone.util';
import { maskPhone } from '../../security/phone-mask.util';
import { SecurityEventsService, SecurityEventType } from '../../security/security-events.service';
import { OtpCodeService } from './otp-code.service';
import { OtpRepository } from './otp.repository';

/** issueChallenge natijasi — raw `code` faqat SMS adapter uchun (repository saqlamaydi). */
export interface IssuedChallenge {
  challengeId: string;
  canonicalPhone: string;
  code: string;
  expiresAt: Date;
}

@Injectable()
export class OtpService {
  private readonly cfg: AuthConfig;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly repo: OtpRepository,
    private readonly codeService: OtpCodeService,
    private readonly securityEvents: SecurityEventsService,
  ) {
    this.cfg = config.getOrThrow<AuthConfig>('auth');
  }

  /**
   * OTP challenge yaratish (§17). Account mavjudligini TEKSHIRMAYDI (§21 enumeration-safe).
   * Raw code faqat return path'da; DB faqat hash saqlaydi; log YO'Q.
   */
  async issueChallenge(input: { phone: string; purpose: string; ip?: string | null }): Promise<IssuedChallenge> {
    const canonicalPhone = normalizeUzPhone(input.phone); // PhoneInvalidError throw qilishi mumkin
    const now = Date.now();

    // Resend cooldown (§13/17) — oxirgi challenge yaqinda yaratilganmi.
    const latest = await this.repo.findLatest(canonicalPhone, input.purpose);
    if (latest && now - latest.createdAt.getTime() < this.cfg.otpResendCooldownSeconds * 1000) {
      throw new OtpCooldownError('otp resend cooldown active');
    }

    // DB-backed per-phone limits (§22).
    const hourAgo = new Date(now - 3600_000);
    const dayAgo = new Date(now - 86_400_000);
    if ((await this.repo.countSince(canonicalPhone, hourAgo)) >= this.cfg.otpPhoneHourlyLimit) {
      await this.securityEvents.record({
        type: SecurityEventType.RATE_LIMIT_TRIGGERED,
        metadata: { scope: 'otp_phone_hourly', phone: maskPhone(canonicalPhone) },
      });
      throw new OtpRateLimitError('otp hourly limit reached');
    }
    if ((await this.repo.countSince(canonicalPhone, dayAgo)) >= this.cfg.otpPhoneDailyLimit) {
      throw new OtpRateLimitError('otp daily limit reached');
    }

    const code = this.codeService.generateCode();
    const codeHash = this.codeService.hashCode(input.purpose, canonicalPhone, code);
    const expiresAt = new Date(now + this.cfg.otpTtlSeconds * 1000);

    // Invalidate prior + create — atomik (§39). Transaction boundary service'da, query'lar repository'da (§40).
    const challenge = await this.prisma.$transaction(async (tx) => {
      await this.repo.invalidateActive(canonicalPhone, input.purpose, tx);
      return this.repo.create({ phone: canonicalPhone, purpose: input.purpose, codeHash, expiresAt, requestIp: input.ip ?? null }, tx);
    });

    await this.securityEvents.record({
      type: SecurityEventType.OTP_REQUESTED,
      ip: input.ip ?? null,
      metadata: { phone: maskPhone(canonicalPhone), purpose: input.purpose }, // raw OTP/hash YO'Q (§25)
    });

    return { challengeId: challenge.id, canonicalPhone, code, expiresAt };
  }

  /** SMS delivery fail'da yaratilgan challenge'ni bekor qilish (§21) — foydalanuvchi olmagan OTP ishlamasin. */
  async invalidateChallenge(challengeId: string): Promise<void> {
    await this.repo.markInvalidated(challengeId);
  }

  /**
   * OTP verify (§20). Har step atomik va standalone commit — fail'da attempt increment
   * transaction rollback bilan yo'qolmaydi (brute-force himoya ishonchli).
   */
  async verifyChallenge(input: {
    challengeId: string;
    purpose: string;
    code: string;
    phone?: string; // ixtiyoriy — berilsa qo'shimcha context check; canonical phone challenge'dan olinadi (§23)
  }): Promise<{ canonicalPhone: string }> {
    const challenge = await this.repo.findById(input.challengeId);
    if (!challenge || challenge.purpose !== input.purpose) {
      throw new OtpChallengeNotFoundError('otp challenge not found');
    }
    if (input.phone && challenge.phone !== normalizeUzPhone(input.phone)) {
      throw new OtpChallengeNotFoundError('otp challenge not found');
    }
    const canonicalPhone = challenge.phone;
    if (challenge.consumedAt || challenge.invalidatedAt) throw new OtpInvalidError('otp challenge no longer valid');
    if (challenge.expiresAt.getTime() < Date.now()) throw new OtpExpiredError('otp expired');
    if (challenge.attemptCount >= this.cfg.otpMaxAttempts) throw new OtpLockedError('otp locked');

    const ok = this.codeService.verifyCode(input.purpose, canonicalPhone, input.code, challenge.codeHash);
    if (!ok) {
      const updated = await this.repo.incrementAttempt(challenge.id);
      await this.securityEvents.record({
        type: SecurityEventType.OTP_VERIFY_FAILED,
        metadata: { phone: maskPhone(canonicalPhone), purpose: input.purpose },
      });
      if (updated.attemptCount >= this.cfg.otpMaxAttempts) {
        await this.repo.markInvalidated(challenge.id);
        await this.securityEvents.record({
          type: SecurityEventType.OTP_CHALLENGE_LOCKED,
          metadata: { phone: maskPhone(canonicalPhone), purpose: input.purpose },
        });
        throw new OtpLockedError('otp locked after max attempts');
      }
      throw new OtpInvalidError('invalid otp code');
    }

    // Atomik one-shot consume — parallel success'da faqat bittasi count=1 oladi (§20/47).
    const consumed = await this.repo.consumeIfUnconsumed(challenge.id);
    if (consumed.count !== 1) throw new OtpInvalidError('otp challenge no longer valid');

    return { canonicalPhone };
  }
}
