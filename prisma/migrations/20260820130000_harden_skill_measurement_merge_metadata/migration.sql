-- Phase 1.8A — SkillMeasurement normalized merge metadata (TD-113).
-- Every mergeable milestone permanently stores its evidence-unit count and logical observation time,
-- so the Learning Progress Merge Engine (learning-progress-merge-v1) never has to reconstruct historical
-- evidence from mutable surrounding relations.
--
-- Migration data safety (§5): both izlan_dev and izlan_test skill_measurement tables were inspected and
-- are EMPTY (0 rows) — so NOT NULL columns are added directly with no backfill and no fabricated defaults.
-- If rows had existed, a deterministic per-source backfill would have been required first (or a
-- MIGRATION DATA GAP reported). Old migrations untouched. Reference: _custom_constraints.reference.sql.

ALTER TABLE "skill_measurement" ADD COLUMN "evidence_count" INTEGER NOT NULL;
ALTER TABLE "skill_measurement" ADD COLUMN "observed_at" TIMESTAMP(3) NOT NULL;

-- LP-01: no zero/negative-evidence milestone may exist.
ALTER TABLE "skill_measurement"
  ADD CONSTRAINT "chk_sm_evidence_count_positive" CHECK ("evidence_count" > 0);

-- Prisma-representable index for merge current-window ordering (userId, skillId, observedAt).
CREATE INDEX "skill_measurement_user_id_skill_id_observed_at_idx"
  ON "skill_measurement" ("user_id", "skill_id", "observed_at");
