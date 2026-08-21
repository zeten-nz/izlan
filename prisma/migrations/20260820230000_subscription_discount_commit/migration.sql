-- Phase 2.1D — Subscription discount commit / PaymentOrder binding (TD-178/180). Custom SQL only (izl_redemption_id
-- column already exists). A committed discount redemption prices exactly one concrete PaymentOrder.

-- DC-DB-01: a non-null PaymentOrder.izl_redemption_id uniquely points to one redemption (no discount stacking, §19).
CREATE UNIQUE INDEX "uq_payment_order_izl_redemption"
  ON "payment_order" ("izl_redemption_id")
  WHERE "izl_redemption_id" IS NOT NULL;
