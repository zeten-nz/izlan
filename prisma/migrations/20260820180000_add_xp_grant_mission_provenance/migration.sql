-- Phase 2.0C-2 — Daily Mission XP Reward: XpGrant provenance closure (TD-140/141/142/143/144)
-- Hardens the accepted XpGrant model (TD-45) as the mission-XP vehicle. RewardGrant (IZL) untouched.

-- AlterTable
ALTER TABLE "xp_grant" ADD COLUMN     "daily_mission_completion_id" UUID,
ADD COLUMN     "policy_version_code" TEXT;

-- AddForeignKey
ALTER TABLE "xp_grant" ADD CONSTRAINT "xp_grant_daily_mission_completion_id_fkey" FOREIGN KEY ("daily_mission_completion_id") REFERENCES "daily_mission_completion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Custom constraints (partialIndexes preview policy-rejected → custom SQL)
-- ============================================================================

-- XP-DB-01: at most ONE XpGrant per mission completion (idempotency / entitlement identity).
-- Policy version is NOT part of uniqueness (a v2 XP policy must not double-pay one historical completion).
CREATE UNIQUE INDEX "uq_xp_grant_mission_completion"
  ON "xp_grant" ("daily_mission_completion_id")
  WHERE "daily_mission_completion_id" IS NOT NULL;

-- XP-DB-03: policy version snapshot must be non-empty when present (mission producer always sets it).
ALTER TABLE "xp_grant" ADD CONSTRAINT "chk_xp_grant_policy_version_nonempty"
  CHECK ("policy_version_code" IS NULL OR btrim("policy_version_code") <> '');

-- XP-DB-04: mission-backed XP is strictly positive. Non-mission rows keep the accepted +/- correction semantics.
ALTER TABLE "xp_grant" ADD CONSTRAINT "chk_xp_grant_mission_amount_positive"
  CHECK ("daily_mission_completion_id" IS NULL OR "amount" > 0);
