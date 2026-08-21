import { Injectable } from '@nestjs/common';
import { ContainerStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

/**
 * LearnerLearningIntentRepository (TD-93). Narrow — onboarding uchun kerakli minimal set.
 * Generic Prisma CRUD expose qilinmaydi.
 */
@Injectable()
export class LearningIntentRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Prisma.TransactionClient): Prisma.TransactionClient {
    return tx ?? this.prisma;
  }

  /** Own intents — learner-facing subject/track ma'lumot bilan. */
  listByUser(userId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).learnerLearningIntent.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        subject: { select: { id: true, slug: true, title: true } },
        track: { select: { id: true, slug: true, title: true } },
      },
    });
  }

  /** Upsert unique(user, subject). trackData undefined → track o'zgarmaydi (subject-only, resumable §5/21). */
  upsert(userId: string, subjectId: string, trackData: { trackId: string | null } | undefined, tx?: Prisma.TransactionClient) {
    return this.db(tx).learnerLearningIntent.upsert({
      where: { userId_subjectId: { userId, subjectId } },
      update: trackData ?? {},
      create: { userId, subjectId, trackId: trackData?.trackId ?? null },
    });
  }

  /**
   * Own intent by id, with subject/track current lifecycle — placement entry validation (Phase 1.5B §5/7).
   * userId filter = IDOR guard; returns null for another user's intent.
   */
  findOwnById(intentId: string, userId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).learnerLearningIntent.findFirst({
      where: { id: intentId, userId },
      select: {
        id: true,
        subjectId: true,
        trackId: true,
        subject: { select: { status: true } },
        track: { select: { status: true, subjectId: true } },
      },
    });
  }

  /** Onboarding readiness (§23): trackId to'ldirilgan VA subject/track hozir PUBLISHED bo'lgan intentlar soni. */
  countCompleteVisible(userId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).learnerLearningIntent.count({
      where: {
        userId,
        trackId: { not: null },
        subject: { status: ContainerStatus.PUBLISHED },
        track: { status: ContainerStatus.PUBLISHED },
      },
    });
  }
}
