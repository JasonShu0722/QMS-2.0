CREATE TABLE "api_observation_buckets" (
  "id" UUID NOT NULL,
  "minute" TIMESTAMPTZ(3) NOT NULL,
  "scope_key" VARCHAR(40) NOT NULL,
  "method" VARCHAR(8) NOT NULL,
  "route" VARCHAR(200) NOT NULL,
  "status_class" INTEGER NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "duration_total" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "duration_max" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "le50" INTEGER NOT NULL DEFAULT 0,
  "le200" INTEGER NOT NULL DEFAULT 0,
  "le1000" INTEGER NOT NULL DEFAULT 0,
  "le5000" INTEGER NOT NULL DEFAULT 0,
  "gt5000" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "api_observation_buckets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "api_observation_bucket_dimensions_key"
  ON "api_observation_buckets"("minute", "scope_key", "method", "route", "status_class");
CREATE INDEX "api_observation_buckets_scope_key_minute_idx" ON "api_observation_buckets"("scope_key", "minute");
CREATE INDEX "api_observation_buckets_minute_idx" ON "api_observation_buckets"("minute");

CREATE TABLE "api_observation_collectors" (
  "producer_id" UUID NOT NULL,
  "started_at" TIMESTAMPTZ(3) NOT NULL,
  "last_flushed_at" TIMESTAMPTZ(3),
  "last_failure_at" TIMESTAMPTZ(3),
  "dropped" INTEGER NOT NULL DEFAULT 0,
  "failures" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "api_observation_collectors_pkey" PRIMARY KEY ("producer_id")
);
CREATE INDEX "api_observation_collectors_updated_at_idx" ON "api_observation_collectors"("updated_at");
