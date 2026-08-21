-- Phase 2.1G-D — Verified payment finalization contract + schema hardening (TD-195/197/198/201).
-- Prepares the inputs for a future Phase 2.1G finalizer. NO finalizer, NO PaymentOrder PAID, NO Subscription/Cycle
-- creation, NO IZL REDEEM producer, NO reservation CONSUMED producer, NO redemption APPLIED producer.

-- PlanPrice immutable commercial billing duration (TD-195). Backfill existing v1 rows = 1 calendar month, then NOT NULL.
ALTER TABLE "plan_price" ADD COLUMN "billing_period_months" INTEGER;
UPDATE "plan_price" SET "billing_period_months" = 1 WHERE "billing_period_months" IS NULL;
ALTER TABLE "plan_price" ALTER COLUMN "billing_period_months" SET NOT NULL;

-- SubscriptionCycle reward config becomes nullable (reward-disabled cycle — paid access must never depend on reward
-- configuration, TD-198). The table is empty (no cycle producer exists yet), so no backfill is needed.
ALTER TABLE "subscription_cycle"
  ALTER COLUMN "reward_policy_version_id" DROP NOT NULL,
  ALTER COLUMN "izl_rate_snapshot" DROP NOT NULL;

-- IZL reservation consumption provenance (TD-201). CONSUMED = ACTIVE hold fulfilled by a REDEEM ledger debit; distinct
-- from RELEASED (freed, no spend). No runtime producer yet — the Phase 2.1G finalizer is the first.
ALTER TYPE "IzlReservationStatus" ADD VALUE 'CONSUMED';

-- ============================================================================
-- Custom constraints (custom SQL)
-- ============================================================================

-- FP-DB-01: PlanPrice billing duration is a positive number of calendar months.
ALTER TABLE "plan_price" ADD CONSTRAINT "chk_plan_price_billing_period_positive" CHECK ("billing_period_months" > 0);

-- FP-DB-02/03: reward-config coherence. Reward-enabled ⟺ policy id + rate present (rate > 0). Reward-disabled ⟺ both
-- NULL AND zero monetary/IZL ceilings. Prevents a fake/zero "rate" masquerading as a real reward-enabled cycle.
ALTER TABLE "subscription_cycle" ADD CONSTRAINT "chk_cycle_reward_config_coherent" CHECK (
  ("reward_policy_version_id" IS NOT NULL AND "izl_rate_snapshot" IS NOT NULL AND "izl_rate_snapshot" > 0)
  OR
  ("reward_policy_version_id" IS NULL AND "izl_rate_snapshot" IS NULL AND "reward_ceiling_uzs" = 0 AND "reward_ceiling_izl" = 0)
);

-- FP-DB-04: at most one REDEEM ledger entry per redemption (one discount debit). Not a global redemption_id UNIQUE —
-- future REVERSAL/ADJUSTMENT audit entries may carry the same redemption provenance.
CREATE UNIQUE INDEX "uq_izl_ledger_redeem_per_redemption"
  ON "izl_ledger_entry" ("redemption_id")
  WHERE "redemption_id" IS NOT NULL AND "entry_type" = 'REDEEM';
