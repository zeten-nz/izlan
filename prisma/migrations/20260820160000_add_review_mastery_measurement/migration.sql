-- Phase 1.9C — REVIEW_MASTERY SkillMeasurement source + review provenance (TD-129/130).
-- Normalized completed-review evidence enters current state via learning-progress-merge-v2 (incremental, not
-- anchor). Existing SkillMeasurement rows keep review_session_id = NULL (normal, no backfill, §56).
-- Old migrations untouched. Reference: prisma/migrations/_custom_constraints.reference.sql (RM-DB-02).

-- AlterEnum — ADD VALUE only (existing values unchanged/not reordered, §57). Not used in this transaction.
ALTER TYPE "SkillMeasurementSource" ADD VALUE 'REVIEW_MASTERY';

-- AlterTable — review provenance (TD-130 §3).
ALTER TABLE "skill_measurement" ADD COLUMN     "review_session_id" UUID;

-- CreateIndex
CREATE INDEX "skill_measurement_review_session_id_idx" ON "skill_measurement"("review_session_id");

-- AddForeignKey — history-safe Restrict (§55).
ALTER TABLE "skill_measurement" ADD CONSTRAINT "skill_measurement_review_session_id_fkey" FOREIGN KEY ("review_session_id") REFERENCES "learner_review_session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Custom SQL constraint (not Prisma-representable) ──────────────────────────

-- RM-DB-02 (TD-130 §5): one review-backed measurement per (reviewSession, skill, source, derivationVersion).
-- Partial (WHERE review_session_id IS NOT NULL) so non-review measurements are unaffected; derivationVersion
-- participates so review-mastery-v2 can add a new historical row without colliding.
CREATE UNIQUE INDEX "uq_skill_measurement_review_idempotency"
  ON "skill_measurement" ("review_session_id", "skill_id", "source", "derivation_version")
  WHERE "review_session_id" IS NOT NULL;
