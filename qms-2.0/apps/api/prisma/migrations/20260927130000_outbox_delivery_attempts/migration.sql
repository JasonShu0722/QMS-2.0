CREATE TABLE "outbox_delivery_attempts" (
    "id" UUID NOT NULL,
    "outbox_event_id" UUID NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "outcome" VARCHAR(32) NOT NULL,
    "reason_code" VARCHAR(64),
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retry_at" TIMESTAMPTZ(3),
    CONSTRAINT "outbox_delivery_attempts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "outbox_delivery_attempts_outbox_event_id_fkey" FOREIGN KEY ("outbox_event_id") REFERENCES "outbox_events"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "outbox_delivery_attempts_event_occurred_idx" ON "outbox_delivery_attempts"("outbox_event_id", "occurred_at", "id");
