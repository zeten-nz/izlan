-- Phase 2.2C — Auth amendment (TD-252): phone + password primary login.
-- ONE new table for the authentication secret, kept OUT of the User identity row (future Passkey/TOTP stays clean).
-- Stores ONLY the Argon2id encoded hash (algorithm/params/salt embedded by the hasher). Existing users have NO row
-- (they were OTP-only) — no password hash is fabricated for them; they must establish/reset a password to log in.
-- No destructive change to app_user or any other table. No CHECK / partial-unique SQL required.

-- CreateTable
CREATE TABLE "password_credential" (
    "user_id" UUID NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "password_credential_pkey" PRIMARY KEY ("user_id")
);

-- AddForeignKey
ALTER TABLE "password_credential" ADD CONSTRAINT "password_credential_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
