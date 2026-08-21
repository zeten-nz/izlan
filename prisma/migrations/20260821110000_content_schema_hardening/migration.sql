-- Phase 2.2A-D — Content lifecycle / schema hardening (TD-240..245). Exactly two content-schema changes:
--   1. lesson.content_key — immutable stable business/import identity (NOT NULL + globally UNIQUE), staged so the
--      migration is deploy-safe even when the table already contains Lesson rows.
--   2. lesson_prerequisite direct self-loop CHECK (lesson_id <> prerequisite_lesson_id). A row-level CHECK enforces
--      ONLY the self-loop; full multi-node DAG cycle prevention (A->B->C->A) belongs to the future Phase 2.2A authoring
--      service (write-time transactional validation), NOT the database.
-- NO authoring backend / permissions / publish workflow / Activity registry / DAG validation / import in this phase.

-- 1. lesson.content_key — staged: add nullable -> deterministic backfill -> SET NOT NULL -> unique index.
ALTER TABLE "lesson" ADD COLUMN "content_key" TEXT;

-- Deterministic, collision-safe backfill for any pre-existing rows: derived from the immutable Lesson UUID `id`.
-- No dependence on `title` or the mutable `slug`; invents no English/A1 business semantics. New rows supply their own
-- content_key via the future import/authoring layer.
UPDATE "lesson" SET "content_key" = 'legacy-' || "id"::text WHERE "content_key" IS NULL;

ALTER TABLE "lesson" ALTER COLUMN "content_key" SET NOT NULL;

-- Global uniqueness (matches Prisma `@unique` -> index name `lesson_content_key_key`).
CREATE UNIQUE INDEX "lesson_content_key_key" ON "lesson"("content_key");

-- 2. lesson_prerequisite self-loop CHECK (custom SQL; Prisma schema does not model CHECK constraints). Self-loop ONLY.
ALTER TABLE "lesson_prerequisite" ADD CONSTRAINT "chk_lesson_prerequisite_no_self_loop" CHECK ("lesson_id" <> "prerequisite_lesson_id");
