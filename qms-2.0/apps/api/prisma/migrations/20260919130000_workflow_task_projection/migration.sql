ALTER TABLE "workflow_instances"
  ADD COLUMN "task_projection_version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "workflow_tasks"
  ADD COLUMN "entry_instance_version" INTEGER,
  ADD COLUMN "entered_at" TIMESTAMPTZ(3);

WITH legacy AS (
  SELECT "id", -ROW_NUMBER() OVER (
    PARTITION BY "workflow_instance_id" ORDER BY "created_at", "id"
  ) AS entry_version FROM "workflow_tasks"
)
UPDATE "workflow_tasks" AS task
SET "entry_instance_version" = legacy.entry_version,
    "entered_at" = task."created_at"
FROM legacy WHERE legacy."id" = task."id";

ALTER TABLE "workflow_tasks"
  ALTER COLUMN "entry_instance_version" SET NOT NULL,
  ALTER COLUMN "entry_instance_version" SET DEFAULT 0,
  ALTER COLUMN "entered_at" SET NOT NULL,
  ALTER COLUMN "entered_at" SET DEFAULT CURRENT_TIMESTAMP;

DROP INDEX "workflow_tasks_workflow_instance_id_workflow_node_id_key";
CREATE UNIQUE INDEX "workflow_tasks_workflow_instance_id_entry_instance_version_key"
  ON "workflow_tasks"("workflow_instance_id", "entry_instance_version");

ALTER TABLE "notifications" ADD COLUMN "deduplication_key" VARCHAR(200);
UPDATE "notifications" SET "deduplication_key" = 'legacy:' || "id"::text;
ALTER TABLE "notifications" ALTER COLUMN "deduplication_key" SET NOT NULL;
CREATE UNIQUE INDEX "notifications_deduplication_key_key" ON "notifications"("deduplication_key");
