import { Injectable } from '@nestjs/common';
import { ActivityType, ContentSource, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

/**
 * Activity persistence (Phase 2.2A-2). Concurrency is owned by the parent LessonRevision aggregate (§12), so Activity
 * writes here are plain (the revision token is claimed by the service before calling these). Scoped read flattens
 * `subjectId` and the owning revision's status/updatedAt so the service can enforce scope + DRAFT-only.
 */
@Injectable()
export class ActivityRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Prisma.TransactionClient): Prisma.TransactionClient {
    return (tx ?? this.prisma) as Prisma.TransactionClient;
  }

  create(tx: Prisma.TransactionClient, data: { lessonRevisionId: string; type: ActivityType; position: number; payload: Prisma.InputJsonValue; estimatedDurationMin: number | null }) {
    return tx.activity.create({
      data: { lessonRevisionId: data.lessonRevisionId, type: data.type, position: data.position, payload: data.payload, estimatedDurationMin: data.estimatedDurationMin, source: ContentSource.HUMAN, aiMetadata: Prisma.DbNull },
      select: ACTIVITY_SELECT,
    });
  }

  async findActivityScoped(id: string, tx?: Prisma.TransactionClient) {
    const a = await this.db(tx).activity.findUnique({
      where: { id },
      select: { ...ACTIVITY_SELECT, revision: { select: { id: true, status: true, updatedAt: true, lesson: { select: { topic: { select: { module: { select: { level: { select: { track: { select: { subjectId: true } } } } } } } } } } } } },
    });
    if (!a) return null;
    const { revision, ...rest } = a;
    return { ...rest, revisionId: revision.id, revisionStatus: revision.status, revisionUpdatedAt: revision.updatedAt, subjectId: revision.lesson.topic.module.level.track.subjectId };
  }

  findById(id: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).activity.findUnique({ where: { id }, select: ACTIVITY_SELECT });
  }

  listByRevision(revisionId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).activity.findMany({ where: { lessonRevisionId: revisionId }, select: ACTIVITY_SELECT, orderBy: [{ position: 'asc' }, { id: 'asc' }] });
  }

  /** Ids of the revision's current activities (for reorder exact-set validation). */
  idsForRevision(tx: Prisma.TransactionClient, revisionId: string) {
    return tx.activity.findMany({ where: { lessonRevisionId: revisionId }, select: { id: true } });
  }

  update(tx: Prisma.TransactionClient, id: string, data: Prisma.ActivityUpdateManyMutationInput) {
    return tx.activity.updateMany({ where: { id }, data });
  }

  delete(tx: Prisma.TransactionClient, id: string) {
    return tx.activity.delete({ where: { id }, select: { id: true } });
  }

  setPosition(tx: Prisma.TransactionClient, id: string, position: number) {
    return tx.activity.update({ where: { id }, data: { position }, select: { id: true } });
  }
}

const ACTIVITY_SELECT = {
  id: true, lessonRevisionId: true, type: true, position: true, estimatedDurationMin: true, payload: true, source: true, aiMetadata: true, createdAt: true, updatedAt: true,
} satisfies Prisma.ActivitySelect;
