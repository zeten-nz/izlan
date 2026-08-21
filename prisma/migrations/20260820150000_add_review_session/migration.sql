-- Phase 1.9B-2 — dedicated Review Session provenance aggregate (TD-125/126/127/128).
-- Closes the Phase 1.9B architecture gap: generic LearningSession is intentionally NOT expanded with
-- review-domain FKs/context. Prisma-managed DDL (generated via migrate diff) + custom SQL constraints.
-- Old migrations untouched. Reference: prisma/migrations/_custom_constraints.reference.sql (RS-DB-01/04).

-- CreateEnum
CREATE TYPE "ReviewSessionStatus" AS ENUM ('ACTIVE', 'COMPLETED');

-- AlterTable — review provenance discriminator (normal execution = NULL)
ALTER TABLE "activity_attempt" ADD COLUMN     "review_session_id" UUID;

-- CreateTable
CREATE TABLE "learner_review_session" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "skill_id" UUID NOT NULL,
    "lesson_id" UUID NOT NULL,
    "lesson_revision_id" UUID NOT NULL,
    "status" "ReviewSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "provenance" JSONB NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learner_review_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learner_review_session_activity" (
    "id" UUID NOT NULL,
    "review_session_id" UUID NOT NULL,
    "activity_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learner_review_session_activity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "learner_review_session_user_id_status_idx" ON "learner_review_session"("user_id", "status");

-- CreateIndex
CREATE INDEX "learner_review_session_activity_review_session_id_idx" ON "learner_review_session_activity"("review_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "learner_review_session_activity_review_session_id_activity__key" ON "learner_review_session_activity"("review_session_id", "activity_id");

-- CreateIndex
CREATE UNIQUE INDEX "learner_review_session_activity_review_session_id_position_key" ON "learner_review_session_activity"("review_session_id", "position");

-- CreateIndex
CREATE INDEX "activity_attempt_review_session_id_idx" ON "activity_attempt"("review_session_id");

-- AddForeignKey
ALTER TABLE "learner_review_session" ADD CONSTRAINT "learner_review_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_review_session" ADD CONSTRAINT "learner_review_session_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_review_session" ADD CONSTRAINT "learner_review_session_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lesson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_review_session" ADD CONSTRAINT "learner_review_session_lesson_revision_id_fkey" FOREIGN KEY ("lesson_revision_id") REFERENCES "lesson_revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_review_session_activity" ADD CONSTRAINT "learner_review_session_activity_review_session_id_fkey" FOREIGN KEY ("review_session_id") REFERENCES "learner_review_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_review_session_activity" ADD CONSTRAINT "learner_review_session_activity_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_attempt" ADD CONSTRAINT "activity_attempt_review_session_id_fkey" FOREIGN KEY ("review_session_id") REFERENCES "learner_review_session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Custom SQL constraints (not Prisma-representable) ──────────────────────────

-- RS-DB-01 (TD-125 §13): at most one ACTIVE review session per (user, skill, lesson). Final concurrency authority.
CREATE UNIQUE INDEX "uq_review_session_active"
  ON "learner_review_session" ("user_id", "skill_id", "lesson_id")
  WHERE "status" = 'ACTIVE';

-- RS-DB-04: selected-activity position is 1-based.
ALTER TABLE "learner_review_session_activity"
  ADD CONSTRAINT "chk_review_session_activity_position_positive" CHECK ("position" > 0);
