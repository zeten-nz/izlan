import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

/**
 * SecurityEventsRepository — append-only (§24). Faqat insert (update/delete YO'Q).
 * metadata'ga OTP/token/secret HECH QACHON yozilmaydi (§25) — buni service qatlami ta'minlaydi.
 */
@Injectable()
export class SecurityEventsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Prisma.TransactionClient): Prisma.TransactionClient {
    return tx ?? this.prisma;
  }

  create(
    data: {
      type: string;
      userId?: string | null;
      sessionId?: string | null;
      ip?: string | null;
      clientInfo?: string | null;
      metadata?: Prisma.InputJsonValue | null;
    },
    tx?: Prisma.TransactionClient,
  ) {
    return this.db(tx).securityEvent.create({
      data: {
        type: data.type,
        userId: data.userId ?? null,
        sessionId: data.sessionId ?? null,
        ip: data.ip ?? null,
        clientInfo: data.clientInfo ?? null,
        metadata: data.metadata ?? Prisma.JsonNull,
      },
    });
  }

  findByUser(userId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).securityEvent.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
  }
}
