ALTER TABLE "outbox_events" ADD COLUMN "processing_at" TIMESTAMPTZ(3);

-- Recover claims created before leases existed on the first upgraded worker run.
UPDATE "outbox_events" SET "processing_at" = '-infinity'::timestamptz
WHERE "status" = 'PROCESSING';

CREATE INDEX "outbox_events_status_processing_at_idx"
ON "outbox_events"("status", "processing_at");
