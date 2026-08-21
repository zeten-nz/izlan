-- Phase 2.1B — IZL Wallet projection + Reservation hold primitive (TD-156/157/158/159/160).
-- IZLLedgerEntry remains accounting authority. IZLWallet becomes a rebuildable signed projection; IZLReservation
-- is a new dedicated hold table (distinct from IZLRedemption, which is untouched).

-- CreateEnum
CREATE TYPE "IzlReservationStatus" AS ENUM ('ACTIVE', 'RELEASED');

-- AlterTable
ALTER TABLE "izl_wallet" ADD COLUMN     "projection_version_code" TEXT;

-- CreateTable
CREATE TABLE "izl_reservation" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "amount_izl" INTEGER NOT NULL,
    "status" "IzlReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "idempotency_key" TEXT NOT NULL,
    "purpose_code" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMP(3),

    CONSTRAINT "izl_reservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "izl_reservation_user_id_status_idx" ON "izl_reservation"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "izl_reservation_user_id_idempotency_key_key" ON "izl_reservation"("user_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "izl_reservation" ADD CONSTRAINT "izl_reservation_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Custom constraints (custom SQL)
-- ============================================================================

-- RES-DB-01: reservation amount strictly positive. RES-DB-03: idempotency key non-empty.
ALTER TABLE "izl_reservation" ADD CONSTRAINT "chk_izl_reservation_amount_positive" CHECK ("amount_izl" > 0);
ALTER TABLE "izl_reservation" ADD CONSTRAINT "chk_izl_reservation_idempotency_nonempty" CHECK (btrim("idempotency_key") <> '');

-- XPP-style: projection version snapshot non-empty when present.
ALTER TABLE "izl_wallet" ADD CONSTRAINT "chk_izl_wallet_projection_version_nonempty" CHECK ("projection_version_code" IS NULL OR btrim("projection_version_code") <> '');

-- IZLWallet is now a SIGNED rebuildable projection (TD-156/157): drop the live-spendable-balance invariants so the
-- cache can mirror a negative canonical balance / available (§41/§42/§43 — e.g. an accounting correction lowering
-- ledger below active reservations). reserved >= 0 is retained (ACTIVE reservation amounts are always positive).
ALTER TABLE "izl_wallet" DROP CONSTRAINT "chk_wallet_balance_nonneg";
ALTER TABLE "izl_wallet" DROP CONSTRAINT "chk_wallet_reserved_le_balance";
