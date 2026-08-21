-- Phase 2.1L-D — Real provider contract / persistence hardening (TD-233..239).
-- Durable, provider-specific protocol persistence for the FUTURE CLICK / Payme adapters. NOT economic authority:
-- core money truth stays in payment_transaction / payment_order / payment_callback_event / subscription / izl (§25).
-- NO real provider adapter, NO provider HTTP route, NO provider call, NO refund, NO PaymentTransaction terminal
-- transition, NO PaymentOrder / Subscription / IZL mutation are introduced by this migration.
--
-- Payme protocol facts are VERIFIED from developer.help.paycom.uz Merchant API docs (amount = tiyin; *_time = 13-digit
-- Unix ms; state ∈ {1,2,-1,-2}). CLICK Shop API native constants (sign_string formula, native field types, amount
-- format, error table, merchant_prepare_id format, merchant_trans_id UUID compatibility) remain UNVERIFIED from an
-- official current source (PROTOCOL VERIFICATION BLOCKER, §0) — the CLICK table is a provider-neutral shell that encodes
-- NO CLICK native constant and adds NO native-value CHECK; the real CLICK protocol is Phase 2.1L-C.

-- CreateEnum
CREATE TYPE "ClickProtocolPhaseState" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateTable
CREATE TABLE "payme_merchant_transaction" (
    "id" UUID NOT NULL,
    "payment_transaction_id" UUID NOT NULL,
    "payme_transaction_id" TEXT NOT NULL,
    "amount_tiyin" BIGINT NOT NULL,
    "account_snapshot" JSONB NOT NULL,
    "provider_created_time_ms" BIGINT NOT NULL,
    "create_time_ms" BIGINT NOT NULL,
    "perform_time_ms" BIGINT,
    "cancel_time_ms" BIGINT,
    "state" INTEGER NOT NULL,
    "reason" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payme_merchant_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "click_shop_transaction" (
    "id" UUID NOT NULL,
    "payment_transaction_id" UUID NOT NULL,
    "click_trans_id" TEXT,
    "click_paydoc_id" TEXT,
    "merchant_prepare_id" TEXT,
    "merchant_confirm_id" TEXT,
    "prepare_state" "ClickProtocolPhaseState" NOT NULL DEFAULT 'PENDING',
    "complete_state" "ClickProtocolPhaseState" NOT NULL DEFAULT 'PENDING',
    "prepared_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "click_shop_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payme_merchant_transaction_payment_transaction_id_key" ON "payme_merchant_transaction"("payment_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "payme_merchant_transaction_payme_transaction_id_key" ON "payme_merchant_transaction"("payme_transaction_id");

-- CreateIndex
CREATE INDEX "payme_merchant_transaction_provider_created_time_ms_idx" ON "payme_merchant_transaction"("provider_created_time_ms");

-- CreateIndex
CREATE UNIQUE INDEX "click_shop_transaction_payment_transaction_id_key" ON "click_shop_transaction"("payment_transaction_id");

-- AddForeignKey
ALTER TABLE "payme_merchant_transaction" ADD CONSTRAINT "payme_merchant_transaction_payment_transaction_id_fkey" FOREIGN KEY ("payment_transaction_id") REFERENCES "payment_transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "click_shop_transaction" ADD CONSTRAINT "click_shop_transaction_payment_transaction_id_fkey" FOREIGN KEY ("payment_transaction_id") REFERENCES "payment_transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Custom constraints (custom SQL) — Phase 2.1L-D provider protocol integrity
-- ============================================================================

-- Payme native state is one of the four documented Merchant API values (1 created, 2 performed, -1 cancelled-before,
-- -2 cancelled-after). -2 is allowed for forward compatibility but is never produced in 2.1L-D (future refund domain, §6/§7).
ALTER TABLE "payme_merchant_transaction" ADD CONSTRAINT "chk_payme_mt_state_valid" CHECK ("state" IN (1, 2, -1, -2));

-- Payme amount is a positive tiyin figure (verified unit); never JS-Number coerced (BigInt column).
ALTER TABLE "payme_merchant_transaction" ADD CONSTRAINT "chk_payme_mt_amount_positive" CHECK ("amount_tiyin" > 0);

-- Time fields must be coherent with the native state: perform_time_ms present ⟺ performed (2 or -2); cancel_time_ms
-- present ⟺ cancelled (-1 or -2). Guarantees GetStatement / CheckTransaction reconstruction integrity (§8/§23).
ALTER TABLE "payme_merchant_transaction" ADD CONSTRAINT "chk_payme_mt_time_coherent" CHECK (
  ("state" = 1  AND "perform_time_ms" IS NULL     AND "cancel_time_ms" IS NULL)
  OR ("state" = 2  AND "perform_time_ms" IS NOT NULL AND "cancel_time_ms" IS NULL)
  OR ("state" = -1 AND "perform_time_ms" IS NULL     AND "cancel_time_ms" IS NOT NULL)
  OR ("state" = -2 AND "perform_time_ms" IS NOT NULL AND "cancel_time_ms" IS NOT NULL)
);

-- A cancellation reason is preserved exactly for cancelled states and absent for active/performed states (§6/§23).
ALTER TABLE "payme_merchant_transaction" ADD CONSTRAINT "chk_payme_mt_reason_coherent" CHECK (
  ("state" IN (-1, -2) AND "reason" IS NOT NULL)
  OR ("state" IN (1, 2) AND "reason" IS NULL)
);

-- CLICK external transaction identity is unique when present (dedup); NULL until Prepare binds it (NULLs distinct).
CREATE UNIQUE INDEX "uq_click_shop_click_trans_id" ON "click_shop_transaction" ("click_trans_id") WHERE "click_trans_id" IS NOT NULL;

-- Izlan phase model (NOT a CLICK native constant): an ACCEPTED Complete requires an ACCEPTED Prepare first.
ALTER TABLE "click_shop_transaction" ADD CONSTRAINT "chk_click_shop_complete_requires_prepare" CHECK (
  NOT ("complete_state" = 'ACCEPTED' AND "prepare_state" <> 'ACCEPTED')
);
