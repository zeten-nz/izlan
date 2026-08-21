import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { PoolItem } from '../engine/placement-engine.types';

/**
 * Item access is ALWAYS scoped to the pinned AssessmentDefinitionVersion's membership
 * (AssessmentVersionItem) — TD-83 historical reproducibility (§10/40/51). There is NO global
 * AssessmentItem lookup here: an item outside the attempt's version pool is unreachable.
 *
 * Membership is NOT re-filtered by current item.status: the published version froze its pool,
 * so an item archived later must remain readable to an in-progress/historical attempt (§38/40).
 */
@Injectable()
export class AssessmentItemRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Prisma.TransactionClient): Prisma.TransactionClient {
    return tx ?? this.prisma;
  }

  /** The pinned pool for the engine — {itemId, skillId, effective difficulty}. */
  async listPoolItems(versionId: string, tx?: Prisma.TransactionClient): Promise<PoolItem[]> {
    const rows = await this.db(tx).assessmentVersionItem.findMany({
      where: { versionId },
      select: { itemId: true, difficultyOverride: true, item: { select: { difficulty: true, skillId: true } } },
    });
    return rows.map((r) => ({ itemId: r.itemId, skillId: r.item.skillId, difficulty: r.difficultyOverride ?? r.item.difficulty }));
  }

  /** Full pinned pool rows incl. type + payload — for pre-start pool validation (§23). */
  listPoolItemsForValidation(versionId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).assessmentVersionItem.findMany({
      where: { versionId },
      select: { itemId: true, difficultyOverride: true, item: { select: { type: true, payload: true, skillId: true, difficulty: true } } },
    });
  }

  /**
   * Load an item's type + payload ONLY if it belongs to the given version pool. Returns null
   * when the item is not a member — the engine/scorer never touch out-of-pool items (§11/51).
   */
  async loadItemInVersion(versionId: string, itemId: string, tx?: Prisma.TransactionClient) {
    const member = await this.db(tx).assessmentVersionItem.findUnique({
      where: { versionId_itemId: { versionId, itemId } },
      select: { item: { select: { id: true, type: true, payload: true } } },
    });
    return member?.item ?? null;
  }
}
