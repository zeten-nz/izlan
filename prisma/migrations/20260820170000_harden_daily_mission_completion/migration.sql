-- Phase 2.0B — Daily Mission Foundation: account-level, day-scoped mission completion (TD-136).
-- The 1.3 DailyMissionCompletion was plan-item-based (dailyPlanItemId UNIQUE NOT NULL, loose completionType).
-- 2.0B missions (LEARN_TODAY / MASTERY_TEST_90) are account/day-level, so we add mission identity + local-day +
-- timezone + policy provenance and relax the plan-item link to nullable. Both mission tables inspected: 0 rows
-- in izlan_dev + izlan_test → NOT NULL columns added directly, no backfill. Old migrations untouched.
-- Reference: prisma/migrations/_custom_constraints.reference.sql (DM-DB-01..04).

-- AlterTable (Prisma-managed)
ALTER TABLE "daily_mission_completion" ADD COLUMN     "local_date" DATE NOT NULL,
ADD COLUMN     "mission_code" TEXT NOT NULL,
ADD COLUMN     "policy_version" TEXT NOT NULL,
ADD COLUMN     "timezone_snapshot" TEXT NOT NULL,
ALTER COLUMN "daily_plan_item_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "daily_mission_completion_user_id_local_date_idx" ON "daily_mission_completion"("user_id", "local_date");

-- ── Custom SQL constraints (not Prisma-representable) ──────────────────────────

-- DM-DB-01: one completion per (user, mission code, local day). Partial (WHERE local_date IS NOT NULL) so any
-- future plan-item completion (no local_date) is unaffected. policyVersion NOT in the key (§27) — same mission
-- cannot complete twice on a day after a policy bump.
CREATE UNIQUE INDEX "uq_daily_mission_completion_day"
  ON "daily_mission_completion" ("user_id", "mission_code", "local_date")
  WHERE "local_date" IS NOT NULL;

-- DM-DB-03/04: registry/provenance identifiers non-empty (server-set).
ALTER TABLE "daily_mission_completion" ADD CONSTRAINT "chk_dmc_mission_code_nonempty" CHECK (length(trim("mission_code")) > 0);
ALTER TABLE "daily_mission_completion" ADD CONSTRAINT "chk_dmc_policy_version_nonempty" CHECK (length(trim("policy_version")) > 0);
ALTER TABLE "daily_mission_completion" ADD CONSTRAINT "chk_dmc_timezone_snapshot_nonempty" CHECK (length(trim("timezone_snapshot")) > 0);
