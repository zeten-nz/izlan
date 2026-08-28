-- CreateEnum
CREATE TYPE "ContentPolicyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ContentReviewOutcome" AS ENUM ('APPROVED', 'CHANGES_REQUESTED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ContentQualityIssueStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "EvidenceIntegrityOutcome" AS ENUM ('VALID', 'UNDER_REVIEW', 'INVALIDATED', 'QUALIFIED');

-- CreateTable
CREATE TABLE "content_quality_policy_version" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "status" "ContentPolicyStatus" NOT NULL DEFAULT 'DRAFT',
    "config" JSONB NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_quality_policy_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_reference" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "locator" TEXT,
    "metadata" JSONB,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_reference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_source_provenance" (
    "id" UUID NOT NULL,
    "source_reference_id" UUID NOT NULL,
    "roadmap_point_revision_id" UUID,
    "blueprint_revision_id" UUID,
    "lesson_revision_id" UUID,
    "claim_role" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_source_provenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_review" (
    "id" UUID NOT NULL,
    "roadmap_point_revision_id" UUID,
    "blueprint_revision_id" UUID,
    "lesson_revision_id" UUID,
    "assessment_definition_version_id" UUID,
    "policy_version_id" UUID NOT NULL,
    "outcome" "ContentReviewOutcome" NOT NULL,
    "blockers" JSONB,
    "notes" TEXT,
    "reviewed_by" UUID NOT NULL,
    "reviewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_quality_issue" (
    "id" UUID NOT NULL,
    "status" "ContentQualityIssueStatus" NOT NULL DEFAULT 'OPEN',
    "severity_code" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "roadmap_point_revision_id" UUID,
    "activity_id" UUID,
    "assessment_item_id" UUID,
    "lesson_revision_id" UUID,
    "teaching_blueprint_stage_id" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "content_quality_issue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_integrity_decision" (
    "id" UUID NOT NULL,
    "content_quality_issue_id" UUID,
    "outcome" "EvidenceIntegrityOutcome" NOT NULL,
    "policy_version" TEXT NOT NULL,
    "reason_code" TEXT NOT NULL,
    "supersedes_decision_id" UUID,
    "details" JSONB,
    "decided_by" UUID NOT NULL,
    "client_request_id" TEXT,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_integrity_decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_integrity_scope" (
    "id" UUID NOT NULL,
    "decision_id" UUID NOT NULL,
    "scope_kind" TEXT NOT NULL,
    "assessment_item_id" UUID,
    "assessment_version_item_id" UUID,
    "assessment_definition_version_id" UUID,
    "activity_id" UUID,
    "media_asset_id" UUID,
    "lesson_revision_id" UUID,
    "teaching_blueprint_stage_id" UUID,
    "scope_qualifier" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_integrity_scope_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "content_quality_policy_version_code_key" ON "content_quality_policy_version"("code");

-- CreateIndex
CREATE INDEX "source_reference_kind_idx" ON "source_reference"("kind");

-- CreateIndex
CREATE INDEX "content_source_provenance_source_reference_id_idx" ON "content_source_provenance"("source_reference_id");

-- CreateIndex
CREATE INDEX "content_source_provenance_roadmap_point_revision_id_idx" ON "content_source_provenance"("roadmap_point_revision_id");

-- CreateIndex
CREATE INDEX "content_review_roadmap_point_revision_id_idx" ON "content_review"("roadmap_point_revision_id");

-- CreateIndex
CREATE INDEX "content_review_reviewed_at_idx" ON "content_review"("reviewed_at");

-- CreateIndex
CREATE INDEX "content_quality_issue_status_idx" ON "content_quality_issue"("status");

-- CreateIndex
CREATE INDEX "content_quality_issue_roadmap_point_revision_id_idx" ON "content_quality_issue"("roadmap_point_revision_id");

-- CreateIndex
CREATE INDEX "evidence_integrity_decision_decided_at_idx" ON "evidence_integrity_decision"("decided_at");

-- CreateIndex
CREATE INDEX "evidence_integrity_scope_decision_id_idx" ON "evidence_integrity_scope"("decision_id");

-- CreateIndex
CREATE INDEX "evidence_integrity_scope_activity_id_idx" ON "evidence_integrity_scope"("activity_id");

-- CreateIndex
CREATE INDEX "evidence_integrity_scope_assessment_item_id_idx" ON "evidence_integrity_scope"("assessment_item_id");

-- AddForeignKey
ALTER TABLE "content_quality_policy_version" ADD CONSTRAINT "content_quality_policy_version_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_reference" ADD CONSTRAINT "source_reference_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_source_provenance" ADD CONSTRAINT "content_source_provenance_source_reference_id_fkey" FOREIGN KEY ("source_reference_id") REFERENCES "source_reference"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_source_provenance" ADD CONSTRAINT "content_source_provenance_roadmap_point_revision_id_fkey" FOREIGN KEY ("roadmap_point_revision_id") REFERENCES "roadmap_point_revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_source_provenance" ADD CONSTRAINT "content_source_provenance_blueprint_revision_id_fkey" FOREIGN KEY ("blueprint_revision_id") REFERENCES "teaching_blueprint_revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_source_provenance" ADD CONSTRAINT "content_source_provenance_lesson_revision_id_fkey" FOREIGN KEY ("lesson_revision_id") REFERENCES "lesson_revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_source_provenance" ADD CONSTRAINT "content_source_provenance_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_review" ADD CONSTRAINT "content_review_policy_version_id_fkey" FOREIGN KEY ("policy_version_id") REFERENCES "content_quality_policy_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_review" ADD CONSTRAINT "content_review_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_review" ADD CONSTRAINT "content_review_roadmap_point_revision_id_fkey" FOREIGN KEY ("roadmap_point_revision_id") REFERENCES "roadmap_point_revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_review" ADD CONSTRAINT "content_review_blueprint_revision_id_fkey" FOREIGN KEY ("blueprint_revision_id") REFERENCES "teaching_blueprint_revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_review" ADD CONSTRAINT "content_review_lesson_revision_id_fkey" FOREIGN KEY ("lesson_revision_id") REFERENCES "lesson_revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_review" ADD CONSTRAINT "content_review_assessment_definition_version_id_fkey" FOREIGN KEY ("assessment_definition_version_id") REFERENCES "assessment_definition_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_quality_issue" ADD CONSTRAINT "content_quality_issue_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_quality_issue" ADD CONSTRAINT "content_quality_issue_roadmap_point_revision_id_fkey" FOREIGN KEY ("roadmap_point_revision_id") REFERENCES "roadmap_point_revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_quality_issue" ADD CONSTRAINT "content_quality_issue_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_quality_issue" ADD CONSTRAINT "content_quality_issue_assessment_item_id_fkey" FOREIGN KEY ("assessment_item_id") REFERENCES "assessment_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_quality_issue" ADD CONSTRAINT "content_quality_issue_lesson_revision_id_fkey" FOREIGN KEY ("lesson_revision_id") REFERENCES "lesson_revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_quality_issue" ADD CONSTRAINT "content_quality_issue_teaching_blueprint_stage_id_fkey" FOREIGN KEY ("teaching_blueprint_stage_id") REFERENCES "teaching_blueprint_stage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_integrity_decision" ADD CONSTRAINT "evidence_integrity_decision_content_quality_issue_id_fkey" FOREIGN KEY ("content_quality_issue_id") REFERENCES "content_quality_issue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_integrity_decision" ADD CONSTRAINT "evidence_integrity_decision_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_integrity_decision" ADD CONSTRAINT "evidence_integrity_decision_supersedes_decision_id_fkey" FOREIGN KEY ("supersedes_decision_id") REFERENCES "evidence_integrity_decision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_integrity_scope" ADD CONSTRAINT "evidence_integrity_scope_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "evidence_integrity_decision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_integrity_scope" ADD CONSTRAINT "evidence_integrity_scope_assessment_item_id_fkey" FOREIGN KEY ("assessment_item_id") REFERENCES "assessment_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_integrity_scope" ADD CONSTRAINT "evidence_integrity_scope_assessment_version_item_id_fkey" FOREIGN KEY ("assessment_version_item_id") REFERENCES "assessment_version_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_integrity_scope" ADD CONSTRAINT "evidence_integrity_scope_assessment_definition_version_id_fkey" FOREIGN KEY ("assessment_definition_version_id") REFERENCES "assessment_definition_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_integrity_scope" ADD CONSTRAINT "evidence_integrity_scope_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_integrity_scope" ADD CONSTRAINT "evidence_integrity_scope_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_integrity_scope" ADD CONSTRAINT "evidence_integrity_scope_lesson_revision_id_fkey" FOREIGN KEY ("lesson_revision_id") REFERENCES "lesson_revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_integrity_scope" ADD CONSTRAINT "evidence_integrity_scope_teaching_blueprint_stage_id_fkey" FOREIGN KEY ("teaching_blueprint_stage_id") REFERENCES "teaching_blueprint_stage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ============================================================================
-- Custom PostgreSQL constraints (Prisma cannot express) — Content Quality V2 (Wave E)
-- Mirrored into _custom_constraints.reference.sql
-- ============================================================================

-- Non-empty string invariants
ALTER TABLE "content_quality_policy_version" ADD CONSTRAINT "chk_cqpv_code_nonempty" CHECK (length(trim("code")) > 0);
ALTER TABLE "source_reference" ADD CONSTRAINT "chk_source_reference_title_nonempty" CHECK (length(trim("title")) > 0);
ALTER TABLE "evidence_integrity_decision" ADD CONSTRAINT "chk_eid_policy_version_nonempty" CHECK (length(trim("policy_version")) > 0);

-- ContentSourceProvenance: exactly one content-revision target (typed XOR) + dedup source→target
ALTER TABLE "content_source_provenance" ADD CONSTRAINT "chk_content_provenance_target_xor" CHECK ((("roadmap_point_revision_id" IS NOT NULL)::int + ("blueprint_revision_id" IS NOT NULL)::int + ("lesson_revision_id" IS NOT NULL)::int) = 1);
CREATE UNIQUE INDEX "uq_content_provenance_point" ON "content_source_provenance" ("source_reference_id", "roadmap_point_revision_id") WHERE "roadmap_point_revision_id" IS NOT NULL;
CREATE UNIQUE INDEX "uq_content_provenance_blueprint" ON "content_source_provenance" ("source_reference_id", "blueprint_revision_id") WHERE "blueprint_revision_id" IS NOT NULL;
CREATE UNIQUE INDEX "uq_content_provenance_lesson" ON "content_source_provenance" ("source_reference_id", "lesson_revision_id") WHERE "lesson_revision_id" IS NOT NULL;

-- ContentReview: exactly one review target (typed XOR)
ALTER TABLE "content_review" ADD CONSTRAINT "chk_content_review_target_xor" CHECK ((("roadmap_point_revision_id" IS NOT NULL)::int + ("blueprint_revision_id" IS NOT NULL)::int + ("lesson_revision_id" IS NOT NULL)::int + ("assessment_definition_version_id" IS NOT NULL)::int) = 1);

-- ContentQualityIssue: exactly one issue target (typed XOR)
ALTER TABLE "content_quality_issue" ADD CONSTRAINT "chk_content_quality_issue_target_xor" CHECK ((("roadmap_point_revision_id" IS NOT NULL)::int + ("activity_id" IS NOT NULL)::int + ("assessment_item_id" IS NOT NULL)::int + ("lesson_revision_id" IS NOT NULL)::int + ("teaching_blueprint_stage_id" IS NOT NULL)::int) = 1);

-- EvidenceIntegrityDecision: command idempotency (client_request_id)
CREATE UNIQUE INDEX "uq_eid_client_request" ON "evidence_integrity_decision" ("client_request_id") WHERE "client_request_id" IS NOT NULL;

-- EvidenceIntegrityScope: exactly one defective-object target (typed XOR) + per-target dedup (one decision per object)
ALTER TABLE "evidence_integrity_scope" ADD CONSTRAINT "chk_eis_target_xor" CHECK ((("assessment_item_id" IS NOT NULL)::int + ("assessment_version_item_id" IS NOT NULL)::int + ("assessment_definition_version_id" IS NOT NULL)::int + ("activity_id" IS NOT NULL)::int + ("media_asset_id" IS NOT NULL)::int + ("lesson_revision_id" IS NOT NULL)::int + ("teaching_blueprint_stage_id" IS NOT NULL)::int) = 1);
CREATE UNIQUE INDEX "uq_eis_activity" ON "evidence_integrity_scope" ("decision_id", "activity_id") WHERE "activity_id" IS NOT NULL;
CREATE UNIQUE INDEX "uq_eis_assessment_item" ON "evidence_integrity_scope" ("decision_id", "assessment_item_id") WHERE "assessment_item_id" IS NOT NULL;
CREATE UNIQUE INDEX "uq_eis_version_item" ON "evidence_integrity_scope" ("decision_id", "assessment_version_item_id") WHERE "assessment_version_item_id" IS NOT NULL;
CREATE UNIQUE INDEX "uq_eis_def_version" ON "evidence_integrity_scope" ("decision_id", "assessment_definition_version_id") WHERE "assessment_definition_version_id" IS NOT NULL;
CREATE UNIQUE INDEX "uq_eis_media" ON "evidence_integrity_scope" ("decision_id", "media_asset_id") WHERE "media_asset_id" IS NOT NULL;
CREATE UNIQUE INDEX "uq_eis_lesson_revision" ON "evidence_integrity_scope" ("decision_id", "lesson_revision_id") WHERE "lesson_revision_id" IS NOT NULL;
CREATE UNIQUE INDEX "uq_eis_blueprint_stage" ON "evidence_integrity_scope" ("decision_id", "teaching_blueprint_stage_id") WHERE "teaching_blueprint_stage_id" IS NOT NULL;
