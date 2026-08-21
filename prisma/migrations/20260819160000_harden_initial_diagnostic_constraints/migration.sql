-- Phase 1.5B-2 — Initial diagnostic integrity constraints (TD-94, TD-95).
-- Partial UNIQUE indexes: Prisma `partialIndexes` preview is policy-rejected (see PRISMA_SCHEMA_V1),
-- so these live as reviewed custom SQL (like the 11 Phase 1.3 partial uniques). Not representable
-- as `@@unique` in schema.prisma. Reference: prisma/migrations/_custom_constraints.reference.sql.

-- TD-94 (PA-07): at most one PUBLISHED DIAGNOSTIC AssessmentDefinition per subject.
-- Track is assessment context, NOT a definition-selection dimension (subject-level placement, OD/§6).
CREATE UNIQUE INDEX "uq_def_published_diagnostic_per_subject"
  ON "assessment_definition" ("subject_id")
  WHERE "purpose_scope" = 'DIAGNOSTIC' AND "status" = 'PUBLISHED';

-- TD-95 (PA-10): at most one IN_PROGRESS INITIAL_DIAGNOSTIC AssessmentAttempt per (user, subject).
-- Completed attempts are unaffected; REASSESSMENT policy remains OPEN.
CREATE UNIQUE INDEX "uq_attempt_inprogress_initial_diagnostic_user_subject"
  ON "assessment_attempt" ("user_id", "subject_id")
  WHERE "purpose" = 'INITIAL_DIAGNOSTIC' AND "status" = 'IN_PROGRESS';
