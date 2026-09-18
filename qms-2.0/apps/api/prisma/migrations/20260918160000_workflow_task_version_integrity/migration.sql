ALTER TABLE "workflow_tasks"
  ADD COLUMN "workflow_version_id" UUID;

UPDATE "workflow_tasks" AS task
SET "workflow_version_id" = instance."workflow_version_id"
FROM "workflow_instances" AS instance
WHERE instance."organization_id" = task."organization_id"
  AND instance."id" = task."workflow_instance_id";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "workflow_tasks"
    WHERE "workflow_version_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'workflow_tasks.workflow_version_id could not be backfilled';
  END IF;
END $$;

ALTER TABLE "workflow_tasks"
  ALTER COLUMN "workflow_version_id" SET NOT NULL;

CREATE UNIQUE INDEX "workflow_instances_organization_id_workflow_version_id_id_key"
  ON "workflow_instances"("organization_id", "workflow_version_id", "id");

ALTER TABLE "workflow_tasks"
  DROP CONSTRAINT IF EXISTS "workflow_tasks_organization_id_workflow_instance_id_fkey",
  DROP CONSTRAINT IF EXISTS "workflow_tasks_organization_id_workflow_node_id_fkey";

ALTER TABLE "workflow_tasks"
  ADD CONSTRAINT "workflow_tasks_instance_version_fkey"
  FOREIGN KEY ("organization_id", "workflow_version_id", "workflow_instance_id")
  REFERENCES "workflow_instances"("organization_id", "workflow_version_id", "id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "workflow_tasks_node_version_fkey"
  FOREIGN KEY ("organization_id", "workflow_version_id", "workflow_node_id")
  REFERENCES "workflow_nodes"("organization_id", "workflow_version_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
