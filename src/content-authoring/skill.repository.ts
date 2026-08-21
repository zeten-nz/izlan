import { Injectable } from '@nestjs/common';
import { Prisma, SkillStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { nextOptimisticTimestamp } from './optimistic-concurrency';

/**
 * Skill persistence (Phase 2.2A-3). Skills are Subject-scoped; no hard delete / merge / archive in this phase.
 * The conditional update guards `status = ACTIVE` and strictly advances the OCC token (`updatedAt`).
 */
@Injectable()
export class SkillRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Prisma.TransactionClient): Prisma.TransactionClient {
    return (tx ?? this.prisma) as Prisma.TransactionClient;
  }

  createSkill(tx: Prisma.TransactionClient, data: { subjectId: string; name: string; code: string | null; description: string | null; sortOrder: number }) {
    return tx.skill.create({ data, select: SKILL_SELECT });
  }

  findById(id: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).skill.findUnique({ where: { id }, select: SKILL_SELECT });
  }

  listBySubject(subjectId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).skill.findMany({ where: { subjectId }, select: SKILL_SELECT, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
  }

  updateSkillConditional(tx: Prisma.TransactionClient, id: string, expectedUpdatedAt: Date, data: Prisma.SkillUpdateManyMutationInput) {
    return tx.skill.updateMany({ where: { id, updatedAt: expectedUpdatedAt, status: SkillStatus.ACTIVE }, data: { ...data, updatedAt: nextOptimisticTimestamp(expectedUpdatedAt) } });
  }
}

const SKILL_SELECT = { id: true, subjectId: true, name: true, code: true, description: true, status: true, sortOrder: true, createdAt: true, updatedAt: true } satisfies Prisma.SkillSelect;
