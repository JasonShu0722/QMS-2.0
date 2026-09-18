DROP INDEX IF EXISTS "problem_indexes_organization_id_source_type_source_id_idx";
CREATE UNIQUE INDEX "problem_indexes_organization_id_source_type_source_id_key"
  ON "problem_indexes"("organization_id", "source_type", "source_id")
  WHERE "source_id" IS NOT NULL;

CREATE UNIQUE INDEX "users_organization_id_id_key" ON "users"("organization_id", "id");
CREATE UNIQUE INDEX "workflow_definitions_organization_id_id_key" ON "workflow_definitions"("organization_id", "id");
CREATE UNIQUE INDEX "workflow_versions_organization_id_id_key" ON "workflow_versions"("organization_id", "id");
CREATE UNIQUE INDEX "workflow_nodes_organization_id_id_key" ON "workflow_nodes"("organization_id", "id");
CREATE UNIQUE INDEX "workflow_transitions_organization_id_id_key" ON "workflow_transitions"("organization_id", "id");
CREATE UNIQUE INDEX "workflow_instances_organization_id_id_key" ON "workflow_instances"("organization_id", "id");
CREATE UNIQUE INDEX "workflow_tasks_organization_id_id_key" ON "workflow_tasks"("organization_id", "id");
CREATE UNIQUE INDEX "workflow_instances_organization_id_workflow_definition_id_v_key"
  ON "workflow_instances"("organization_id", "workflow_definition_id", "version");

ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_workflow_task_id_fkey";
ALTER TABLE "problem_indexes" DROP CONSTRAINT IF EXISTS "problem_indexes_workflow_instance_id_fkey";
ALTER TABLE "workflow_instances" DROP CONSTRAINT IF EXISTS "workflow_instances_current_node_id_fkey";
ALTER TABLE "workflow_instances" DROP CONSTRAINT IF EXISTS "workflow_instances_workflow_definition_id_fkey";
ALTER TABLE "workflow_instances" DROP CONSTRAINT IF EXISTS "workflow_instances_workflow_version_id_fkey";
ALTER TABLE "workflow_versions" DROP CONSTRAINT IF EXISTS "workflow_versions_workflow_definition_id_fkey";
ALTER TABLE "workflow_nodes" DROP CONSTRAINT IF EXISTS "workflow_nodes_workflow_version_id_fkey";
ALTER TABLE "workflow_tasks" DROP CONSTRAINT IF EXISTS "workflow_tasks_workflow_instance_id_fkey";
ALTER TABLE "workflow_tasks" DROP CONSTRAINT IF EXISTS "workflow_tasks_workflow_node_id_fkey";
ALTER TABLE "workflow_transitions" DROP CONSTRAINT IF EXISTS "workflow_transitions_from_node_id_fkey";
ALTER TABLE "workflow_transitions" DROP CONSTRAINT IF EXISTS "workflow_transitions_to_node_id_fkey";
ALTER TABLE "workflow_transitions" DROP CONSTRAINT IF EXISTS "workflow_transitions_workflow_version_id_fkey";

ALTER TABLE "problem_indexes" ADD CONSTRAINT "problem_indexes_organization_id_owner_id_fkey"
  FOREIGN KEY ("organization_id", "owner_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "problem_indexes" ADD CONSTRAINT "problem_indexes_organization_id_workflow_instance_id_fkey"
  FOREIGN KEY ("organization_id", "workflow_instance_id") REFERENCES "workflow_instances"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_nodes" ADD CONSTRAINT "workflow_nodes_organization_id_workflow_version_id_fkey"
  FOREIGN KEY ("organization_id", "workflow_version_id") REFERENCES "workflow_versions"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_organization_id_workflow_definition_id_fkey"
  FOREIGN KEY ("organization_id", "workflow_definition_id") REFERENCES "workflow_definitions"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_organization_id_workflow_version_id_fkey"
  FOREIGN KEY ("organization_id", "workflow_version_id") REFERENCES "workflow_versions"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_organization_id_from_node_id_fkey"
  FOREIGN KEY ("organization_id", "from_node_id") REFERENCES "workflow_nodes"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_organization_id_to_node_id_fkey"
  FOREIGN KEY ("organization_id", "to_node_id") REFERENCES "workflow_nodes"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_organization_id_workflow_definition_id_fkey"
  FOREIGN KEY ("organization_id", "workflow_definition_id") REFERENCES "workflow_definitions"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_organization_id_workflow_version_id_fkey"
  FOREIGN KEY ("organization_id", "workflow_version_id") REFERENCES "workflow_versions"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_organization_id_current_node_id_fkey"
  FOREIGN KEY ("organization_id", "current_node_id") REFERENCES "workflow_nodes"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_organization_id_assignee_user_id_fkey"
  FOREIGN KEY ("organization_id", "assignee_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_organization_id_workflow_instance_id_fkey"
  FOREIGN KEY ("organization_id", "workflow_instance_id") REFERENCES "workflow_instances"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_organization_id_workflow_node_id_fkey"
  FOREIGN KEY ("organization_id", "workflow_node_id") REFERENCES "workflow_nodes"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_recipient_user_id_fkey"
  FOREIGN KEY ("organization_id", "recipient_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_workflow_task_id_fkey"
  FOREIGN KEY ("organization_id", "workflow_task_id") REFERENCES "workflow_tasks"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
