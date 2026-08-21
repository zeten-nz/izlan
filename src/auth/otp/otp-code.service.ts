import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt, createHmac, timingSafeEqual } from 'node:crypto';
import type { AuthConfig } from '../../config/env.validation';

/**
 * OTP kod kriptografiyasi (§14/15). DB/SMS'ga bog'liq EMAS.
 * - generate: 6 o'nlik raqam, leading zero saqlanadi, crypto-secure (Math.random EMAS).
 * - hash: HMAC-SHA-256(pepper, purpose \x1f phone \x1f code) — server pepper offline enumeratsiyani qiyinlashtiradi.
 * - verify: constant-time, teng uzunlikli digest bufer.
 * Raw OTP hech qachon saqlanmaydi/log qilinmaydi.
 */
@Injectable()
export class OtpCodeService {
  private readonly pepper: string;

  constructor(config: ConfigService) {
    this.pepper = config.getOrThrow<AuthConfig>('auth').otpPepper;
  }

  generateCode(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  hashCode(purpose: string, canonicalPhone: string, code: string): string {
    // \x1f (unit separator) — inputlarda uchramaydi → ambiguity yo'q.
    const message = `${purpose}\x1f${canonicalPhone}\x1f${code}`;
    return createHmac('sha256', this.pepper).update(message).digest('hex');
  }

  verifyCode(purpose: string, canonicalPhone: string, code: string, storedHash: string): boolean {
    const computed = this.hashCode(purpose, canonicalPhone, code);
    const a = Buffer.from(computed, 'hex');
    const b = Buffer.from(storedHash, 'hex');
    if (a.length !== b.length || a.length === 0) return false;
    return timingSafeEqual(a, b);
  }
}
