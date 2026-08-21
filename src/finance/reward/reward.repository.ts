import { Injectable } from '@nestjs/common';
import { Prisma, RewardCategory, RewardGrantStatus, LedgerEntryType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { RewardConfigurationInvalidError } from '../../common/errors';
import { evaluateDailyMissionIzl, parseIzlRewardPolicyConfig, IZL_SUPPORTED_MISSION_CODES } from './daily-mission-izl.policy';

export interface MissionCompletionRef {
  id: string;
  userId: string;
  missionCode: string;
  policyVersion: string;
  localDate: Date;
  completedAt: Date;
}

/**
 * IZL economic reward persistence (Phase 2.1A). READS DailyMissionCompletion + historical SubscriptionCycle (cycle
 * snapshots its RewardPolicyVersion) + already-GRANTED RewardGrant cap aggregates. WRITES only RewardGrant +
 * IZLLedgerEntry, ATOMICALLY, under a per-user advisory lock. IZLLedgerEntry is the canonical IZL accounting truth;
 * IZLWallet is NOT written (deferred, §48/§49). Never writes XpGrant / XpBalance / Subscription / cycle (§91).
 */
@Injectable()
export class RewardRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Own mission completion as economic eligibility evidence (own-user verified in the service). */
  missionCompletion(completionId: string): Promise<MissionCompletionRef | null> {
    return this.prisma.dailyMissionCompletion.findUnique({
      where: { id: completionId },
      select: { id: true, userId: true, missionCode: true, policyVersion: true, localDate: true, completedAt: true },
    });
  }

  /** Learner's IZL-supported mission completions with NO reward grant yet (reconcile authority, §40/§41). */
  rewardableCompletionsMissingGrant(userId: string): Promise<MissionCompletionRef[]> {
    return this.prisma.dailyMissionCompletion.findMany({
      where: { userId, missionCode: { in: IZL_SUPPORTED_MISSION_CODES as string[] }, rewardGrants: { none: {} } },
      select: { id: true, userId: true, missionCode: true, policyVersion: true, localDate: true, completedAt: true },
      orderBy: [{ completedAt: 'asc' }, { id: 'asc' }],
    });
  }

  /** Canonical IZL balance = signed SUM over the append-only ledger (§45/§46). Null → 0. */
  async ledgerBalance(userId: string): Promise<number> {
    const agg = await this.prisma.iZLLedgerEntry.aggregate({ where: { userId }, _sum: { amount: true } });
    return agg._sum.amount ?? 0;
  }

  /**
   * Atomically materialize the IZL reward for one completion, if eligible. Under a per-user advisory lock (§29/§69):
   * resolve the historical covering cycle → its snapshotted policy → evaluate → check dedup + fresh caps → post
   * RewardGrant + EARN ledger credit in ONE transaction (§31/§39). Returns true iff a new grant was created.
   * Throws RewardConfigurationInvalidError on integrity/config problems (multiple covering cycles, malformed policy).
   */
  async materializeMissionReward(c: MissionCompletionRef): Promise<boolean> {
    const dedupKey = `daily-mission-izl:${c.id}`; // entitlement identity = completion + IZL producer (§18)
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'izl'}), hashtext(${c.userId}))`; // serialize IZL posting per user (§29)

      const cycles = await tx.subscriptionCycle.findMany({
        where: { subscription: { userId: c.userId }, periodStart: { lte: c.completedAt }, periodEnd: { gt: c.completedAt } }, // start <= t < end (§10)
        select: { id: true, rewardPolicyVersionId: true, rewardCeilingIzl: true, policyVersion: { select: { config: true } } },
      });
      if (cycles.length === 0) return false; // no economic context (§12) — no grant
      if (cycles.length > 1) throw new RewardConfigurationInvalidError('multiple covering subscription cycles'); // integrity (§13)
      const cycle = cycles[0];

      const rewardPolicyVersionId = cycle.rewardPolicyVersionId;
      if (rewardPolicyVersionId === null || cycle.policyVersion === null) return false; // reward-disabled cycle (2.1G-D §14) — no grant, no error (paid access preserved)

      const policy = parseIzlRewardPolicyConfig(cycle.policyVersion.config); // strict; throws on malformed (§8/§44)
      const evaluated = evaluateDailyMissionIzl(c.missionCode, c.policyVersion, policy);
      if (!evaluated.eligible) return false; // unsupported mission / producer version (§4/§60)
      const { amountIzl, dailyCapIzl, cycleCapIzl } = evaluated;
      const effectiveCycleCapIzl = Math.min(cycleCapIzl, cycle.rewardCeilingIzl); // 2.1G-D §15/§17 — cycle economic ceiling is now load-bearing

      const existing = await tx.rewardGrant.findUnique({ where: { userId_dedupKey: { userId: c.userId, dedupKey } }, select: { id: true } });
      if (existing) return false; // already granted for this completion (§30) — replay does not consume cap

      const base = { userId: c.userId, subscriptionCycleId: cycle.id, category: RewardCategory.DAILY_MISSION, status: RewardGrantStatus.GRANTED } as const;
      const [dailyAgg, cycleAgg] = await Promise.all([
        tx.rewardGrant.aggregate({ where: { ...base, missionCompletion: { localDate: c.localDate } }, _sum: { amount: true } }), // §21/§24 per localDate + cycle
        tx.rewardGrant.aggregate({ where: base, _sum: { amount: true } }), // §23 per cycle — GRANTED history is the earning authority (§16)
      ]);
      if ((dailyAgg._sum.amount ?? 0) + amountIzl > dailyCapIzl) return false; // daily cap — all-or-nothing (§25/§26)
      if ((cycleAgg._sum.amount ?? 0) + amountIzl > effectiveCycleCapIzl) return false; // min(policy cap, cycle economic ceiling) (§17/§18)

      const ledgerAgg = await tx.iZLLedgerEntry.aggregate({ where: { userId: c.userId }, _max: { entryNo: true }, _sum: { amount: true } });
      const entryNo = (ledgerAgg._max.entryNo ?? 0) + 1; // wallet-local monotonic (TD-47)
      const balanceAfter = (ledgerAgg._sum.amount ?? 0) + amountIzl;

      try {
        const grant = await tx.rewardGrant.create({
          data: { userId: c.userId, category: RewardCategory.DAILY_MISSION, rewardPolicyVersionId, subscriptionCycleId: cycle.id, amount: amountIzl, dedupKey, missionCompletionId: c.id, status: RewardGrantStatus.GRANTED },
          select: { id: true },
        });
        await tx.iZLLedgerEntry.create({ data: { userId: c.userId, entryNo, entryType: LedgerEntryType.EARN, amount: amountIzl, balanceAfter, rewardGrantId: grant.id, subscriptionCycleId: cycle.id } }); // atomic with the grant (§31)
        return true;
      } catch (e) {
        if (this.isUniqueViolation(e)) return false; // concurrent dedup / entryNo race → the other posting won
        throw e;
      }
    });
  }

  isUniqueViolation(e: unknown): boolean {
    return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
  }
}
