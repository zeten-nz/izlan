import { Injectable, Logger } from '@nestjs/common';
import { RewardConfigurationInvalidError } from '../../common/errors';
import { RewardRepository } from './reward.repository';
import { IZL_SUPPORTED_MISSION_CODES } from './daily-mission-izl.policy';
import { IzlWalletService } from '../wallet/izl-wallet.service';
import { IzlBalance } from '../wallet/izl-balance.engine';

export interface IzlReconcileView extends IzlBalance {
  grantsCreated: number;
}

/**
 * Daily Mission → IZL economic reward (Phase 2.1A). The ONLY RewardGrant + IZLLedgerEntry writer (§85/§91).
 * Materializes real-value IZL from the normalized DailyMissionCompletion authority within the historical
 * SubscriptionCycle's snapshotted policy, under caps + concurrency locking. IZL is downstream of, and independent
 * from, XP — an IZL failure never rolls back the mission/XP (§38, TD-154). Writes no XP / cycle / wallet.
 */
@Injectable()
export class DailyMissionIzlService {
  private readonly logger = new Logger('IzlReward');

  constructor(
    private readonly repo: RewardRepository,
    private readonly wallet: IzlWalletService,
  ) {}

  /** Ensure the IZL grant for one completion (automatic bridge + reconcile). Idempotent; no-op for missing /
   *  cross-code / no-cycle / capped. Server-derived amount/cycle/policy — never the client (§78). */
  async ensureMissionReward(userId: string, completionId: string): Promise<boolean> {
    const completion = await this.repo.missionCompletion(completionId);
    if (!completion) return false;
    if (completion.userId !== userId) throw new RewardConfigurationInvalidError('completion does not belong to user'); // cross-user provenance
    if (!IZL_SUPPORTED_MISSION_CODES.includes(completion.missionCode)) return false; // e.g. LEARN_TODAY → 0 IZL (§4/§58)
    return this.repo.materializeMissionReward(completion);
  }

  /**
   * Repair missing IZL economic postings across ALL history (§40/§41), then rebuild the wallet projection (§44).
   * Deterministic order; per-completion config/integrity errors are skipped so other valid completions still post
   * (§44). Returns the canonical balance triple + grants created. Cap consumption is posting-time (no retroactive
   * rebalance). Does not touch reservation statuses (§45).
   */
  async reconcile(userId: string): Promise<IzlReconcileView> {
    const pending = await this.repo.rewardableCompletionsMissingGrant(userId);
    let grantsCreated = 0;
    for (const c of pending) {
      try {
        if (await this.repo.materializeMissionReward(c)) grantsCreated += 1;
      } catch (e) {
        if (e instanceof RewardConfigurationInvalidError) {
          this.logger.warn(`izl reward skipped for completion ${c.id}: configuration/integrity`); // §44 skip, process others
          continue;
        }
        throw e;
      }
    }
    await this.wallet.tryRecompute(userId); // §44 rebuild wallet projection from canonical ledger + ACTIVE reservations
    return { ...(await this.wallet.getBalances(userId)), grantsCreated }; // canonical triple (source-derived)
  }

  /** Advisory bridge for the mission producer: post IZL for one completion + refresh the wallet projection, never
   *  throwing for transient/config failures (§14/§38 — mission/XP must not roll back). Cross-user misuse surfaces. */
  async tryEnsureMissionReward(userId: string, completionId: string): Promise<void> {
    try {
      const granted = await this.ensureMissionReward(userId, completionId);
      if (granted) await this.wallet.tryRecompute(userId); // §14 refresh wallet after successful economic posting
    } catch (e) {
      if (e instanceof RewardConfigurationInvalidError && e.message.includes('belong to user')) throw e; // provenance error — surface
      this.logger.warn(`izl reward deferred for completion ${completionId}`); // transient/config — reconcile repairs
    }
  }
}
