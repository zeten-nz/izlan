-- Phase 1.5C-2 — SkillMeasurement derivation identity hardening (TD-97/98).
-- Every measurement must identify the formula/process that produced it. Both DBs verified empty of
-- SkillMeasurement rows before this migration (no backfill, no invented derivation version). Old
-- migrations untouched. Reference: prisma/migrations/_custom_constraints.reference.sql (SP-04/SP-09).

-- derivationVersion is now historical derivation authority → mandatory.
ALTER TABLE "skill_measurement" ALTER COLUMN "derivation_version" SET NOT NULL;

-- SP-09: derivation identity must be a real value (no '' / whitespace-only).
ALTER TABLE "skill_measurement" ADD CONSTRAINT "chk_sm_derivation_version_nonempty" CHECK (length(trim("derivation_version")) > 0);
