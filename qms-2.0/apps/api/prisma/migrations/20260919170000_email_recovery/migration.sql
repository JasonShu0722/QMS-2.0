ALTER TABLE "users" ADD COLUMN "email_verified_at" TIMESTAMPTZ(3);
CREATE TABLE "email_verifications" (
 "id" UUID PRIMARY KEY, "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
 "purpose" VARCHAR(32) NOT NULL CHECK ("purpose" IN ('VERIFY_EMAIL','PASSWORD_RECOVERY')),
 "email" VARCHAR(254) NOT NULL, "security_version" INTEGER NOT NULL,
 "token_hash" CHAR(64) NOT NULL UNIQUE, "expires_at" TIMESTAMPTZ(3) NOT NULL,
 "consumed_at" TIMESTAMPTZ(3), "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "email_verifications_user_id_purpose_created_at_idx" ON "email_verifications"("user_id","purpose","created_at");
CREATE TABLE "recovery_deliveries" (
 "id" UUID PRIMARY KEY, "verification_id" UUID NOT NULL UNIQUE REFERENCES "email_verifications"("id") ON DELETE CASCADE,
 "encrypted_payload" TEXT, "key_id" VARCHAR(100) NOT NULL,
 "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','SENT','FAILED','CANCELLED')),
 "attempts" INTEGER NOT NULL DEFAULT 0, "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "sent_at" TIMESTAMPTZ(3), "last_error" VARCHAR(64), "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "recovery_deliveries_status_available_at_idx" ON "recovery_deliveries"("status","available_at");
CREATE FUNCTION invalidate_email_credentials() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.email IS DISTINCT FROM OLD.email THEN
  NEW.email_verified_at := NULL;
  UPDATE email_verifications SET consumed_at = CURRENT_TIMESTAMP WHERE user_id = NEW.id AND consumed_at IS NULL;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER users_email_credentials BEFORE UPDATE OF email ON users FOR EACH ROW EXECUTE FUNCTION invalidate_email_credentials();
