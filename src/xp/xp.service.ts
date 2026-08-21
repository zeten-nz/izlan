import { Injectable, Logger } from '@nestjs/common';
import { XpRewardConfigurationInvalidError } from '../common/errors';
import { XpRepository } from './xp.repository';
import { evaluateDailyMissionXp } from './policy/daily-mission-xp.policy';
import { computeXpProgression, XpProgression } from './progression/xp-progression.engine';

export type XpProgressionView = XpProgression;
export interface XpReconcileView extends XpProgression {
  grantsCreated: number;
}

/**
 * XP accounting + progression (Phase 2.0C-2 / 2.0D). The ONLY XpGrant + XpBalance writer (TD-141/146). XpGrant is
 * the XP source of truth; XpBalance is a rebuildable projection. Learner-facing reads derive canonical progression
 * from SUM(XpGrant.amount) via the pure engine (never trust the cache, §26). Projection failures never roll back a
 * grant (§21, TD-148). Never writes RewardGrant / IZL (§77).
 */
@Injectable()
export class XpService {
  private readonly logger = new Logger('Xp');

  constructor(private readonly repo: XpRepository) {}

  /**
   * Ensure the mission XP grant for one completion exists (automatic bridge + reconcile). Idempotent: replay /
   * concurrency converge to one grant. No-op for a missing/unsupported completion. Server derives amount/reason/
   * policy — never the client. Projection is refreshed separately (§20) so the grant never depends on cache success.
   */
  async ensureMissionXpGranted(userId: string, completionId: string): Promise<void> {
    const completion = await this.repo.missionCompletion(completionId);
    if (!completion) return;
    if (completion.userId !== userId) throw new XpRewardConfigurationInvalidError('completion does not belong to user'); // cross-user provenance

    const policy = evaluateDailyMissionXp({ missionCode: completion.missionCode, missionPolicyVersion: completion.policyVersion });
    if (!policy.eligible) return; // unsupported mission code / producer version → no grant

    await this.repo.createMissionXpGrant({ userId: completion.userId, amount: policy.amount, reasonCode: policy.reasonCode, policyVersionCode: policy.policyVersionCode, dailyMissionCompletionId: completion.id });
  }

  /** Canonical learner progression derived from SUM(XpGrant.amount) via xp-progression-v1 (§25/§26). Read-only —
   *  never writes/repairs XpBalance (§27); stays correct even if the cache is stale/missing. */
  async getProgression(userId: string): Promise<XpProgressionView> {
    const total = await this.repo.totalXp(userId);
    return computeXpProgression(total);
  }

  /** Rebuild XpBalance from the full XpGrant history (§18). Best-effort at call sites via {@link tryRecomputeProjection}. */
  async recomputeProjection(userId: string): Promise<void> {
    await this.repo.recomputeProjection(userId);
  }

  /** Downstream projection refresh that never throws (§21 — an XpGrant/mission must not roll back on cache failure). */
  async tryRecomputeProjection(userId: string): Promise<void> {
    try {
      await this.repo.recomputeProjection(userId);
    } catch {
      this.logger.warn(`xp projection recompute deferred for user ${userId}`); // reconcile/next grant repairs it
    }
  }

  /**
   * Repair missing mission XP across ALL history (§36), then rebuild the projection (§23). Deterministic order;
   * unsupported completions skipped (§39). Returns canonical progression (derived from SUM, not the cache) + the
   * number of grants created. A projection failure does not fail the returned canonical values (§60).
   */
  async reconcile(userId: string): Promise<XpReconcileView> {
    const pending = await this.repo.rewardableCompletionsMissingXp(userId);
    let grantsCreated = 0;
    for (const c of pending) {
      const policy = evaluateDailyMissionXp({ missionCode: c.missionCode, missionPolicyVersion: c.policyVersion });
      if (!policy.eligible) continue;
      const created = await this.repo.createMissionXpGrant({ userId: c.userId, amount: policy.amount, reasonCode: policy.reasonCode, policyVersionCode: policy.policyVersionCode, dailyMissionCompletionId: c.id });
      if (created) grantsCreated += 1;
    }
    await this.tryRecomputeProjection(userId); // §23 rebuild projection (best-effort)
    const total = await this.repo.totalXp(userId);
    return { ...computeXpProgression(total), grantsCreated };
  }

  /** Advisory bridge for the mission producer: grant XP for one completion, never throwing for transient failures
   *  (§27 — mission completion must not roll back). Cross-user misuse still surfaces. */
  async tryEnsureMissionXpGranted(userId: string, completionId: string): Promise<void> {
    try {
      await this.ensureMissionXpGranted(userId, completionId);
    } catch (e) {
      if (e instanceof XpRewardConfigurationInvalidError) throw e;
      this.logger.warn(`mission xp grant deferred for completion ${completionId}`);
    }
  }
}
