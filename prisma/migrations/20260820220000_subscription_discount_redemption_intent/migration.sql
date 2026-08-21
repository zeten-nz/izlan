-- Phase 2.1C-2 — PaymentOrder-bound subscription discount redemption intent (TD-172..177).
-- Binds IZLRedemption to a concrete PaymentOrder + a typed 1:1 ACTIVE IZLReservation. Reserve-only: no ledger
-- debit, no APPLIED, no reservation CONSUMED. IZLLedgerEntry remains the accounting authority.

-- DropForeignKey
ALTER TABLE "izl_redemption" DROP CONSTRAINT "izl_redemption_payment_order_id_fkey";

-- AlterTable
ALTER TABLE "izl_redemption" ADD COLUMN     "client_request_id" TEXT,
ADD COLUMN     "policy_version_code" TEXT;

-- AlterTable
ALTER TABLE "izl_reservation" ADD COLUMN     "redemption_id" UUID;

-- CreateIndex (typed 1:1 hold↔redemption — RD-DB-02/03)
CREATE UNIQUE INDEX "izl_reservation_redemption_id_key" ON "izl_reservation"("redemption_id");

-- AddForeignKey
ALTER TABLE "izl_reservation" ADD CONSTRAINT "izl_reservation_redemption_id_fkey" FOREIGN KEY ("redemption_id") REFERENCES "izl_redemption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey (PaymentOrder is load-bearing provenance — Restrict, was SetNull; TD-174)
ALTER TABLE "izl_redemption" ADD CONSTRAINT "izl_redemption_payment_order_id_fkey" FOREIGN KEY ("payment_order_id") REFERENCES "payment_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Custom constraints (custom SQL)
-- ============================================================================

-- RD-DB-01: network idempotency — one redemption per (user, client_request_id) when present (TD-175).
CREATE UNIQUE INDEX "uq_izl_redemption_client_request"
  ON "izl_redemption" ("user_id", "client_request_id")
  WHERE "client_request_id" IS NOT NULL;

-- RD-DB-04: one OPEN SUBSCRIPTION_DISCOUNT redemption per PaymentOrder (TD-175 §9).
CREATE UNIQUE INDEX "uq_izl_redemption_open_per_order"
  ON "izl_redemption" ("payment_order_id")
  WHERE "payment_order_id" IS NOT NULL AND "type" = 'SUBSCRIPTION_DISCOUNT' AND "status" IN ('REQUESTED', 'RESERVED');

-- RD-DB-05: policy version snapshot non-empty when present (producer always sets subscription-discount-redemption-v1).
ALTER TABLE "izl_redemption" ADD CONSTRAINT "chk_izl_redemption_policy_version_nonempty"
  CHECK ("policy_version_code" IS NULL OR btrim("policy_version_code") <> '');

-- RD-DB-06/07/08: positive economic snapshots (table is empty — safe global CHECKs).
ALTER TABLE "izl_redemption" ADD CONSTRAINT "chk_izl_redemption_amount_positive" CHECK ("amount_izl" > 0);
ALTER TABLE "izl_redemption" ADD CONSTRAINT "chk_izl_redemption_rate_positive" CHECK ("izl_rate_snapshot" > 0);
ALTER TABLE "izl_redemption" ADD CONSTRAINT "chk_izl_redemption_value_positive" CHECK ("value_uzs" > 0);
