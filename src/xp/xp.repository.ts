import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { XP_SUPPORTED_MISSION_CODES } from './policy/daily-mission-xp.policy';
import { levelForXp, XP_PROGRESSION_VERSION } from './progression/xp-progression.engine';

export interface MissionCompletionRef {
  id: string;
  userId: string;
  missionCode: string;
  policyVersion: string;
}

/**
 * XP persistence (Phase 2.0C-2). READS DailyMissionCompletion (reward eligibility authority) + aggregates XpGrant.
 * WRITES only append-only XpGrant (mission-provenance rows). Never writes XpBalance / RewardGrant / IZL / mission
 * tables (§46/§79). XpGrant is the current XP source of truth (TD-143).
 */
@Injectable()
export class XpRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Load a mission completion as XP eligibility authority (own-user verified in the service, §21/§23). */
  missionCompletion(completionId: string): Promise<MissionCompletionRef | null> {
    return this.prisma.dailyMissionCompletion.findUnique({
      where: { id: completionId },
      select: { id: true, userId: true, missionCode: true, policyVersion: true },
    });
  }

  /**
   * Append-only mission Xp grant, idempotent. The partial unique (XP-DB-01) on daily_mission_completion_id is the
   * concurrency authority — a duplicate returns false (one XP grant per mission completion; §8/§56/§57).
   */
  async createMissionXpGrant(data: { userId: string; amount: number; reasonCode: string; policyVersionCode: string; dailyMissionCompletionId: string }): Promise<boolean> {
    try {
      await this.prisma.xpGrant.create({
        data: { userId: data.userId, amount: data.amount, reasonCode: data.reasonCode, policyVersionCode: data.policyVersionCode, dailyMissionCompletionId: data.dailyMissionCompletionId },
        select: { id: true },
      });
      return true;
    } catch (e) {
      if (this.isUniqueViolation(e)) return false; // already granted for this completion
      throw e;
    }
  }

  /** Current total XP = SUM over the full append-only XpGrant history (incl. corrections, §30/§31). Null → 0. */
  async totalXp(userId: string): Promise<number> {
    const agg = await this.prisma.xpGrant.aggregate({ where: { userId }, _sum: { amount: true } });
    return agg._sum.amount ?? 0;
  }

  /**
   * The learner's supported mission completions that have NO mission XP grant yet (reconcile authority, §37).
   * Batched relation query (no ActivityAttempt scan, no N+1); deterministic order (§38).
   */
  rewardableCompletionsMissingXp(userId: string): Promise<MissionCompletionRef[]> {
    return this.prisma.dailyMissionCompletion.findMany({
      where: { userId, missionCode: { in: XP_SUPPORTED_MISSION_CODES as string[] }, xpGrants: { none: {} } },
      select: { id: true, userId: true, missionCode: true, policyVersion: true },
      orderBy: [{ completedAt: 'asc' }, { id: 'asc' }],
    });
  }

  /**
   * Rebuild the XpBalance projection from the COMPLETE XpGrant history (Phase 2.0D, §18). Full recompute (never
   * incremental balance += amount) so signed corrections / imports / prior drift all reconcile. Per-user advisory
   * lock serializes concurrent recomputes (§48) — each reads a fresh SUM inside the lock, so the cache converges to
   * the canonical total. XpGrant is authority; repair direction is always XpGrant → XpBalance (§13).
   */
  async recomputeProjection(userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'xp'}), hashtext(${userId}))`; // serialize per user (§48)
      const agg = await tx.xpGrant.aggregate({ where: { userId }, _sum: { amount: true } });
      const total = agg._sum.amount ?? 0; // signed canonical total (§7)
      const level = levelForXp(Math.max(total, 0)); // progression clamps negative to 0 (§7); level >= 1
      await tx.xpBalance.upsert({
        where: { userId },
        create: { userId, totalXp: total, currentLevel: level, progressionVersionCode: XP_PROGRESSION_VERSION },
        update: { totalXp: total, currentLevel: level, progressionVersionCode: XP_PROGRESSION_VERSION },
      });
    });
  }

  isUniqueViolation(e: unknown): boolean {
    return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
  }
}
