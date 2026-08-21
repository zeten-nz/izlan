-- Phase 2.1F — Verified payment evidence (TD-189/193). PaymentTransaction.status = SUCCEEDED is the durable
-- trusted-success marker, produced only by adapter-verified provider callbacks. No Prisma field change
-- (confirmedAt / provider_transaction_id / payment_callback_event already exist) — custom SQL only.

-- ============================================================================
-- Custom constraints (custom SQL)
-- ============================================================================

-- PV-DB-01: at most one SUCCEEDED PaymentTransaction per PaymentOrder (one successful charge authority; §25/§26).
-- Historical multiple attempts remain possible; a second success is a financial integrity conflict.
CREATE UNIQUE INDEX "uq_payment_transaction_succeeded"
  ON "payment_transaction" ("payment_order_id")
  WHERE "status" = 'SUCCEEDED';
