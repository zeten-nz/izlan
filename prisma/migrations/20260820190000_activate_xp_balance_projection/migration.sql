-- Phase 2.0D — XP Progression Foundation: activate XpBalance as a rebuildable projection (TD-145/146).
-- XpGrant remains the XP source of truth. XpBalance is a mutable cache; repair direction is always XpGrant → XpBalance.

-- AlterTable
ALTER TABLE "xp_balance" ADD COLUMN     "progression_version_code" TEXT,
ALTER COLUMN "current_level" SET DEFAULT 1;

-- ============================================================================
-- Custom constraints (custom SQL)
-- ============================================================================

-- XPP-DB-01: projection version snapshot must be non-empty when present (the projector always sets xp-progression-v1).
ALTER TABLE "xp_balance" ADD CONSTRAINT "chk_xp_balance_progression_version_nonempty"
  CHECK ("progression_version_code" IS NULL OR btrim("progression_version_code") <> '');

-- XPP-DB-02: level floor is 1 (there is no Level 0). progressionXp = max(totalXp, 0) → level >= 1.
ALTER TABLE "xp_balance" ADD CONSTRAINT "chk_xp_balance_current_level_min"
  CHECK ("current_level" >= 1);
