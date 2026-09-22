ALTER TABLE "recovery_deliveries"
 ADD COLUMN "processing_at" TIMESTAMPTZ(3),
 ADD COLUMN "claim_id" UUID;
ALTER TABLE "recovery_deliveries" DROP CONSTRAINT "recovery_deliveries_status_check";
ALTER TABLE "recovery_deliveries" ADD CONSTRAINT "recovery_deliveries_status_check"
 CHECK ("status" IN ('PENDING','PROCESSING','SENT','FAILED','CANCELLED'));
CREATE INDEX "recovery_deliveries_status_processing_at_idx" ON "recovery_deliveries"("status","processing_at");
