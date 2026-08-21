import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { PrereqEdge } from './prerequisite-graph';

/**
 * LessonPrerequisite persistence (Phase 2.2A-3). The prerequisite graph is the EXISTING roadmap authority. Graph
 * mutations for a Subject are serialized by locking the Subject row (`SELECT … FOR UPDATE`) inside the transaction —
 * this deterministically prevents two concurrent inverse-edge writers from both committing a cycle (§24).
 */
@Injectable()
export class PrerequisiteRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Prisma.TransactionClient): Prisma.TransactionClient {
    return (tx ?? this.prisma) as Prisma.TransactionClient;
  }

  /** Serialize all prerequisite graph mutations for this Subject: block until the holder's transaction commits. */
  async lockSubject(tx: Prisma.TransactionClient, subjectId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM "subject" WHERE id = ${subjectId}::uuid FOR UPDATE`;
  }

  /** ALL prerequisite edges whose SOURCE Lesson belongs to the Subject (whole-graph, §26) — after the lock. */
  async edgesForSubject(tx: Prisma.TransactionClient, subjectId: string): Promise<PrereqEdge[]> {
    const rows = await tx.lessonPrerequisite.findMany({
      where: { lesson: { topic: { module: { level: { track: { subjectId } } } } } },
      select: { lessonId: true, prerequisiteLessonId: true },
    });
    return rows;
  }

  findEdge(tx: Prisma.TransactionClient, lessonId: string, prerequisiteLessonId: string) {
    return tx.lessonPrerequisite.findUnique({ where: { lessonId_prerequisiteLessonId: { lessonId, prerequisiteLessonId } }, select: { id: true } });
  }
  createEdge(tx: Prisma.TransactionClient, lessonId: string, prerequisiteLessonId: string) {
    return tx.lessonPrerequisite.create({ data: { lessonId, prerequisiteLessonId }, select: { id: true } });
  }
  deleteEdge(tx: Prisma.TransactionClient, lessonId: string, prerequisiteLessonId: string) {
    return tx.lessonPrerequisite.deleteMany({ where: { lessonId, prerequisiteLessonId } });
  }

  /** Prerequisite lessons' safe staff metadata (no learner data), ordered deterministically. */
  listPrerequisites(lessonId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).lessonPrerequisite.findMany({
      where: { lessonId },
      select: { prerequisiteLesson: { select: { id: true, contentKey: true, slug: true, status: true, sortOrder: true, topicId: true } } },
      orderBy: [{ prerequisiteLesson: { sortOrder: 'asc' } }, { prerequisiteLessonId: 'asc' }],
    });
  }
}
