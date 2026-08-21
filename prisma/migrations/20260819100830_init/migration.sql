-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "ContainerStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "LessonStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RevisionStatus" AS ENUM ('DRAFT', 'REVIEW', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SkillStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('TEXT', 'EXPLANATION', 'IMAGE', 'AUDIO', 'EXAMPLE', 'MINI_QUESTION', 'PRACTICE', 'SPEAKING', 'WRITING', 'LISTENING', 'AI_INTERACTION', 'MASTERY_TEST', 'VIDEO');

-- CreateEnum
CREATE TYPE "ContentSource" AS ENUM ('HUMAN', 'AI_GENERATED', 'AI_ASSISTED');

-- CreateEnum
CREATE TYPE "MediaProcessingStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "MediaModerationStatus" AS ENUM ('UNREVIEWED', 'APPROVED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "AssessmentPurposeScope" AS ENUM ('DIAGNOSTIC', 'CHECKPOINT');

-- CreateEnum
CREATE TYPE "AssessmentAttemptPurpose" AS ENUM ('INITIAL_DIAGNOSTIC', 'CHECKPOINT', 'REASSESSMENT');

-- CreateEnum
CREATE TYPE "AssessmentAttemptStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "AssessmentResponseStatus" AS ENUM ('PRESENTED', 'DRAFT', 'SUBMITTED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ActivityAttemptStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED', 'EVALUATED');

-- CreateEnum
CREATE TYPE "AiEvaluationStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "SkillMeasurementSource" AS ENUM ('DIAGNOSTIC', 'CHECKPOINT', 'LESSON_MASTERY', 'AI_EVALUATION', 'ENGINE_RECALC');

-- CreateEnum
CREATE TYPE "LearningSessionStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "LessonProgressStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "RoadmapStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RoadmapItemType" AS ENUM ('LESSON', 'REVIEW', 'PRACTICE', 'CHECKPOINT');

-- CreateEnum
CREATE TYPE "RoadmapItemStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "RoadmapItemSource" AS ENUM ('INITIAL_GENERATION', 'RECOMMENDATION', 'SYSTEM');

-- CreateEnum
CREATE TYPE "RecommendationType" AS ENUM ('ROADMAP_ADJUSTMENT', 'REVIEW_SUGGESTION', 'SCHEDULE_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "RecommendationSource" AS ENUM ('AI_TUTOR', 'SYSTEM_RULE');

-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SignalStatus" AS ENUM ('ACTIVE', 'RESOLVED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "DailyPlanStatus" AS ENUM ('CURRENT', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "DailyPlanSection" AS ENUM ('MUST_DO', 'RECOMMENDED', 'EXTRA');

-- CreateEnum
CREATE TYPE "DailyPlanItemType" AS ENUM ('LESSON', 'REVIEW', 'PRACTICE', 'MISSION', 'COMMUNITY', 'OTHER');

-- CreateEnum
CREATE TYPE "DailyPlanItemStatus" AS ENUM ('PENDING', 'COMPLETED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "WeeklyProgressStatus" AS ENUM ('IN_PROGRESS', 'MET', 'MISSED');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('EARN', 'REDEEM', 'ADJUSTMENT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "RewardCategory" AS ENUM ('LEARNING_SESSION', 'LESSON_ATTENTION', 'MASTERY', 'DAILY_MISSION');

-- CreateEnum
CREATE TYPE "RewardGrantStatus" AS ENUM ('GRANTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "PolicyVersionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RateVersionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RedemptionType" AS ENUM ('SUBSCRIPTION_DISCOUNT');

-- CreateEnum
CREATE TYPE "RedemptionStatus" AS ENUM ('REQUESTED', 'RESERVED', 'APPLIED', 'RELEASED');

-- CreateEnum
CREATE TYPE "SubscriptionPlanStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EntitlementMode" AS ENUM ('DISABLED', 'ENABLED', 'LIMITED', 'UNLIMITED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SubscriptionCycleStatus" AS ENUM ('ACTIVE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('CLICK', 'PAYME');

-- CreateEnum
CREATE TYPE "PaymentOrderPurpose" AS ENUM ('SUBSCRIPTION_PURCHASE', 'SUBSCRIPTION_RENEWAL');

-- CreateEnum
CREATE TYPE "PaymentOrderStatus" AS ENUM ('CREATED', 'PENDING', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentTransactionStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "CommunityPostType" AS ENUM ('QUESTION', 'LEARNED', 'EXPLANATION', 'DISCUSSION', 'OTHER');

-- CreateEnum
CREATE TYPE "CommunityVisibility" AS ENUM ('VISIBLE', 'AUTHOR_REMOVED', 'MODERATOR_HIDDEN');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'ACTIONED', 'DISMISSED');

-- CreateTable
CREATE TABLE "community_post" (
    "id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "type" "CommunityPostType" NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "subject_id" UUID,
    "topic_id" UUID,
    "visibility" "CommunityVisibility" NOT NULL DEFAULT 'VISIBLE',
    "accepted_reply_id" UUID,
    "reply_count" INTEGER NOT NULL DEFAULT 0,
    "reaction_count" INTEGER NOT NULL DEFAULT 0,
    "edited_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_reply" (
    "id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "visibility" "CommunityVisibility" NOT NULL DEFAULT 'VISIBLE',
    "edited_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_reply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reaction_type" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reaction_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_reaction" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "post_id" UUID,
    "reply_id" UUID,
    "reaction_type_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_reaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_post_media" (
    "id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "media_asset_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_post_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_report" (
    "id" UUID NOT NULL,
    "reporter_user_id" UUID NOT NULL,
    "post_id" UUID,
    "reply_id" UUID,
    "category_code" TEXT NOT NULL,
    "free_text" TEXT,
    "content_snapshot" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "resolved_by" UUID,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moderation_action" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "action_type" TEXT NOT NULL,
    "post_id" UUID,
    "reply_id" UUID,
    "target_user_id" UUID,
    "report_id" UUID,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_action_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_restriction" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "created_by" UUID NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "revoked_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_restriction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reputation_balance" (
    "user_id" UUID NOT NULL,
    "total" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reputation_balance_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "reputation_event" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason_code" TEXT NOT NULL,
    "dedup_key" TEXT NOT NULL,
    "post_id" UUID,
    "reply_id" UUID,
    "reaction_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reputation_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcement" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "ContainerStatus" NOT NULL DEFAULT 'DRAFT',
    "publish_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "audience_type" TEXT NOT NULL DEFAULT 'ALL',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcement_user_state" (
    "id" UUID NOT NULL,
    "announcement_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "read_at" TIMESTAMP(3),
    "dismissed_at" TIMESTAMP(3),

    CONSTRAINT "announcement_user_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "source_type" TEXT,
    "source_id" UUID,
    "params" JSONB,
    "dedup_key" TEXT NOT NULL,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subject" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "ContainerStatus" NOT NULL DEFAULT 'DRAFT',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "track" (
    "id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "ContainerStatus" NOT NULL DEFAULT 'DRAFT',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "track_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "level" (
    "id" UUID NOT NULL,
    "track_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "status" "ContainerStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "level_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "module" (
    "id" UUID NOT NULL,
    "level_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL,
    "status" "ContainerStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "module_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topic" (
    "id" UUID NOT NULL,
    "module_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL,
    "status" "ContainerStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson" (
    "id" UUID NOT NULL,
    "topic_id" UUID NOT NULL,
    "slug" TEXT,
    "sort_order" INTEGER NOT NULL,
    "status" "LessonStatus" NOT NULL DEFAULT 'DRAFT',
    "published_revision_id" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_revision" (
    "id" UUID NOT NULL,
    "lesson_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "estimated_duration_min" INTEGER,
    "status" "RevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by" UUID NOT NULL,
    "updated_by" UUID,
    "reviewed_by" UUID,
    "published_by" UUID,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lesson_revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity" (
    "id" UUID NOT NULL,
    "lesson_revision_id" UUID NOT NULL,
    "type" "ActivityType" NOT NULL,
    "position" INTEGER NOT NULL,
    "estimated_duration_min" INTEGER,
    "payload" JSONB NOT NULL,
    "source" "ContentSource" NOT NULL DEFAULT 'HUMAN',
    "ai_metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_media" (
    "id" UUID NOT NULL,
    "activity_id" UUID NOT NULL,
    "media_asset_id" UUID NOT NULL,
    "role_code" TEXT,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill" (
    "id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "SkillStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_skill" (
    "id" UUID NOT NULL,
    "lesson_id" UUID NOT NULL,
    "skill_id" UUID NOT NULL,

    CONSTRAINT "lesson_skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_skill" (
    "id" UUID NOT NULL,
    "activity_id" UUID NOT NULL,
    "skill_id" UUID NOT NULL,

    CONSTRAINT "activity_skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_prerequisite" (
    "id" UUID NOT NULL,
    "lesson_id" UUID NOT NULL,
    "prerequisite_lesson_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lesson_prerequisite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_user" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profile" (
    "user_id" UUID NOT NULL,
    "display_name" TEXT,
    "date_of_birth" DATE,
    "onboarding_completed_at" TIMESTAMP(3),
    "preferred_language" TEXT,
    "timezone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_profile_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "role" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_role" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "granted_by" UUID,

    CONSTRAINT "user_role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permission" (
    "id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "permission_code" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subject_assignment" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_by" UUID,

    CONSTRAINT "subject_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_session" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "platform" TEXT NOT NULL,
    "client_info" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_activity" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" TEXT,

    CONSTRAINT "auth_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_token" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "replaced_by_id" UUID,

    CONSTRAINT "refresh_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_challenge" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMP(3),
    "invalidated_at" TIMESTAMP(3),
    "request_ip" TEXT,

    CONSTRAINT "otp_challenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_event" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "user_id" UUID,
    "session_id" UUID,
    "ip" TEXT,
    "client_info" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_audit" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "action_code" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" UUID,
    "reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_asset" (
    "id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "duration_seconds" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "uploaded_by" UUID NOT NULL,
    "processing_status" "MediaProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "moderation_status" "MediaModerationStatus" NOT NULL DEFAULT 'UNREVIEWED',
    "moderation_metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "xp_balance" (
    "user_id" UUID NOT NULL,
    "total_xp" INTEGER NOT NULL DEFAULT 0,
    "current_level" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "xp_balance_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "xp_grant" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason_code" TEXT NOT NULL,
    "source_refs" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "xp_grant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "izl_wallet" (
    "user_id" UUID NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "reserved_amount" INTEGER NOT NULL DEFAULT 0,
    "last_entry_no" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "izl_wallet_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "izl_ledger_entry" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "entry_no" INTEGER NOT NULL,
    "entry_type" "LedgerEntryType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "reward_grant_id" UUID,
    "redemption_id" UUID,
    "subscription_cycle_id" UUID,
    "reversal_of_entry_id" UUID,
    "reason" TEXT,
    "actor_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "izl_ledger_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_grant" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "category" "RewardCategory" NOT NULL,
    "reward_policy_version_id" UUID NOT NULL,
    "subscription_cycle_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "dedup_key" TEXT NOT NULL,
    "activity_attempt_id" UUID,
    "learning_session_id" UUID,
    "daily_mission_completion_id" UUID,
    "status" "RewardGrantStatus" NOT NULL DEFAULT 'GRANTED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reward_grant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_policy_version" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "PolicyVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "config" JSONB NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reward_policy_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "izl_rate_version" (
    "id" UUID NOT NULL,
    "rate_uzs_per_izl" INTEGER NOT NULL,
    "status" "RateVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "effective_from" TIMESTAMP(3) NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "izl_rate_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "izl_redemption" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "RedemptionType" NOT NULL DEFAULT 'SUBSCRIPTION_DISCOUNT',
    "amount_izl" INTEGER NOT NULL,
    "izl_rate_snapshot" INTEGER NOT NULL,
    "value_uzs" INTEGER NOT NULL,
    "payment_order_id" UUID,
    "status" "RedemptionStatus" NOT NULL DEFAULT 'REQUESTED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "izl_redemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_plan" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "SubscriptionPlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_price" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'UZS',
    "amount" INTEGER NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_price_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_entitlement" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "feature_code" TEXT NOT NULL,
    "mode" "EntitlementMode" NOT NULL,
    "limit_value" INTEGER,

    CONSTRAINT "plan_entitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "current_cycle_id" UUID,
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_cycle" (
    "id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "sequence_no" INTEGER NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "plan_id" UUID NOT NULL,
    "plan_price_id" UUID NOT NULL,
    "gross_price_uzs" INTEGER NOT NULL,
    "discount_uzs" INTEGER NOT NULL DEFAULT 0,
    "paid_amount_uzs" INTEGER NOT NULL,
    "reward_basis_uzs" INTEGER NOT NULL,
    "reward_ceiling_uzs" INTEGER NOT NULL,
    "reward_policy_version_id" UUID NOT NULL,
    "izl_rate_snapshot" INTEGER NOT NULL,
    "reward_ceiling_izl" INTEGER NOT NULL,
    "earned_izl" INTEGER NOT NULL DEFAULT 0,
    "payment_order_id" UUID,
    "status" "SubscriptionCycleStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_cycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_cycle_entitlement" (
    "id" UUID NOT NULL,
    "subscription_cycle_id" UUID NOT NULL,
    "feature_code" TEXT NOT NULL,
    "mode" "EntitlementMode" NOT NULL,
    "limit_value" INTEGER,

    CONSTRAINT "subscription_cycle_entitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_change" (
    "id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "from_plan_id" UUID,
    "to_plan_id" UUID,
    "change_type" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_change_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_counter" (
    "id" UUID NOT NULL,
    "subscription_cycle_id" UUID NOT NULL,
    "feature_code" TEXT NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usage_counter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_order" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" "PaymentOrderPurpose" NOT NULL,
    "subscription_id" UUID,
    "plan_id" UUID NOT NULL,
    "plan_price_id" UUID NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'UZS',
    "gross_amount" INTEGER NOT NULL,
    "izl_discount_amount" INTEGER NOT NULL DEFAULT 0,
    "izl_redemption_id" UUID,
    "payable_amount" INTEGER NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "status" "PaymentOrderStatus" NOT NULL DEFAULT 'CREATED',
    "client_request_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "payment_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_transaction" (
    "id" UUID NOT NULL,
    "payment_order_id" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "provider_transaction_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "PaymentTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "provider_metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),

    CONSTRAINT "payment_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_callback_event" (
    "id" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "payment_transaction_id" UUID,
    "result" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "payment_callback_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_definition" (
    "id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "purpose_scope" "AssessmentPurposeScope" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "ContainerStatus" NOT NULL DEFAULT 'DRAFT',
    "current_version_id" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessment_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_definition_version" (
    "id" UUID NOT NULL,
    "assessment_definition_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "status" "RevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by" UUID NOT NULL,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessment_definition_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_item" (
    "id" UUID NOT NULL,
    "assessment_definition_id" UUID NOT NULL,
    "type" "ActivityType" NOT NULL,
    "payload" JSONB NOT NULL,
    "skill_id" UUID NOT NULL,
    "difficulty" INTEGER NOT NULL,
    "status" "RevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "source" "ContentSource" NOT NULL DEFAULT 'HUMAN',
    "ai_metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessment_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_version_item" (
    "id" UUID NOT NULL,
    "assessment_definition_version_id" UUID NOT NULL,
    "assessment_item_id" UUID NOT NULL,
    "ordering_override" INTEGER,
    "difficulty_override" INTEGER,

    CONSTRAINT "assessment_version_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_item_media" (
    "id" UUID NOT NULL,
    "assessment_item_id" UUID NOT NULL,
    "media_asset_id" UUID NOT NULL,
    "role_code" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_item_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_attempt" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "assessment_definition_id" UUID NOT NULL,
    "assessment_definition_version_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "track_id" UUID,
    "checkpoint_id" UUID,
    "purpose" "AssessmentAttemptPurpose" NOT NULL,
    "status" "AssessmentAttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "engine_state" JSONB,
    "engine_version" TEXT,
    "result_summary" JSONB,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessment_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_response" (
    "id" UUID NOT NULL,
    "attempt_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "sequence_no" INTEGER NOT NULL,
    "answer" JSONB,
    "response_media_asset_id" UUID,
    "status" "AssessmentResponseStatus" NOT NULL DEFAULT 'PRESENTED',
    "is_correct" BOOLEAN,
    "deterministic_score" INTEGER,
    "response_time_ms" INTEGER,
    "presented_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMP(3),

    CONSTRAINT "assessment_response_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_evaluation" (
    "id" UUID NOT NULL,
    "assessment_response_id" UUID,
    "activity_attempt_id" UUID,
    "status" "AiEvaluationStatus" NOT NULL DEFAULT 'PENDING',
    "score" INTEGER,
    "rubric" JSONB,
    "feedback" TEXT,
    "provider_metadata" JSONB,
    "evaluation_version" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "ai_evaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learner_skill_state" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "skill_id" UUID NOT NULL,
    "mastery_score_bp" INTEGER NOT NULL,
    "confidence_bp" INTEGER,
    "evidence_count" INTEGER NOT NULL DEFAULT 0,
    "display_level" TEXT,
    "last_measurement_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learner_skill_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_measurement" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "skill_id" UUID NOT NULL,
    "source" "SkillMeasurementSource" NOT NULL,
    "assessment_attempt_id" UUID,
    "lesson_id" UUID,
    "score_bp" INTEGER NOT NULL,
    "display_level" TEXT,
    "confidence_bp" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_measurement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_session" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "LearningSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "active_seconds" INTEGER NOT NULL DEFAULT 0,
    "daily_plan_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learning_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_attempt" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "activity_id" UUID NOT NULL,
    "lesson_revision_id" UUID NOT NULL,
    "learning_session_id" UUID,
    "roadmap_item_id" UUID,
    "attempt_no" INTEGER NOT NULL,
    "status" "ActivityAttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "answer" JSONB,
    "response_media_asset_id" UUID,
    "is_correct" BOOLEAN,
    "deterministic_score" INTEGER,
    "response_time_ms" INTEGER,
    "client_request_id" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learner_lesson_progress" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "lesson_id" UUID NOT NULL,
    "lesson_revision_id" UUID NOT NULL,
    "status" "LessonProgressStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "completed_activities" JSONB,
    "last_activity_id" UUID,
    "completion_pct" INTEGER NOT NULL DEFAULT 0,
    "mastery_best_score" INTEGER,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learner_lesson_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learner_lesson_completion" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "lesson_id" UUID NOT NULL,
    "lesson_revision_id" UUID NOT NULL,
    "completion_no" INTEGER NOT NULL,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mastery_best_score" INTEGER,

    CONSTRAINT "learner_lesson_completion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learner_roadmap" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "track_id" UUID NOT NULL,
    "status" "RoadmapStatus" NOT NULL DEFAULT 'ACTIVE',
    "source_assessment_attempt_id" UUID,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learner_roadmap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roadmap_item" (
    "id" UUID NOT NULL,
    "roadmap_id" UUID NOT NULL,
    "item_type" "RoadmapItemType" NOT NULL,
    "lesson_id" UUID,
    "checkpoint_id" UUID,
    "skill_id" UUID,
    "position" INTEGER NOT NULL,
    "status" "RoadmapItemStatus" NOT NULL DEFAULT 'PENDING',
    "source" "RoadmapItemSource" NOT NULL,
    "reason" TEXT,
    "roadmap_change_id" UUID,
    "params" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roadmap_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learner_recommendation" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "RecommendationType" NOT NULL,
    "source" "RecommendationSource" NOT NULL,
    "roadmap_id" UUID,
    "reason" TEXT,
    "proposed_change" JSONB,
    "signal_refs" JSONB,
    "status" "RecommendationStatus" NOT NULL DEFAULT 'PROPOSED',
    "responded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learner_recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roadmap_change" (
    "id" UUID NOT NULL,
    "roadmap_id" UUID NOT NULL,
    "recommendation_id" UUID,
    "change_type" TEXT NOT NULL,
    "change_payload" JSONB,
    "applied_by" TEXT NOT NULL,
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roadmap_change_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learner_signal" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "skill_id" UUID,
    "lesson_id" UUID,
    "topic_id" UUID,
    "category_code" TEXT,
    "strength" INTEGER NOT NULL DEFAULT 0,
    "evidence_refs" JSONB,
    "status" "SignalStatus" NOT NULL DEFAULT 'ACTIVE',
    "first_detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "learner_signal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkpoint" (
    "id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "module_id" UUID NOT NULL,
    "assessment_definition_id" UUID NOT NULL,
    "status" "ContainerStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checkpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_plan" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "local_date" DATE NOT NULL,
    "timezone_snapshot" TEXT NOT NULL,
    "generation_no" INTEGER NOT NULL,
    "status" "DailyPlanStatus" NOT NULL DEFAULT 'CURRENT',
    "available_time_min" INTEGER,
    "context" JSONB,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_plan_item" (
    "id" UUID NOT NULL,
    "daily_plan_id" UUID NOT NULL,
    "section" "DailyPlanSection" NOT NULL,
    "item_type" "DailyPlanItemType" NOT NULL,
    "roadmap_item_id" UUID,
    "lesson_id" UUID,
    "skill_id" UUID,
    "params" JSONB,
    "position" INTEGER NOT NULL,
    "status" "DailyPlanItemStatus" NOT NULL DEFAULT 'PENDING',
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "daily_plan_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_mission_completion" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "daily_plan_item_id" UUID NOT NULL,
    "completion_type" TEXT,
    "completed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_mission_completion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_mission_completion_evidence" (
    "id" UUID NOT NULL,
    "completion_id" UUID NOT NULL,
    "community_post_id" UUID,
    "activity_attempt_id" UUID,
    "learning_session_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_mission_completion_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_schedule_preference" (
    "user_id" UUID NOT NULL,
    "selected_weekdays" INTEGER[],
    "target_sessions_per_week" INTEGER NOT NULL,
    "preferred_session_minutes" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learning_schedule_preference_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "weekly_progress" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "week_start_local_date" DATE NOT NULL,
    "timezone_snapshot" TEXT,
    "target_sessions" INTEGER NOT NULL,
    "completed_sessions" INTEGER NOT NULL DEFAULT 0,
    "status" "WeeklyProgressStatus" NOT NULL DEFAULT 'IN_PROGRESS',

    CONSTRAINT "weekly_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "community_post_accepted_reply_id_key" ON "community_post"("accepted_reply_id");

-- CreateIndex
CREATE INDEX "community_post_subject_id_created_at_idx" ON "community_post"("subject_id", "created_at");

-- CreateIndex
CREATE INDEX "community_post_topic_id_created_at_idx" ON "community_post"("topic_id", "created_at");

-- CreateIndex
CREATE INDEX "community_post_author_user_id_created_at_idx" ON "community_post"("author_user_id", "created_at");

-- CreateIndex
CREATE INDEX "community_post_visibility_idx" ON "community_post"("visibility");

-- CreateIndex
CREATE INDEX "community_reply_post_id_created_at_idx" ON "community_reply"("post_id", "created_at");

-- CreateIndex
CREATE INDEX "community_reply_author_user_id_idx" ON "community_reply"("author_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "reaction_type_code_key" ON "reaction_type"("code");

-- CreateIndex
CREATE INDEX "community_reaction_post_id_idx" ON "community_reaction"("post_id");

-- CreateIndex
CREATE INDEX "community_reaction_reply_id_idx" ON "community_reaction"("reply_id");

-- CreateIndex
CREATE INDEX "community_post_media_media_asset_id_idx" ON "community_post_media"("media_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "community_post_media_post_id_media_asset_id_key" ON "community_post_media"("post_id", "media_asset_id");

-- CreateIndex
CREATE INDEX "community_report_status_created_at_idx" ON "community_report"("status", "created_at");

-- CreateIndex
CREATE INDEX "community_report_post_id_idx" ON "community_report"("post_id");

-- CreateIndex
CREATE INDEX "community_report_reply_id_idx" ON "community_report"("reply_id");

-- CreateIndex
CREATE INDEX "moderation_action_post_id_idx" ON "moderation_action"("post_id");

-- CreateIndex
CREATE INDEX "moderation_action_reply_id_idx" ON "moderation_action"("reply_id");

-- CreateIndex
CREATE INDEX "moderation_action_created_at_idx" ON "moderation_action"("created_at");

-- CreateIndex
CREATE INDEX "community_restriction_user_id_expires_at_idx" ON "community_restriction"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX "reputation_event_user_id_created_at_idx" ON "reputation_event"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "reputation_event_user_id_dedup_key_key" ON "reputation_event"("user_id", "dedup_key");

-- CreateIndex
CREATE INDEX "announcement_status_publish_at_idx" ON "announcement"("status", "publish_at");

-- CreateIndex
CREATE UNIQUE INDEX "announcement_user_state_announcement_id_user_id_key" ON "announcement_user_state"("announcement_id", "user_id");

-- CreateIndex
CREATE INDEX "notification_user_id_read_at_created_at_idx" ON "notification"("user_id", "read_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_user_id_dedup_key_key" ON "notification"("user_id", "dedup_key");

-- CreateIndex
CREATE UNIQUE INDEX "subject_slug_key" ON "subject"("slug");

-- CreateIndex
CREATE INDEX "track_subject_id_idx" ON "track"("subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "track_subject_id_slug_key" ON "track"("subject_id", "slug");

-- CreateIndex
CREATE INDEX "level_track_id_idx" ON "level"("track_id");

-- CreateIndex
CREATE UNIQUE INDEX "level_track_id_code_key" ON "level"("track_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "level_track_id_sort_order_key" ON "level"("track_id", "sort_order");

-- CreateIndex
CREATE INDEX "module_level_id_idx" ON "module"("level_id");

-- CreateIndex
CREATE UNIQUE INDEX "module_level_id_sort_order_key" ON "module"("level_id", "sort_order");

-- CreateIndex
CREATE INDEX "topic_module_id_idx" ON "topic"("module_id");

-- CreateIndex
CREATE UNIQUE INDEX "topic_module_id_sort_order_key" ON "topic"("module_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_published_revision_id_key" ON "lesson"("published_revision_id");

-- CreateIndex
CREATE INDEX "lesson_topic_id_status_idx" ON "lesson"("topic_id", "status");

-- CreateIndex
CREATE INDEX "lesson_revision_lesson_id_status_idx" ON "lesson_revision"("lesson_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_revision_lesson_id_version_key" ON "lesson_revision"("lesson_id", "version");

-- CreateIndex
CREATE INDEX "activity_lesson_revision_id_idx" ON "activity"("lesson_revision_id");

-- CreateIndex
CREATE UNIQUE INDEX "activity_lesson_revision_id_position_key" ON "activity"("lesson_revision_id", "position");

-- CreateIndex
CREATE INDEX "activity_media_media_asset_id_idx" ON "activity_media"("media_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "activity_media_activity_id_media_asset_id_key" ON "activity_media"("activity_id", "media_asset_id");

-- CreateIndex
CREATE INDEX "skill_subject_id_idx" ON "skill"("subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "skill_subject_id_name_key" ON "skill"("subject_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "skill_subject_id_code_key" ON "skill"("subject_id", "code");

-- CreateIndex
CREATE INDEX "lesson_skill_skill_id_idx" ON "lesson_skill"("skill_id");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_skill_lesson_id_skill_id_key" ON "lesson_skill"("lesson_id", "skill_id");

-- CreateIndex
CREATE INDEX "activity_skill_skill_id_idx" ON "activity_skill"("skill_id");

-- CreateIndex
CREATE UNIQUE INDEX "activity_skill_activity_id_skill_id_key" ON "activity_skill"("activity_id", "skill_id");

-- CreateIndex
CREATE INDEX "lesson_prerequisite_prerequisite_lesson_id_idx" ON "lesson_prerequisite"("prerequisite_lesson_id");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_prerequisite_lesson_id_prerequisite_lesson_id_key" ON "lesson_prerequisite"("lesson_id", "prerequisite_lesson_id");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_phone_key" ON "app_user"("phone");

-- CreateIndex
CREATE INDEX "app_user_status_idx" ON "app_user"("status");

-- CreateIndex
CREATE UNIQUE INDEX "role_code_key" ON "role"("code");

-- CreateIndex
CREATE INDEX "user_role_role_id_idx" ON "user_role"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_role_user_id_role_id_key" ON "user_role"("user_id", "role_id");

-- CreateIndex
CREATE UNIQUE INDEX "role_permission_role_id_permission_code_key" ON "role_permission"("role_id", "permission_code");

-- CreateIndex
CREATE INDEX "subject_assignment_subject_id_idx" ON "subject_assignment"("subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "subject_assignment_user_id_subject_id_key" ON "subject_assignment"("user_id", "subject_id");

-- CreateIndex
CREATE INDEX "auth_session_user_id_idx" ON "auth_session"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_token_token_hash_key" ON "refresh_token"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_token_session_id_idx" ON "refresh_token"("session_id");

-- CreateIndex
CREATE INDEX "otp_challenge_phone_created_at_idx" ON "otp_challenge"("phone", "created_at");

-- CreateIndex
CREATE INDEX "security_event_user_id_created_at_idx" ON "security_event"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "security_event_type_created_at_idx" ON "security_event"("type", "created_at");

-- CreateIndex
CREATE INDEX "staff_audit_actor_user_id_created_at_idx" ON "staff_audit"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "staff_audit_target_type_target_id_idx" ON "staff_audit"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "staff_audit_action_code_created_at_idx" ON "staff_audit"("action_code", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "media_asset_storage_key_key" ON "media_asset"("storage_key");

-- CreateIndex
CREATE INDEX "media_asset_uploaded_by_idx" ON "media_asset"("uploaded_by");

-- CreateIndex
CREATE INDEX "xp_grant_user_id_created_at_idx" ON "xp_grant"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "izl_ledger_entry_reward_grant_id_key" ON "izl_ledger_entry"("reward_grant_id");

-- CreateIndex
CREATE UNIQUE INDEX "izl_ledger_entry_reversal_of_entry_id_key" ON "izl_ledger_entry"("reversal_of_entry_id");

-- CreateIndex
CREATE INDEX "izl_ledger_entry_user_id_created_at_idx" ON "izl_ledger_entry"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "izl_ledger_entry_subscription_cycle_id_idx" ON "izl_ledger_entry"("subscription_cycle_id");

-- CreateIndex
CREATE UNIQUE INDEX "izl_ledger_entry_user_id_entry_no_key" ON "izl_ledger_entry"("user_id", "entry_no");

-- CreateIndex
CREATE INDEX "reward_grant_subscription_cycle_id_idx" ON "reward_grant"("subscription_cycle_id");

-- CreateIndex
CREATE UNIQUE INDEX "reward_grant_user_id_dedup_key_key" ON "reward_grant"("user_id", "dedup_key");

-- CreateIndex
CREATE UNIQUE INDEX "reward_policy_version_version_key" ON "reward_policy_version"("version");

-- CreateIndex
CREATE INDEX "izl_redemption_user_id_status_idx" ON "izl_redemption"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_plan_code_key" ON "subscription_plan"("code");

-- CreateIndex
CREATE INDEX "plan_price_plan_id_effective_from_idx" ON "plan_price"("plan_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "plan_price_plan_id_currency_effective_from_key" ON "plan_price"("plan_id", "currency", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "plan_entitlement_plan_id_feature_code_key" ON "plan_entitlement"("plan_id", "feature_code");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_current_cycle_id_key" ON "subscription"("current_cycle_id");

-- CreateIndex
CREATE INDEX "subscription_user_id_status_idx" ON "subscription"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_cycle_payment_order_id_key" ON "subscription_cycle"("payment_order_id");

-- CreateIndex
CREATE INDEX "subscription_cycle_subscription_id_idx" ON "subscription_cycle"("subscription_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_cycle_subscription_id_sequence_no_key" ON "subscription_cycle"("subscription_id", "sequence_no");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_cycle_entitlement_subscription_cycle_id_featur_key" ON "subscription_cycle_entitlement"("subscription_cycle_id", "feature_code");

-- CreateIndex
CREATE INDEX "subscription_change_subscription_id_idx" ON "subscription_change"("subscription_id");

-- CreateIndex
CREATE UNIQUE INDEX "usage_counter_subscription_cycle_id_feature_code_key" ON "usage_counter"("subscription_cycle_id", "feature_code");

-- CreateIndex
CREATE INDEX "payment_order_user_id_status_idx" ON "payment_order"("user_id", "status");

-- CreateIndex
CREATE INDEX "payment_order_created_at_idx" ON "payment_order"("created_at");

-- CreateIndex
CREATE INDEX "payment_transaction_payment_order_id_idx" ON "payment_transaction"("payment_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_transaction_provider_provider_transaction_id_key" ON "payment_transaction"("provider", "provider_transaction_id");

-- CreateIndex
CREATE INDEX "payment_callback_event_payment_transaction_id_idx" ON "payment_callback_event"("payment_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_callback_event_provider_provider_event_id_key" ON "payment_callback_event"("provider", "provider_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_definition_current_version_id_key" ON "assessment_definition"("current_version_id");

-- CreateIndex
CREATE INDEX "assessment_definition_subject_id_idx" ON "assessment_definition"("subject_id");

-- CreateIndex
CREATE INDEX "assessment_definition_version_assessment_definition_id_stat_idx" ON "assessment_definition_version"("assessment_definition_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_definition_version_assessment_definition_id_vers_key" ON "assessment_definition_version"("assessment_definition_id", "version_no");

-- CreateIndex
CREATE INDEX "assessment_item_assessment_definition_id_idx" ON "assessment_item"("assessment_definition_id");

-- CreateIndex
CREATE INDEX "assessment_item_skill_id_idx" ON "assessment_item"("skill_id");

-- CreateIndex
CREATE INDEX "assessment_version_item_assessment_item_id_idx" ON "assessment_version_item"("assessment_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_version_item_assessment_definition_version_id_as_key" ON "assessment_version_item"("assessment_definition_version_id", "assessment_item_id");

-- CreateIndex
CREATE INDEX "assessment_item_media_media_asset_id_idx" ON "assessment_item_media"("media_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_item_media_assessment_item_id_media_asset_id_key" ON "assessment_item_media"("assessment_item_id", "media_asset_id");

-- CreateIndex
CREATE INDEX "assessment_attempt_user_id_started_at_idx" ON "assessment_attempt"("user_id", "started_at");

-- CreateIndex
CREATE INDEX "assessment_attempt_assessment_definition_version_id_idx" ON "assessment_attempt"("assessment_definition_version_id");

-- CreateIndex
CREATE INDEX "assessment_attempt_checkpoint_id_idx" ON "assessment_attempt"("checkpoint_id");

-- CreateIndex
CREATE INDEX "assessment_response_item_id_idx" ON "assessment_response"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_response_attempt_id_sequence_no_key" ON "assessment_response"("attempt_id", "sequence_no");

-- CreateIndex
CREATE INDEX "ai_evaluation_assessment_response_id_idx" ON "ai_evaluation"("assessment_response_id");

-- CreateIndex
CREATE INDEX "ai_evaluation_activity_attempt_id_idx" ON "ai_evaluation"("activity_attempt_id");

-- CreateIndex
CREATE UNIQUE INDEX "learner_skill_state_user_id_skill_id_key" ON "learner_skill_state"("user_id", "skill_id");

-- CreateIndex
CREATE INDEX "skill_measurement_user_id_skill_id_created_at_idx" ON "skill_measurement"("user_id", "skill_id", "created_at");

-- CreateIndex
CREATE INDEX "learning_session_user_id_started_at_idx" ON "learning_session"("user_id", "started_at");

-- CreateIndex
CREATE INDEX "activity_attempt_user_id_submitted_at_idx" ON "activity_attempt"("user_id", "submitted_at");

-- CreateIndex
CREATE INDEX "activity_attempt_activity_id_idx" ON "activity_attempt"("activity_id");

-- CreateIndex
CREATE UNIQUE INDEX "activity_attempt_user_id_activity_id_attempt_no_key" ON "activity_attempt"("user_id", "activity_id", "attempt_no");

-- CreateIndex
CREATE UNIQUE INDEX "learner_lesson_progress_user_id_lesson_id_key" ON "learner_lesson_progress"("user_id", "lesson_id");

-- CreateIndex
CREATE INDEX "learner_lesson_completion_user_id_lesson_id_idx" ON "learner_lesson_completion"("user_id", "lesson_id");

-- CreateIndex
CREATE UNIQUE INDEX "learner_lesson_completion_user_id_lesson_id_completion_no_key" ON "learner_lesson_completion"("user_id", "lesson_id", "completion_no");

-- CreateIndex
CREATE INDEX "learner_roadmap_user_id_subject_id_status_idx" ON "learner_roadmap"("user_id", "subject_id", "status");

-- CreateIndex
CREATE INDEX "roadmap_item_roadmap_id_position_idx" ON "roadmap_item"("roadmap_id", "position");

-- CreateIndex
CREATE INDEX "learner_recommendation_user_id_status_idx" ON "learner_recommendation"("user_id", "status");

-- CreateIndex
CREATE INDEX "roadmap_change_roadmap_id_idx" ON "roadmap_change"("roadmap_id");

-- CreateIndex
CREATE INDEX "learner_signal_user_id_status_idx" ON "learner_signal"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "checkpoint_module_id_key" ON "checkpoint"("module_id");

-- CreateIndex
CREATE INDEX "checkpoint_subject_id_idx" ON "checkpoint"("subject_id");

-- CreateIndex
CREATE INDEX "daily_plan_user_id_local_date_idx" ON "daily_plan"("user_id", "local_date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_plan_user_id_local_date_generation_no_key" ON "daily_plan"("user_id", "local_date", "generation_no");

-- CreateIndex
CREATE INDEX "daily_plan_item_daily_plan_id_position_idx" ON "daily_plan_item"("daily_plan_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "daily_mission_completion_daily_plan_item_id_key" ON "daily_mission_completion"("daily_plan_item_id");

-- CreateIndex
CREATE INDEX "daily_mission_completion_user_id_idx" ON "daily_mission_completion"("user_id");

-- CreateIndex
CREATE INDEX "daily_mission_completion_evidence_completion_id_idx" ON "daily_mission_completion_evidence"("completion_id");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_progress_user_id_week_start_local_date_key" ON "weekly_progress"("user_id", "week_start_local_date");

-- AddForeignKey
ALTER TABLE "community_post" ADD CONSTRAINT "community_post_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_post" ADD CONSTRAINT "community_post_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_post" ADD CONSTRAINT "community_post_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_post" ADD CONSTRAINT "community_post_accepted_reply_id_fkey" FOREIGN KEY ("accepted_reply_id") REFERENCES "community_reply"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_reply" ADD CONSTRAINT "community_reply_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "community_post"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_reply" ADD CONSTRAINT "community_reply_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_reaction" ADD CONSTRAINT "community_reaction_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_reaction" ADD CONSTRAINT "community_reaction_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "community_post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_reaction" ADD CONSTRAINT "community_reaction_reply_id_fkey" FOREIGN KEY ("reply_id") REFERENCES "community_reply"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_reaction" ADD CONSTRAINT "community_reaction_reaction_type_id_fkey" FOREIGN KEY ("reaction_type_id") REFERENCES "reaction_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_post_media" ADD CONSTRAINT "community_post_media_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "community_post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_post_media" ADD CONSTRAINT "community_post_media_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_report" ADD CONSTRAINT "community_report_reporter_user_id_fkey" FOREIGN KEY ("reporter_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_report" ADD CONSTRAINT "community_report_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "community_post"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_report" ADD CONSTRAINT "community_report_reply_id_fkey" FOREIGN KEY ("reply_id") REFERENCES "community_reply"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_report" ADD CONSTRAINT "community_report_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_action" ADD CONSTRAINT "moderation_action_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_action" ADD CONSTRAINT "moderation_action_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_action" ADD CONSTRAINT "moderation_action_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "community_report"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_restriction" ADD CONSTRAINT "community_restriction_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_restriction" ADD CONSTRAINT "community_restriction_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_restriction" ADD CONSTRAINT "community_restriction_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reputation_balance" ADD CONSTRAINT "reputation_balance_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reputation_event" ADD CONSTRAINT "reputation_event_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_user_state" ADD CONSTRAINT "announcement_user_state_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_user_state" ADD CONSTRAINT "announcement_user_state_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject" ADD CONSTRAINT "subject_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "track" ADD CONSTRAINT "track_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "track" ADD CONSTRAINT "track_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "level" ADD CONSTRAINT "level_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "track"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "level" ADD CONSTRAINT "level_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "module" ADD CONSTRAINT "module_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "module" ADD CONSTRAINT "module_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topic" ADD CONSTRAINT "topic_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "module"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topic" ADD CONSTRAINT "topic_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_published_revision_id_fkey" FOREIGN KEY ("published_revision_id") REFERENCES "lesson_revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_revision" ADD CONSTRAINT "lesson_revision_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lesson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_revision" ADD CONSTRAINT "lesson_revision_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_revision" ADD CONSTRAINT "lesson_revision_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_revision" ADD CONSTRAINT "lesson_revision_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_revision" ADD CONSTRAINT "lesson_revision_published_by_fkey" FOREIGN KEY ("published_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity" ADD CONSTRAINT "activity_lesson_revision_id_fkey" FOREIGN KEY ("lesson_revision_id") REFERENCES "lesson_revision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_media" ADD CONSTRAINT "activity_media_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_media" ADD CONSTRAINT "activity_media_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill" ADD CONSTRAINT "skill_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_skill" ADD CONSTRAINT "lesson_skill_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_skill" ADD CONSTRAINT "lesson_skill_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_skill" ADD CONSTRAINT "activity_skill_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_skill" ADD CONSTRAINT "activity_skill_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_prerequisite" ADD CONSTRAINT "lesson_prerequisite_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_prerequisite" ADD CONSTRAINT "lesson_prerequisite_prerequisite_lesson_id_fkey" FOREIGN KEY ("prerequisite_lesson_id") REFERENCES "lesson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_profile" ADD CONSTRAINT "user_profile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject_assignment" ADD CONSTRAINT "subject_assignment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject_assignment" ADD CONSTRAINT "subject_assignment_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject_assignment" ADD CONSTRAINT "subject_assignment_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "auth_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_event" ADD CONSTRAINT "security_event_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_audit" ADD CONSTRAINT "staff_audit_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "xp_balance" ADD CONSTRAINT "xp_balance_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "xp_grant" ADD CONSTRAINT "xp_grant_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "izl_wallet" ADD CONSTRAINT "izl_wallet_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "izl_ledger_entry" ADD CONSTRAINT "izl_ledger_entry_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "izl_ledger_entry" ADD CONSTRAINT "izl_ledger_entry_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "izl_ledger_entry" ADD CONSTRAINT "izl_ledger_entry_reward_grant_id_fkey" FOREIGN KEY ("reward_grant_id") REFERENCES "reward_grant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "izl_ledger_entry" ADD CONSTRAINT "izl_ledger_entry_redemption_id_fkey" FOREIGN KEY ("redemption_id") REFERENCES "izl_redemption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "izl_ledger_entry" ADD CONSTRAINT "izl_ledger_entry_subscription_cycle_id_fkey" FOREIGN KEY ("subscription_cycle_id") REFERENCES "subscription_cycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "izl_ledger_entry" ADD CONSTRAINT "izl_ledger_entry_reversal_of_entry_id_fkey" FOREIGN KEY ("reversal_of_entry_id") REFERENCES "izl_ledger_entry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_grant" ADD CONSTRAINT "reward_grant_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_grant" ADD CONSTRAINT "reward_grant_reward_policy_version_id_fkey" FOREIGN KEY ("reward_policy_version_id") REFERENCES "reward_policy_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_grant" ADD CONSTRAINT "reward_grant_subscription_cycle_id_fkey" FOREIGN KEY ("subscription_cycle_id") REFERENCES "subscription_cycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_grant" ADD CONSTRAINT "reward_grant_activity_attempt_id_fkey" FOREIGN KEY ("activity_attempt_id") REFERENCES "activity_attempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_grant" ADD CONSTRAINT "reward_grant_learning_session_id_fkey" FOREIGN KEY ("learning_session_id") REFERENCES "learning_session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_grant" ADD CONSTRAINT "reward_grant_daily_mission_completion_id_fkey" FOREIGN KEY ("daily_mission_completion_id") REFERENCES "daily_mission_completion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_policy_version" ADD CONSTRAINT "reward_policy_version_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "izl_rate_version" ADD CONSTRAINT "izl_rate_version_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "izl_redemption" ADD CONSTRAINT "izl_redemption_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "izl_redemption" ADD CONSTRAINT "izl_redemption_payment_order_id_fkey" FOREIGN KEY ("payment_order_id") REFERENCES "payment_order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_price" ADD CONSTRAINT "plan_price_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_price" ADD CONSTRAINT "plan_price_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_entitlement" ADD CONSTRAINT "plan_entitlement_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_current_cycle_id_fkey" FOREIGN KEY ("current_cycle_id") REFERENCES "subscription_cycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_cycle" ADD CONSTRAINT "subscription_cycle_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_cycle" ADD CONSTRAINT "subscription_cycle_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_cycle" ADD CONSTRAINT "subscription_cycle_plan_price_id_fkey" FOREIGN KEY ("plan_price_id") REFERENCES "plan_price"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_cycle" ADD CONSTRAINT "subscription_cycle_reward_policy_version_id_fkey" FOREIGN KEY ("reward_policy_version_id") REFERENCES "reward_policy_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_cycle" ADD CONSTRAINT "subscription_cycle_payment_order_id_fkey" FOREIGN KEY ("payment_order_id") REFERENCES "payment_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_cycle_entitlement" ADD CONSTRAINT "subscription_cycle_entitlement_subscription_cycle_id_fkey" FOREIGN KEY ("subscription_cycle_id") REFERENCES "subscription_cycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_change" ADD CONSTRAINT "subscription_change_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_counter" ADD CONSTRAINT "usage_counter_subscription_cycle_id_fkey" FOREIGN KEY ("subscription_cycle_id") REFERENCES "subscription_cycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_order" ADD CONSTRAINT "payment_order_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_order" ADD CONSTRAINT "payment_order_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_order" ADD CONSTRAINT "payment_order_plan_price_id_fkey" FOREIGN KEY ("plan_price_id") REFERENCES "plan_price"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_transaction" ADD CONSTRAINT "payment_transaction_payment_order_id_fkey" FOREIGN KEY ("payment_order_id") REFERENCES "payment_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_callback_event" ADD CONSTRAINT "payment_callback_event_payment_transaction_id_fkey" FOREIGN KEY ("payment_transaction_id") REFERENCES "payment_transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_definition" ADD CONSTRAINT "assessment_definition_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_definition" ADD CONSTRAINT "assessment_definition_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_definition" ADD CONSTRAINT "assessment_definition_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "assessment_definition_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_definition_version" ADD CONSTRAINT "assessment_definition_version_assessment_definition_id_fkey" FOREIGN KEY ("assessment_definition_id") REFERENCES "assessment_definition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_definition_version" ADD CONSTRAINT "assessment_definition_version_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_item" ADD CONSTRAINT "assessment_item_assessment_definition_id_fkey" FOREIGN KEY ("assessment_definition_id") REFERENCES "assessment_definition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_item" ADD CONSTRAINT "assessment_item_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_version_item" ADD CONSTRAINT "assessment_version_item_assessment_definition_version_id_fkey" FOREIGN KEY ("assessment_definition_version_id") REFERENCES "assessment_definition_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_version_item" ADD CONSTRAINT "assessment_version_item_assessment_item_id_fkey" FOREIGN KEY ("assessment_item_id") REFERENCES "assessment_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_item_media" ADD CONSTRAINT "assessment_item_media_assessment_item_id_fkey" FOREIGN KEY ("assessment_item_id") REFERENCES "assessment_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_item_media" ADD CONSTRAINT "assessment_item_media_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_attempt" ADD CONSTRAINT "assessment_attempt_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_attempt" ADD CONSTRAINT "assessment_attempt_assessment_definition_version_id_fkey" FOREIGN KEY ("assessment_definition_version_id") REFERENCES "assessment_definition_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_attempt" ADD CONSTRAINT "assessment_attempt_checkpoint_id_fkey" FOREIGN KEY ("checkpoint_id") REFERENCES "checkpoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_response" ADD CONSTRAINT "assessment_response_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "assessment_attempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_response" ADD CONSTRAINT "assessment_response_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "assessment_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_response" ADD CONSTRAINT "assessment_response_response_media_asset_id_fkey" FOREIGN KEY ("response_media_asset_id") REFERENCES "media_asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_evaluation" ADD CONSTRAINT "ai_evaluation_assessment_response_id_fkey" FOREIGN KEY ("assessment_response_id") REFERENCES "assessment_response"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_evaluation" ADD CONSTRAINT "ai_evaluation_activity_attempt_id_fkey" FOREIGN KEY ("activity_attempt_id") REFERENCES "activity_attempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_skill_state" ADD CONSTRAINT "learner_skill_state_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_skill_state" ADD CONSTRAINT "learner_skill_state_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_measurement" ADD CONSTRAINT "skill_measurement_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_measurement" ADD CONSTRAINT "skill_measurement_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_session" ADD CONSTRAINT "learning_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_session" ADD CONSTRAINT "learning_session_daily_plan_id_fkey" FOREIGN KEY ("daily_plan_id") REFERENCES "daily_plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_attempt" ADD CONSTRAINT "activity_attempt_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_attempt" ADD CONSTRAINT "activity_attempt_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_attempt" ADD CONSTRAINT "activity_attempt_lesson_revision_id_fkey" FOREIGN KEY ("lesson_revision_id") REFERENCES "lesson_revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_attempt" ADD CONSTRAINT "activity_attempt_learning_session_id_fkey" FOREIGN KEY ("learning_session_id") REFERENCES "learning_session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_attempt" ADD CONSTRAINT "activity_attempt_roadmap_item_id_fkey" FOREIGN KEY ("roadmap_item_id") REFERENCES "roadmap_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_attempt" ADD CONSTRAINT "activity_attempt_response_media_asset_id_fkey" FOREIGN KEY ("response_media_asset_id") REFERENCES "media_asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_lesson_progress" ADD CONSTRAINT "learner_lesson_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_lesson_progress" ADD CONSTRAINT "learner_lesson_progress_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lesson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_lesson_progress" ADD CONSTRAINT "learner_lesson_progress_lesson_revision_id_fkey" FOREIGN KEY ("lesson_revision_id") REFERENCES "lesson_revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_lesson_completion" ADD CONSTRAINT "learner_lesson_completion_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_lesson_completion" ADD CONSTRAINT "learner_lesson_completion_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lesson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_lesson_completion" ADD CONSTRAINT "learner_lesson_completion_lesson_revision_id_fkey" FOREIGN KEY ("lesson_revision_id") REFERENCES "lesson_revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_roadmap" ADD CONSTRAINT "learner_roadmap_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_roadmap" ADD CONSTRAINT "learner_roadmap_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_roadmap" ADD CONSTRAINT "learner_roadmap_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "track"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roadmap_item" ADD CONSTRAINT "roadmap_item_roadmap_id_fkey" FOREIGN KEY ("roadmap_id") REFERENCES "learner_roadmap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roadmap_item" ADD CONSTRAINT "roadmap_item_checkpoint_id_fkey" FOREIGN KEY ("checkpoint_id") REFERENCES "checkpoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roadmap_item" ADD CONSTRAINT "roadmap_item_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roadmap_item" ADD CONSTRAINT "roadmap_item_roadmap_change_id_fkey" FOREIGN KEY ("roadmap_change_id") REFERENCES "roadmap_change"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_recommendation" ADD CONSTRAINT "learner_recommendation_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_recommendation" ADD CONSTRAINT "learner_recommendation_roadmap_id_fkey" FOREIGN KEY ("roadmap_id") REFERENCES "learner_roadmap"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roadmap_change" ADD CONSTRAINT "roadmap_change_roadmap_id_fkey" FOREIGN KEY ("roadmap_id") REFERENCES "learner_roadmap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roadmap_change" ADD CONSTRAINT "roadmap_change_recommendation_id_fkey" FOREIGN KEY ("recommendation_id") REFERENCES "learner_recommendation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_signal" ADD CONSTRAINT "learner_signal_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_signal" ADD CONSTRAINT "learner_signal_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_signal" ADD CONSTRAINT "learner_signal_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkpoint" ADD CONSTRAINT "checkpoint_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkpoint" ADD CONSTRAINT "checkpoint_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "module"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkpoint" ADD CONSTRAINT "checkpoint_assessment_definition_id_fkey" FOREIGN KEY ("assessment_definition_id") REFERENCES "assessment_definition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_plan" ADD CONSTRAINT "daily_plan_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_plan_item" ADD CONSTRAINT "daily_plan_item_daily_plan_id_fkey" FOREIGN KEY ("daily_plan_id") REFERENCES "daily_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_mission_completion" ADD CONSTRAINT "daily_mission_completion_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_mission_completion" ADD CONSTRAINT "daily_mission_completion_daily_plan_item_id_fkey" FOREIGN KEY ("daily_plan_item_id") REFERENCES "daily_plan_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_mission_completion_evidence" ADD CONSTRAINT "daily_mission_completion_evidence_completion_id_fkey" FOREIGN KEY ("completion_id") REFERENCES "daily_mission_completion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_mission_completion_evidence" ADD CONSTRAINT "daily_mission_completion_evidence_community_post_id_fkey" FOREIGN KEY ("community_post_id") REFERENCES "community_post"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_mission_completion_evidence" ADD CONSTRAINT "daily_mission_completion_evidence_activity_attempt_id_fkey" FOREIGN KEY ("activity_attempt_id") REFERENCES "activity_attempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_mission_completion_evidence" ADD CONSTRAINT "daily_mission_completion_evidence_learning_session_id_fkey" FOREIGN KEY ("learning_session_id") REFERENCES "learning_session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_schedule_preference" ADD CONSTRAINT "learning_schedule_preference_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_progress" ADD CONSTRAINT "weekly_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ############################################################################
-- CUSTOM POSTGRESQL CONSTRAINTS (Phase 1.3 — DB_CONSTRAINT_MATRIX mapping)
-- ############################################################################

-- ---- CHECK: basis points 0..10000 (TD-89; L-*) ----
ALTER TABLE "learner_skill_state" ADD CONSTRAINT "chk_lss_mastery_bp" CHECK ("mastery_score_bp" BETWEEN 0 AND 10000);
ALTER TABLE "learner_skill_state" ADD CONSTRAINT "chk_lss_confidence_bp" CHECK ("confidence_bp" IS NULL OR "confidence_bp" BETWEEN 0 AND 10000);
ALTER TABLE "skill_measurement" ADD CONSTRAINT "chk_sm_score_bp" CHECK ("score_bp" BETWEEN 0 AND 10000);
ALTER TABLE "skill_measurement" ADD CONSTRAINT "chk_sm_confidence_bp" CHECK ("confidence_bp" IS NULL OR "confidence_bp" BETWEEN 0 AND 10000);

-- ---- CHECK: IZL wallet (F-5/F-6/F-17) ----
ALTER TABLE "izl_wallet" ADD CONSTRAINT "chk_wallet_balance_nonneg" CHECK ("balance" >= 0);
ALTER TABLE "izl_wallet" ADD CONSTRAINT "chk_wallet_reserved_nonneg" CHECK ("reserved_amount" >= 0);
ALTER TABLE "izl_wallet" ADD CONSTRAINT "chk_wallet_reserved_le_balance" CHECK ("reserved_amount" <= "balance");

-- ---- CHECK: subscription cycle (F-6) ----
ALTER TABLE "subscription_cycle" ADD CONSTRAINT "chk_cycle_earned_le_ceiling" CHECK ("earned_izl" <= "reward_ceiling_izl");
ALTER TABLE "subscription_cycle" ADD CONSTRAINT "chk_cycle_earned_nonneg" CHECK ("earned_izl" >= 0);
ALTER TABLE "subscription_cycle" ADD CONSTRAINT "chk_cycle_amounts_nonneg" CHECK ("gross_price_uzs" >= 0 AND "discount_uzs" >= 0 AND "paid_amount_uzs" >= 0 AND "reward_basis_uzs" >= 0 AND "reward_ceiling_uzs" >= 0 AND "reward_ceiling_izl" >= 0);
ALTER TABLE "subscription_cycle" ADD CONSTRAINT "chk_cycle_period" CHECK ("period_end" > "period_start");

-- ---- CHECK: usage counter (F-17) ----
ALTER TABLE "usage_counter" ADD CONSTRAINT "chk_usage_nonneg" CHECK ("used" >= 0);

-- ---- CHECK: entitlement mode<->limit (TD-86; F-13) ----
ALTER TABLE "plan_entitlement" ADD CONSTRAINT "chk_plan_ent_mode_limit" CHECK (("mode" = 'LIMITED' AND "limit_value" IS NOT NULL AND "limit_value" >= 0) OR ("mode" <> 'LIMITED' AND "limit_value" IS NULL));
ALTER TABLE "subscription_cycle_entitlement" ADD CONSTRAINT "chk_cyc_ent_mode_limit" CHECK (("mode" = 'LIMITED' AND "limit_value" IS NOT NULL AND "limit_value" >= 0) OR ("mode" <> 'LIMITED' AND "limit_value" IS NULL));

-- ---- CHECK: community restriction period (K10) ----
ALTER TABLE "community_restriction" ADD CONSTRAINT "chk_restriction_period" CHECK ("expires_at" > "starts_at");

-- ---- CHECK: schedule minutes 30..360 ----
ALTER TABLE "learning_schedule_preference" ADD CONSTRAINT "chk_sched_minutes" CHECK ("preferred_session_minutes" BETWEEN 30 AND 360);

-- ---- CHECK: payment order arithmetic (F-24) ----
ALTER TABLE "payment_order" ADD CONSTRAINT "chk_order_amounts" CHECK ("gross_amount" >= 0 AND "izl_discount_amount" >= 0 AND "payable_amount" >= 0 AND "payable_amount" = "gross_amount" - "izl_discount_amount");

-- ---- CHECK: XOR relations ----
ALTER TABLE "ai_evaluation" ADD CONSTRAINT "chk_aieval_xor" CHECK ((("assessment_response_id" IS NOT NULL)::int + ("activity_attempt_id" IS NOT NULL)::int) = 1); -- L1
ALTER TABLE "community_reaction" ADD CONSTRAINT "chk_reaction_xor" CHECK ((("post_id" IS NOT NULL)::int + ("reply_id" IS NOT NULL)::int) = 1); -- K1
ALTER TABLE "community_report" ADD CONSTRAINT "chk_report_xor" CHECK ((("post_id" IS NOT NULL)::int + ("reply_id" IS NOT NULL)::int) = 1); -- K3
ALTER TABLE "daily_mission_completion_evidence" ADD CONSTRAINT "chk_mission_evidence_xor" CHECK ((("community_post_id" IS NOT NULL)::int + ("activity_attempt_id" IS NOT NULL)::int + ("learning_session_id" IS NOT NULL)::int) = 1); -- L26

-- ---- CHECK: ledger ADJUSTMENT reason+actor (F-26) ----
ALTER TABLE "izl_ledger_entry" ADD CONSTRAINT "chk_ledger_adjustment" CHECK ("entry_type" <> 'ADJUSTMENT' OR ("reason" IS NOT NULL AND "actor_user_id" IS NOT NULL));

-- ---- CHECK: prerequisite no self-ref (C9) ----
ALTER TABLE "lesson_prerequisite" ADD CONSTRAINT "chk_prereq_no_self" CHECK ("lesson_id" <> "prerequisite_lesson_id");

-- ---- PARTIAL UNIQUE: "one current/active/published" invariants ----
CREATE UNIQUE INDEX "ux_lesson_published_revision" ON "lesson_revision" ("lesson_id") WHERE "status" = 'PUBLISHED'; -- C7
CREATE UNIQUE INDEX "ux_active_roadmap" ON "learner_roadmap" ("user_id", "subject_id") WHERE "status" = 'ACTIVE'; -- L9
CREATE UNIQUE INDEX "ux_current_daily_plan" ON "daily_plan" ("user_id", "local_date") WHERE "status" = 'CURRENT'; -- L16
CREATE UNIQUE INDEX "ux_nonterminal_subscription" ON "subscription" ("user_id") WHERE "status" IN ('ACTIVE', 'EXPIRED'); -- F-14
CREATE UNIQUE INDEX "ux_active_reward_policy" ON "reward_policy_version" ((true)) WHERE "status" = 'ACTIVE'; -- F-11 (faqat bitta ACTIVE)
CREATE UNIQUE INDEX "ux_active_izl_rate" ON "izl_rate_version" ((true)) WHERE "status" = 'ACTIVE'; -- (faqat bitta ACTIVE)

-- ---- PARTIAL UNIQUE: reaction/report dedup (nullable-target NULL semantics) ----
CREATE UNIQUE INDEX "ux_reaction_post" ON "community_reaction" ("user_id", "post_id", "reaction_type_id") WHERE "post_id" IS NOT NULL; -- K2
CREATE UNIQUE INDEX "ux_reaction_reply" ON "community_reaction" ("user_id", "reply_id", "reaction_type_id") WHERE "reply_id" IS NOT NULL; -- K2
CREATE UNIQUE INDEX "ux_report_post" ON "community_report" ("reporter_user_id", "post_id") WHERE "post_id" IS NOT NULL; -- K4
CREATE UNIQUE INDEX "ux_report_reply" ON "community_report" ("reporter_user_id", "reply_id") WHERE "reply_id" IS NOT NULL; -- K4

-- ---- PARTIAL UNIQUE: client_request_id dedup (L5) ----
CREATE UNIQUE INDEX "ux_attempt_client_request" ON "activity_attempt" ("user_id", "client_request_id") WHERE "client_request_id" IS NOT NULL;
