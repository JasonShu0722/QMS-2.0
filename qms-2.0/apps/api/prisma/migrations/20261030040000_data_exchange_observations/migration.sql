CREATE TABLE "data_exchange_attempts" (
  "id" UUID NOT NULL,
  "scope_key" VARCHAR(40) NOT NULL,
  "source_key" VARCHAR(64) NOT NULL,
  "attempt_key" VARCHAR(64) NOT NULL,
  "direction" VARCHAR(8) NOT NULL,
  "object_type" VARCHAR(48) NOT NULL,
  "level" VARCHAR(8) NOT NULL,
  "correlation_id" VARCHAR(80) NOT NULL,
  "batch_id" VARCHAR(80),
  "record_id" VARCHAR(80),
  "attempt_number" INTEGER NOT NULL,
  "idempotency_key_hash" VARCHAR(64) NOT NULL,
  "stages" JSONB NOT NULL,
  "started_at" TIMESTAMPTZ(3) NOT NULL,
  "observed_at" TIMESTAMPTZ(3) NOT NULL,
  "finished_at" TIMESTAMPTZ(3),
  CONSTRAINT "data_exchange_attempts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "data_exchange_attempt_identity_key" ON "data_exchange_attempts"("source_key", "scope_key", "attempt_key");
CREATE INDEX "data_exchange_attempts_scope_key_observed_at_id_idx" ON "data_exchange_attempts"("scope_key", "observed_at", "id");
CREATE INDEX "data_exchange_attempts_observed_at_id_idx" ON "data_exchange_attempts"("observed_at", "id");
CREATE INDEX "data_exchange_attempt_batch_idx" ON "data_exchange_attempts"("scope_key", "source_key", "batch_id", "observed_at");

CREATE TABLE "data_exchange_receipts" (
  "id" UUID NOT NULL,
  "scope_key" VARCHAR(40) NOT NULL,
  "source_key" VARCHAR(64) NOT NULL,
  "event_key_hash" VARCHAR(64) NOT NULL,
  "input_hash" VARCHAR(64) NOT NULL,
  "attempt_id" UUID NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "data_exchange_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "data_exchange_receipts_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "data_exchange_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "data_exchange_receipt_identity_key" ON "data_exchange_receipts"("source_key", "scope_key", "event_key_hash");
CREATE INDEX "data_exchange_receipts_attempt_id_idx" ON "data_exchange_receipts"("attempt_id");
