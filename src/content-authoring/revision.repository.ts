import { Injectable } from '@nestjs/common';
import { Prisma, RevisionStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { nextOptimisticTimestamp } from './optimistic-concurrency';

/**
 * LessonRevision persistence (Phase 2.2A-2). Version is backend authority (max+1); scoped reads flatten the resolved
 * `subjectId` from the parent chain. Only DRAFT revisions are mutable; `touchRevision` is the revision-aggregate
 * concurrency claim used by every Activity mutation (§12).
 */
@Injectable()
export class RevisionRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Prisma.TransactionClient): Prisma.TransactionClient {
    return (tx ?? this.prisma) as Prisma.TransactionClient;
  }

  async maxVersion(tx: Prisma.TransactionClient, lessonId: string): Promise<number> {
    const agg = await tx.lessonRevision.aggregate({ where: { lessonId }, _max: { version: true } });
    return agg._max.version ?? 0;
  }

  create(tx: Prisma.TransactionClient, data: { lessonId: string; version: number; title: string; description: string | null; createdBy: string }) {
    return tx.lessonRevision.create({
      data: { lessonId: data.lessonId, version: data.version, title: data.title, description: data.description, status: RevisionStatus.DRAFT, createdBy: data.createdBy, updatedBy: data.createdBy },
      select: REVISION_SELECT,
    });
  }

  async findRevisionScoped(id: string, tx?: Prisma.TransactionClient) {
    const r = await this.db(tx).lessonRevision.findUnique({
      where: { id },
      select: { ...REVISION_SELECT, lesson: { select: { topic: { select: { module: { select: { level: { select: { track: { select: { subjectId: true } } } } } } } } } } },
    });
    if (!r) return null;
    const { lesson, ...rest } = r;
    return { ...rest, subjectId: lesson.topic.module.level.track.subjectId };
  }

  listByLesson(lessonId: string, tx?: Prisma.TransactionClient) {
    // Newest-first: version DESC (documented convention, §21).
    return this.db(tx).lessonRevision.findMany({ where: { lessonId }, select: REVISION_SELECT, orderBy: [{ version: 'desc' }] });
  }

  updateRevisionConditional(tx: Prisma.TransactionClient, id: string, expectedUpdatedAt: Date, data: Prisma.LessonRevisionUncheckedUpdateManyInput) {
    return tx.lessonRevision.updateMany({ where: { id, updatedAt: expectedUpdatedAt, status: RevisionStatus.DRAFT }, data: { ...data, updatedAt: nextOptimisticTimestamp(expectedUpdatedAt) } });
  }

  /**
   * Concurrency claim for Activity mutations (§12): bump updatedAt (strictly, +updatedBy) iff still DRAFT with the
   * expected token. The explicit `updatedAt` guarantees the returned revision token advances by ≥1ms even at the
   * TIMESTAMP(3) same-millisecond boundary.
   */
  touchRevision(tx: Prisma.TransactionClient, id: string, expectedUpdatedAt: Date, updatedBy: string) {
    return tx.lessonRevision.updateMany({ where: { id, updatedAt: expectedUpdatedAt, status: RevisionStatus.DRAFT }, data: { updatedBy, updatedAt: nextOptimisticTimestamp(expectedUpdatedAt) } });
  }

  async currentUpdatedAt(tx: Prisma.TransactionClient, id: string): Promise<Date | null> {
    const r = await tx.lessonRevision.findUnique({ where: { id }, select: { updatedAt: true } });
    return r?.updatedAt ?? null;
  }
}

const REVISION_SELECT = {
  id: true, lessonId: true, version: true, title: true, description: true, estimatedDurationMin: true, status: true,
  createdBy: true, updatedBy: true, reviewedBy: true, publishedBy: true, publishedAt: true, createdAt: true, updatedAt: true,
} satisfies Prisma.LessonRevisionSelect;
