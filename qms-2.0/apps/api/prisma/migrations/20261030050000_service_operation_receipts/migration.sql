CREATE TABLE "service_operation_receipts" (
  "id" UUID NOT NULL,
  "identity_key" VARCHAR(160) NOT NULL,
  "scope_key" VARCHAR(40) NOT NULL,
  "operation" VARCHAR(20) NOT NULL,
  "domain_code" VARCHAR(32),
  "producer_id" UUID NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "started_at" TIMESTAMPTZ(3) NOT NULL,
  "completed_at" TIMESTAMPTZ(3),
  "observed_at" TIMESTAMPTZ(3) NOT NULL,
  "duration_ms" INTEGER,
  "processed" INTEGER,
  "retried" INTEGER,
  "failed" INTEGER,
  "reason_code" VARCHAR(50),
  CONSTRAINT "service_operation_receipts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "service_operation_receipts_identity_key_key" ON "service_operation_receipts"("identity_key");
CREATE INDEX "service_operation_receipts_scope_key_operation_observed_at_idx" ON "service_operation_receipts"("scope_key", "operation", "observed_at");
CREATE INDEX "service_operation_receipts_observed_at_id_idx" ON "service_operation_receipts"("observed_at", "id");
