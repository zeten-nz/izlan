-- Phase 1.7C — lesson-backed SkillMeasurement idempotency (TD-111).
-- The Phase 1.5C index only covers assessment-backed rows (WHERE assessment_attempt_id IS NOT NULL).
-- Lesson-mastery measurements (lesson_id set, assessment_attempt_id null) need their own idempotency.
-- Partial UNIQUE (partialIndexes preview policy-rejected → custom SQL). Old migrations untouched.
-- Reference: prisma/migrations/_custom_constraints.reference.sql (SP-10).

CREATE UNIQUE INDEX "uq_skill_measurement_lesson_idempotency"
  ON "skill_measurement" ("user_id", "lesson_id", "skill_id", "source", "derivation_version")
  WHERE "lesson_id" IS NOT NULL;
