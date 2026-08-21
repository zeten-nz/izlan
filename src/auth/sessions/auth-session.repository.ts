import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

/** AuthSessionRepository — server-side session record. Delete YO'Q (§34 — reuse/security uchun history). */
@Injectable()
export class AuthSessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Prisma.TransactionClient): Prisma.TransactionClient {
    return tx ?? this.prisma;
  }

  create(
    data: { userId: string; platform: string; clientInfo?: string | null; expiresAt: Date },
    tx?: Prisma.TransactionClient,
  ) {
    return this.db(tx).authSession.create({
      data: {
        userId: data.userId,
        platform: data.platform,
        clientInfo: data.clientInfo ?? null,
        expiresAt: data.expiresAt,
      },
    });
  }

  findById(id: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).authSession.findUnique({ where: { id } });
  }

  updateLastActivity(id: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).authSession.update({ where: { id }, data: { lastActivity: new Date() } });
  }

  /** Idempotent revoke — faqat hali revoke qilinmagan bo'lsa (count>0 = biz revoke qildik). */
  revoke(id: string, reason: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).authSession.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  revokeAllForUser(userId: string, reason: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }
}
