CREATE UNIQUE INDEX "workflow_nodes_organization_id_workflow_version_id_id_key"
  ON "workflow_nodes"("organization_id", "workflow_version_id", "id");

ALTER TABLE "workflow_instances"
  DROP CONSTRAINT IF EXISTS "workflow_instances_organization_id_current_node_id_fkey";

ALTER TABLE "workflow_transitions"
  DROP CONSTRAINT IF EXISTS "workflow_transitions_organization_id_from_node_id_fkey",
  DROP CONSTRAINT IF EXISTS "workflow_transitions_organization_id_to_node_id_fkey";

ALTER TABLE "workflow_instances"
  ADD CONSTRAINT "workflow_instances_organization_id_workflow_version_id_current_node_id_fkey"
  FOREIGN KEY ("organization_id", "workflow_version_id", "current_node_id")
  REFERENCES "workflow_nodes"("organization_id", "workflow_version_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workflow_transitions"
  ADD CONSTRAINT "workflow_transitions_organization_id_workflow_version_id_from_node_id_fkey"
  FOREIGN KEY ("organization_id", "workflow_version_id", "from_node_id")
  REFERENCES "workflow_nodes"("organization_id", "workflow_version_id", "id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "workflow_transitions_organization_id_workflow_version_id_to_node_id_fkey"
  FOREIGN KEY ("organization_id", "workflow_version_id", "to_node_id")
  REFERENCES "workflow_nodes"("organization_id", "workflow_version_id", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
