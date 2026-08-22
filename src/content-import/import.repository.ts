import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type { ExistingLesson, ExistingSkill } from './import-validator';

/** Batched read helpers for the importer (avoids N+1). tx-aware so apply reads inside the locked transaction. */
@Injectable()
export class ImportRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Prisma.TransactionClient): Prisma.TransactionClient {
    return (tx ?? this.prisma) as Prisma.TransactionClient;
  }

  /** Existing Lessons among the given contentKeys, with their resolved Subject (contentKey is globally unique). */
  async lessonsByContentKeys(keys: string[], tx?: Prisma.TransactionClient): Promise<ExistingLesson[]> {
    if (keys.length === 0) return [];
    const rows = await this.db(tx).lesson.findMany({
      where: { contentKey: { in: keys } },
      select: { id: true, contentKey: true, status: true, topic: { select: { module: { select: { level: { select: { track: { select: { subjectId: true } } } } } } } } },
    });
    return rows.map((r) => ({ id: r.id, contentKey: r.contentKey, status: r.status, subjectId: r.topic.module.level.track.subjectId }));
  }

  /** All Skills in the Subject (≤200) — for code/name resolution. */
  subjectSkills(subjectId: string, tx?: Prisma.TransactionClient): Promise<ExistingSkill[]> {
    return this.db(tx).skill.findMany({ where: { subjectId }, select: { id: true, code: true, name: true, status: true } });
  }
}
