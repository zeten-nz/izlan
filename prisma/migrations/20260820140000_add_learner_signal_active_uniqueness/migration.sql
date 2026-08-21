-- Phase 1.8B — one ACTIVE LearnerSignal per (user, skill, type) invariant (TD-117, LP→SG-01).
-- The accepted model promises one-active-episode semantics but the DB had no protection (only PK +
-- (user_id, status) index). This is the smallest integrity constraint to make the DB the final
-- concurrency authority for signal activation. Table inspected: 0 rows in izlan_dev + izlan_test → safe.
-- Partial (WHERE status = 'ACTIVE') so RESOLVED/EXPIRED episodes remain unconstrained history; NULL skill_id
-- (non-skill-scoped future types) is naturally unconstrained. partialIndexes preview policy-rejected → custom
-- SQL. Old migrations untouched. Reference: prisma/migrations/_custom_constraints.reference.sql (SG-01).

CREATE UNIQUE INDEX "uq_learner_signal_active"
  ON "learner_signal" ("user_id", "skill_id", "type")
  WHERE "status" = 'ACTIVE';
