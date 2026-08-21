import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

/** RefreshTokenRepository — DB faqat hash saqlaydi (§26). Delete YO'Q (reuse detection tarixi). */
@Injectable()
export class RefreshTokenRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Prisma.TransactionClient): Prisma.TransactionClient {
    return tx ?? this.prisma;
  }

  create(data: { sessionId: string; tokenHash: string; expiresAt: Date }, tx?: Prisma.TransactionClient) {
    return this.db(tx).refreshToken.create({ data });
  }

  /** Indexed hash lookup (§32) — session bilan. */
  findByHash(tokenHash: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).refreshToken.findUnique({ where: { tokenHash }, include: { session: true } });
  }

  /** Atomik rotate — faqat active token. count=1 → biz mark used qildik; count=0 → parallel/reuse. */
  markUsedIfActive(id: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).refreshToken.updateMany({
      where: { id, usedAt: null, revokedAt: null },
      data: { usedAt: new Date() },
    });
  }

  linkReplacement(id: string, replacedById: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).refreshToken.update({ where: { id }, data: { replacedById } });
  }

  revokeAllForSession(sessionId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).refreshToken.updateMany({
      where: { sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  revokeAllForUser(userId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).refreshToken.updateMany({
      where: { session: { userId }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
