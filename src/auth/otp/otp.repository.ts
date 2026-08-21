import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

/**
 * OtpRepository — OtpChallenge primitive'lar. Plaintext OTP saqlanmaydi/qaytarilmaydi (faqat codeHash).
 * Rate-limit querylari OtpChallenge tarixidan (§22) — eski row'lar cleanup'gacha history sifatida qoladi.
 */
@Injectable()
export class OtpRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Prisma.TransactionClient): Prisma.TransactionClient {
    return tx ?? this.prisma;
  }

  create(
    data: { phone: string; purpose: string; codeHash: string; expiresAt: Date; requestIp?: string | null },
    tx?: Prisma.TransactionClient,
  ) {
    return this.db(tx).otpChallenge.create({
      data: {
        phone: data.phone,
        purpose: data.purpose,
        codeHash: data.codeHash,
        expiresAt: data.expiresAt,
        requestIp: data.requestIp ?? null,
      },
    });
  }

  findById(id: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).otpChallenge.findUnique({ where: { id } });
  }

  /** Resend'da oldingi active challenge(lar)ni invalidatsiya qiladi (bir vaqtda bitta amal qiluvchi OTP). */
  invalidateActive(phone: string, purpose: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).otpChallenge.updateMany({
      where: { phone, purpose, consumedAt: null, invalidatedAt: null },
      data: { invalidatedAt: new Date() },
    });
  }

  incrementAttempt(id: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).otpChallenge.update({
      where: { id },
      data: { attemptCount: { increment: 1 } },
    });
  }

  markInvalidated(id: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).otpChallenge.update({
      where: { id },
      data: { invalidatedAt: new Date() },
    });
  }

  /** Atomik one-shot consume — faqat hali consume qilinmagan bo'lsa. count=1 → biz consume qildik. */
  consumeIfUnconsumed(id: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).otpChallenge.updateMany({
      where: { id, consumedAt: null, invalidatedAt: null },
      data: { consumedAt: new Date() },
    });
  }

  countSince(phone: string, since: Date, tx?: Prisma.TransactionClient) {
    return this.db(tx).otpChallenge.count({ where: { phone, createdAt: { gte: since } } });
  }

  findLatest(phone: string, purpose: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).otpChallenge.findFirst({
      where: { phone, purpose },
      orderBy: { createdAt: 'desc' },
    });
  }
}
