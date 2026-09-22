DROP INDEX "workflow_instances_organization_id_workflow_definition_id_v_key";
CREATE INDEX "workflow_instances_organization_id_workflow_definition_id_ver_idx"
  ON "workflow_instances"("organization_id", "workflow_definition_id", "version");

ALTER TABLE "workflow_mutations" ADD COLUMN "workflow_version_id" UUID;
UPDATE "workflow_mutations" AS mutation
SET "workflow_version_id" = instance."workflow_version_id"
FROM "workflow_instances" AS instance
WHERE mutation."instance_id" = instance."id";
ALTER TABLE "workflow_mutations"
  ALTER COLUMN "workflow_version_id" SET NOT NULL,
  ADD CONSTRAINT "workflow_mutations_instance_version_fkey"
    FOREIGN KEY ("organization_id", "workflow_version_id", "instance_id")
    REFERENCES "workflow_instances"("organization_id", "workflow_version_id", "id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "workflow_mutations_node_version_fkey"
    FOREIGN KEY ("organization_id", "workflow_version_id", "node_id")
    REFERENCES "workflow_nodes"("organization_id", "workflow_version_id", "id")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "workflow_mutations_action_allowed"
    CHECK ("action" IN ('START', 'SUBMIT', 'APPROVE', 'VERIFY', 'REJECT', 'RETURN', 'REOPEN', 'CLOSE'));
