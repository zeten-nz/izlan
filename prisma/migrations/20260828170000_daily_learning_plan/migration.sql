-- CreateTable
CREATE TABLE "daily_learning_plan" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "local_date" DATE NOT NULL,
    "timezone_snapshot" TEXT NOT NULL,
    "generation_no" INTEGER NOT NULL,
    "status" "DailyPlanStatus" NOT NULL DEFAULT 'CURRENT',
    "policy_version" TEXT NOT NULL,
    "engine_version" TEXT NOT NULL,
    "main_roadmap_point_id" UUID,
    "decision" JSONB NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_learning_plan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "daily_learning_plan_user_id_subject_id_local_date_idx" ON "daily_learning_plan"("user_id", "subject_id", "local_date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_learning_plan_user_id_subject_id_local_date_generatio_key" ON "daily_learning_plan"("user_id", "subject_id", "local_date", "generation_no");

-- AddForeignKey
ALTER TABLE "daily_learning_plan" ADD CONSTRAINT "daily_learning_plan_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_learning_plan" ADD CONSTRAINT "daily_learning_plan_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_learning_plan" ADD CONSTRAINT "daily_learning_plan_main_roadmap_point_id_fkey" FOREIGN KEY ("main_roadmap_point_id") REFERENCES "roadmap_point"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ============================================================================
-- Custom PostgreSQL constraints (Prisma cannot express) — V2 Daily Learning Plan (Wave F)
-- ============================================================================
CREATE UNIQUE INDEX "ux_current_daily_learning_plan" ON "daily_learning_plan" ("user_id", "subject_id", "local_date") WHERE "status" = 'CURRENT';
ALTER TABLE "daily_learning_plan" ADD CONSTRAINT "chk_dlp_policy_version_nonempty" CHECK (length(trim("policy_version")) > 0);
ALTER TABLE "daily_learning_plan" ADD CONSTRAINT "chk_dlp_engine_version_nonempty" CHECK (length(trim("engine_version")) > 0);
