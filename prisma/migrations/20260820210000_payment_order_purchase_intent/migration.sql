-- Phase 2.1C-PO — PaymentOrder subscription purchase intent (TD-167/168/170).
-- PaymentOrder becomes the provider-agnostic internal purchase authority; PaymentTransaction remains provider
-- execution authority. No pricing/discount/payable semantics change.

-- AlterTable (provider nullable — TD-168)
ALTER TABLE "payment_order" ALTER COLUMN "provider" DROP NOT NULL;

-- ============================================================================
-- Custom constraints (custom SQL)
-- ============================================================================

-- PO-DB-01: network idempotency — one order per (user, client_request_id) when present (TD-170).
CREATE UNIQUE INDEX "uq_payment_order_client_request"
  ON "payment_order" ("user_id", "client_request_id")
  WHERE "client_request_id" IS NOT NULL;
