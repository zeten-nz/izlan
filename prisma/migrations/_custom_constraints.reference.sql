-- ============================================================================
-- Izlan Phase 1.3 — Custom PostgreSQL constraints (DB_CONSTRAINT_MATRIX mapping)
-- Prisma ifodalay olmaydigan: CHECK (local-row invariants) + PARTIAL UNIQUE
-- (partialIndexes preview => production policy: custom SQL). Init migration.sql
-- oxiriga qo'shilgan. Har biri DB_CONSTRAINT_MATRIX ID'siga referens qiladi.
-- ============================================================================

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

-- ============================================================================
-- Phase 1.5B-2 — Initial diagnostic integrity (migration 20260819160000_harden_initial_diagnostic_constraints)
-- ============================================================================
-- PA-07 / TD-94: bir subject uchun bitta PUBLISHED DIAGNOSTIC definition.
CREATE UNIQUE INDEX "uq_def_published_diagnostic_per_subject" ON "assessment_definition" ("subject_id") WHERE "purpose_scope" = 'DIAGNOSTIC' AND "status" = 'PUBLISHED';
-- PA-10 / TD-95: bir (user, subject) uchun bitta IN_PROGRESS INITIAL_DIAGNOSTIC attempt.
CREATE UNIQUE INDEX "uq_attempt_inprogress_initial_diagnostic_user_subject" ON "assessment_attempt" ("user_id", "subject_id") WHERE "purpose" = 'INITIAL_DIAGNOSTIC' AND "status" = 'IN_PROGRESS';

-- ============================================================================
-- Phase 1.5C — Skill profile derivation (migration 20260819170000_add_skill_measurement_derivation_version)
-- ============================================================================
-- SP-04 / TD-98: assessment-backed SkillMeasurement idempotency (attempt, skill, source, derivationVersion).
CREATE UNIQUE INDEX "uq_skill_measurement_assessment_idempotency" ON "skill_measurement" ("assessment_attempt_id", "skill_id", "source", "derivation_version") WHERE "assessment_attempt_id" IS NOT NULL;

-- Phase 1.5C-2 (migration 20260819180000): derivation identity mandatory + non-empty.
-- SP-09: derivation_version NOT NULL (schema) + non-empty CHECK.
ALTER TABLE "skill_measurement" ADD CONSTRAINT "chk_sm_derivation_version_nonempty" CHECK (length(trim("derivation_version")) > 0);

-- Phase 1.7C (migration 20260820120000): lesson-backed SkillMeasurement idempotency.
-- SP-10 / TD-111: one lesson-mastery measurement per (user, lesson, skill, source, derivationVersion).
CREATE UNIQUE INDEX "uq_skill_measurement_lesson_idempotency" ON "skill_measurement" ("user_id", "lesson_id", "skill_id", "source", "derivation_version") WHERE "lesson_id" IS NOT NULL;

-- Phase 1.8A (migration 20260820130000): normalized merge metadata for learning-progress-merge-v1.
-- LP-01 / TD-113: no zero/negative-evidence milestone (evidence_count + observed_at added NOT NULL in schema).
ALTER TABLE "skill_measurement" ADD CONSTRAINT "chk_sm_evidence_count_positive" CHECK ("evidence_count" > 0);

-- Phase 1.8B (migration 20260820140000): one ACTIVE LearnerSignal per (user, skill, type).
-- SG-01 / TD-117: at most one active episode; RESOLVED/EXPIRED remain unconstrained history.
CREATE UNIQUE INDEX "uq_learner_signal_active" ON "learner_signal" ("user_id", "skill_id", "type") WHERE "status" = 'ACTIVE';

-- Phase 1.9B-2 (migration 20260820150000): dedicated review-session provenance aggregate.
-- RS-DB-01 / TD-125: one ACTIVE review session per (user, skill, lesson) — final concurrency authority.
CREATE UNIQUE INDEX "uq_review_session_active" ON "learner_review_session" ("user_id", "skill_id", "lesson_id") WHERE "status" = 'ACTIVE';
-- RS-DB-04: selected-activity position is 1-based.
ALTER TABLE "learner_review_session_activity" ADD CONSTRAINT "chk_review_session_activity_position_positive" CHECK ("position" > 0);

-- Phase 1.9C (migration 20260820160000): review-backed SkillMeasurement idempotency (TD-130).
-- RM-DB-02: one REVIEW_MASTERY measurement per (reviewSession, skill, source, derivationVersion).
CREATE UNIQUE INDEX "uq_skill_measurement_review_idempotency" ON "skill_measurement" ("review_session_id", "skill_id", "source", "derivation_version") WHERE "review_session_id" IS NOT NULL;

-- Phase 2.0B (migration 20260820170000): account-level daily mission completion (TD-136).
-- DM-DB-01: one completion per (user, mission code, local day). DM-DB-03/04: non-empty provenance.
CREATE UNIQUE INDEX "uq_daily_mission_completion_day" ON "daily_mission_completion" ("user_id", "mission_code", "local_date") WHERE "local_date" IS NOT NULL;
ALTER TABLE "daily_mission_completion" ADD CONSTRAINT "chk_dmc_mission_code_nonempty" CHECK (length(trim("mission_code")) > 0);
ALTER TABLE "daily_mission_completion" ADD CONSTRAINT "chk_dmc_policy_version_nonempty" CHECK (length(trim("policy_version")) > 0);
ALTER TABLE "daily_mission_completion" ADD CONSTRAINT "chk_dmc_timezone_snapshot_nonempty" CHECK (length(trim("timezone_snapshot")) > 0);

-- Phase 2.0C-2 (migration 20260820180000): daily mission → XP grant provenance (TD-140/141). RewardGrant (IZL) untouched.
-- XP-DB-01: one XP grant per mission completion (policy version NOT part of uniqueness). XP-DB-03/04: nonempty policy, positive mission XP.
CREATE UNIQUE INDEX "uq_xp_grant_mission_completion" ON "xp_grant" ("daily_mission_completion_id") WHERE "daily_mission_completion_id" IS NOT NULL;
ALTER TABLE "xp_grant" ADD CONSTRAINT "chk_xp_grant_policy_version_nonempty" CHECK ("policy_version_code" IS NULL OR btrim("policy_version_code") <> '');
ALTER TABLE "xp_grant" ADD CONSTRAINT "chk_xp_grant_mission_amount_positive" CHECK ("daily_mission_completion_id" IS NULL OR "amount" > 0);

-- Phase 2.0D (migration 20260820190000): activate XpBalance as a rebuildable XP projection (TD-145/146).
-- XPP-DB-01: nonempty projection version when present. XPP-DB-02: level floor 1 (no Level 0).
ALTER TABLE "xp_balance" ADD CONSTRAINT "chk_xp_balance_progression_version_nonempty" CHECK ("progression_version_code" IS NULL OR btrim("progression_version_code") <> '');
ALTER TABLE "xp_balance" ADD CONSTRAINT "chk_xp_balance_current_level_min" CHECK ("current_level" >= 1);

-- Phase 2.1B (migration 20260820200000): IZL wallet projection + reservation hold (TD-156/158). IZLLedgerEntry authority.
-- RES-DB-01/03: positive amount, nonempty idempotency. XPP-style: nonempty wallet projection version.
ALTER TABLE "izl_reservation" ADD CONSTRAINT "chk_izl_reservation_amount_positive" CHECK ("amount_izl" > 0);
ALTER TABLE "izl_reservation" ADD CONSTRAINT "chk_izl_reservation_idempotency_nonempty" CHECK (btrim("idempotency_key") <> '');
ALTER TABLE "izl_wallet" ADD CONSTRAINT "chk_izl_wallet_projection_version_nonempty" CHECK ("projection_version_code" IS NULL OR btrim("projection_version_code") <> '');
-- DROPPED (wallet is now a SIGNED rebuildable projection, TD-156/157 — must mirror negative canonical balance/available):
--   chk_wallet_balance_nonneg (balance >= 0), chk_wallet_reserved_le_balance (reserved <= balance).
--   chk_wallet_reserved_nonneg (reserved >= 0) is RETAINED.

-- Phase 2.1C-PO (migration 20260820210000): PaymentOrder subscription purchase intent (TD-167/170).
-- PO-DB-01: network idempotency — one order per (user, client_request_id) when present. (provider dropped NOT NULL, TD-168.)
CREATE UNIQUE INDEX "uq_payment_order_client_request" ON "payment_order" ("user_id", "client_request_id") WHERE "client_request_id" IS NOT NULL;

-- Phase 2.1C-2 (migration 20260820220000): PaymentOrder-bound subscription discount redemption intent (TD-175/174).
-- RD-DB-01: redemption idempotency. RD-DB-04: one OPEN SUBSCRIPTION_DISCOUNT redemption per PaymentOrder.
-- RD-DB-05: nonempty policy. RD-DB-06/07/08: positive amount/rate/value. (redemption.payment_order_id FK SetNull→Restrict;
-- reservation.redemption_id unique typed FK Restrict — izl_reservation_redemption_id_key, RD-DB-02/03, via Prisma.)
CREATE UNIQUE INDEX "uq_izl_redemption_client_request" ON "izl_redemption" ("user_id", "client_request_id") WHERE "client_request_id" IS NOT NULL;
CREATE UNIQUE INDEX "uq_izl_redemption_open_per_order" ON "izl_redemption" ("payment_order_id") WHERE "payment_order_id" IS NOT NULL AND "type" = 'SUBSCRIPTION_DISCOUNT' AND "status" IN ('REQUESTED', 'RESERVED');
ALTER TABLE "izl_redemption" ADD CONSTRAINT "chk_izl_redemption_policy_version_nonempty" CHECK ("policy_version_code" IS NULL OR btrim("policy_version_code") <> '');
ALTER TABLE "izl_redemption" ADD CONSTRAINT "chk_izl_redemption_amount_positive" CHECK ("amount_izl" > 0);
ALTER TABLE "izl_redemption" ADD CONSTRAINT "chk_izl_redemption_rate_positive" CHECK ("izl_rate_snapshot" > 0);
ALTER TABLE "izl_redemption" ADD CONSTRAINT "chk_izl_redemption_value_positive" CHECK ("value_uzs" > 0);

-- Phase 2.1D (migration 20260820230000): subscription discount commit / PaymentOrder binding (TD-178/180).
-- DC-DB-01: a non-null PaymentOrder.izl_redemption_id uniquely prices one order (no discount stacking).
CREATE UNIQUE INDEX "uq_payment_order_izl_redemption" ON "payment_order" ("izl_redemption_id") WHERE "izl_redemption_id" IS NOT NULL;

-- Phase 2.1E (migration 20260820240000): payment execution intent (TD-183/187).
-- PT-DB-01: attempt idempotency — one PaymentTransaction per (order, client_request_id) when present.
-- PT-DB-02: one PENDING attempt per order (a second concurrent provider is never started).
-- (provider_transaction_id dropped NOT NULL — internal PENDING attempt precedes external init; PT-DB-03 =
--  @@unique(provider, provider_transaction_id) via Prisma, NULLs distinct so many pending-no-id rows coexist.)
CREATE UNIQUE INDEX "uq_payment_transaction_client_request" ON "payment_transaction" ("payment_order_id", "client_request_id") WHERE "client_request_id" IS NOT NULL;
CREATE UNIQUE INDEX "uq_payment_transaction_pending" ON "payment_transaction" ("payment_order_id") WHERE "status" = 'PENDING';

-- Phase 2.1F (migration 20260820250000): verified payment evidence (TD-189/193).
-- PV-DB-01: at most one SUCCEEDED PaymentTransaction per PaymentOrder — one successful charge authority (§25/§26).
-- Callback dedup (F-19) = @@unique(provider, provider_event_id) via Prisma; external identity = @@unique(provider,
-- provider_transaction_id). No Prisma field change in this migration (confirmed_at / callback model already exist).
CREATE UNIQUE INDEX "uq_payment_transaction_succeeded" ON "payment_transaction" ("payment_order_id") WHERE "status" = 'SUCCEEDED';

-- Phase 2.1G-D (migration 20260821000000): finalization contract + schema hardening (TD-195/197/198/201).
-- FP-DB-01: PlanPrice billing duration is a positive number of calendar months (immutable commercial authority).
ALTER TABLE "plan_price" ADD CONSTRAINT "chk_plan_price_billing_period_positive" CHECK ("billing_period_months" > 0);
-- FP-DB-02/03: reward-config coherence. Reward-enabled ⟺ policy id + rate (rate > 0); reward-disabled ⟺ both NULL AND
-- zero monetary/IZL ceilings. (reward_policy_version_id + izl_rate_snapshot were made nullable in this migration.)
ALTER TABLE "subscription_cycle" ADD CONSTRAINT "chk_cycle_reward_config_coherent" CHECK (
  ("reward_policy_version_id" IS NOT NULL AND "izl_rate_snapshot" IS NOT NULL AND "izl_rate_snapshot" > 0)
  OR
  ("reward_policy_version_id" IS NULL AND "izl_rate_snapshot" IS NULL AND "reward_ceiling_uzs" = 0 AND "reward_ceiling_izl" = 0)
);
-- FP-DB-04: at most one REDEEM ledger entry per redemption (not a global redemption_id UNIQUE — future REVERSAL/
-- ADJUSTMENT audit entries may share the provenance). Also: ALTER TYPE "IzlReservationStatus" ADD VALUE 'CONSUMED'.
CREATE UNIQUE INDEX "uq_izl_ledger_redeem_per_redemption" ON "izl_ledger_entry" ("redemption_id") WHERE "redemption_id" IS NOT NULL AND "entry_type" = 'REDEEM';
