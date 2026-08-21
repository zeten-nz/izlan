-- Phase 1.5C — SkillMeasurement derivation version + assessment-backed idempotency (TD-97/98).
-- Column is Prisma-representable; the partial UNIQUE is custom SQL (partialIndexes preview policy-rejected).
-- Old migrations untouched. Reference: prisma/migrations/_custom_constraints.reference.sql.

ALTER TABLE "skill_measurement" ADD COLUMN "derivation_version" TEXT;

-- SP-04: assessment-backed measurement idempotency — one row per (attempt, skill, source, derivationVersion).
-- Partial (WHERE assessment_attempt_id IS NOT NULL) so lesson/other measurements are unaffected.
-- derivationVersion participates so a future formula (skill-profile-diagnostic-v2 / ENGINE_RECALC) can add a
-- new historical row without colliding (§19).
CREATE UNIQUE INDEX "uq_skill_measurement_assessment_idempotency"
  ON "skill_measurement" ("assessment_attempt_id", "skill_id", "source", "derivation_version")
  WHERE "assessment_attempt_id" IS NOT NULL;
