-- Phase 2.1E — Payment execution intent (TD-183/185/187). PaymentTransaction = provider execution attempt.
-- Internal PENDING attempt is persisted before the external provider call; no verified success / PAID here.

-- AlterTable (providerTransactionId nullable — attached after external init; +clientRequestId idempotency)
ALTER TABLE "payment_transaction" ADD COLUMN     "client_request_id" TEXT,
ALTER COLUMN "provider_transaction_id" DROP NOT NULL;

-- ============================================================================
-- Custom constraints (custom SQL)
-- ============================================================================

-- PT-DB-01: attempt idempotency — one transaction per (order, client_request_id) when present (TD-185).
CREATE UNIQUE INDEX "uq_payment_transaction_client_request"
  ON "payment_transaction" ("payment_order_id", "client_request_id")
  WHERE "client_request_id" IS NOT NULL;

-- PT-DB-02: at most one in-flight PENDING attempt per PaymentOrder (TD-184, §15) — prevents concurrent provider charges.
CREATE UNIQUE INDEX "uq_payment_transaction_pending"
  ON "payment_transaction" ("payment_order_id")
  WHERE "status" = 'PENDING';
