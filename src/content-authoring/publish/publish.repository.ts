import { Injectable } from '@nestjs/common';
import { LessonStatus, Prisma, RevisionStatus } from '@prisma/client';
import { nextOptimisticTimestamp } from '../optimistic-concurrency';

/**
 * Publication persistence (Phase 2.2B). Serializes publish + takedown for a Lesson via `SELECT … FOR UPDATE`, and
 * performs the conditional revision-lifecycle + Lesson-pointer writes. All timestamps strictly advance (TIMESTAMP(3)).
 */
@Injectable()
export class PublishRepository {
  /** Serialize all publish/takedown transactions for this Lesson (block until the holder commits, §17). */
  async lockLesson(tx: Prisma.TransactionClient, lessonId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM "lesson" WHERE id = ${lessonId}::uuid FOR UPDATE`;
  }

  submitReview(tx: Prisma.TransactionClient, id: string, expectedUpdatedAt: Date, userId: string) {
    return tx.lessonRevision.updateMany({
      where: { id, status: RevisionStatus.DRAFT, updatedAt: expectedUpdatedAt },
      data: { status: RevisionStatus.REVIEW, updatedBy: userId, updatedAt: nextOptimisticTimestamp(expectedUpdatedAt) },
    });
  }

  returnToDraft(tx: Prisma.TransactionClient, id: string, expectedUpdatedAt: Date, userId: string) {
    return tx.lessonRevision.updateMany({
      where: { id, status: RevisionStatus.REVIEW, updatedAt: expectedUpdatedAt },
      data: { status: RevisionStatus.DRAFT, updatedBy: userId, updatedAt: nextOptimisticTimestamp(expectedUpdatedAt) },
    });
  }

  /** REVIEW → PUBLISHED: stamp reviewedBy/publishedBy/publishedAt + duration cache; strictly advance updatedAt. */
  publishRevision(tx: Prisma.TransactionClient, id: string, expectedUpdatedAt: Date, userId: string, publishedAt: Date, estimatedDurationMin: number | null) {
    return tx.lessonRevision.updateMany({
      where: { id, status: RevisionStatus.REVIEW, updatedAt: expectedUpdatedAt },
      data: { status: RevisionStatus.PUBLISHED, reviewedBy: userId, publishedBy: userId, publishedAt, updatedBy: userId, estimatedDurationMin, updatedAt: nextOptimisticTimestamp(expectedUpdatedAt) },
    });
  }

  /** Replace: old current revision PUBLISHED → ARCHIVED (guarded on PUBLISHED + same Lesson, §19). */
  archiveOldRevision(tx: Prisma.TransactionClient, id: string, lessonId: string, expectedUpdatedAt: Date, userId: string) {
    return tx.lessonRevision.updateMany({
      where: { id, lessonId, status: RevisionStatus.PUBLISHED },
      data: { status: RevisionStatus.ARCHIVED, updatedBy: userId, updatedAt: nextOptimisticTimestamp(expectedUpdatedAt) },
    });
  }

  moveLessonPointer(tx: Prisma.TransactionClient, lessonId: string, expectedUpdatedAt: Date, publishedRevisionId: string) {
    return tx.lesson.updateMany({
      where: { id: lessonId, updatedAt: expectedUpdatedAt },
      data: { status: LessonStatus.PUBLISHED, publishedRevisionId, updatedAt: nextOptimisticTimestamp(expectedUpdatedAt) },
    });
  }

  /** Urgent takedown: PUBLISHED Lesson → ARCHIVED (pointer + revision untouched, §37). */
  archiveLesson(tx: Prisma.TransactionClient, lessonId: string, expectedUpdatedAt: Date) {
    return tx.lesson.updateMany({
      where: { id: lessonId, status: LessonStatus.PUBLISHED, updatedAt: expectedUpdatedAt },
      data: { status: LessonStatus.ARCHIVED, updatedAt: nextOptimisticTimestamp(expectedUpdatedAt) },
    });
  }
}
