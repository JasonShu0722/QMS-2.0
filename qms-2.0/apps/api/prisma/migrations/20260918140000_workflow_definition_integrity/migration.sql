ALTER TABLE "workflow_versions" DROP CONSTRAINT IF EXISTS "workflow_versions_workflow_definition_id_fkey";
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_organization_id_workflow_definition_id_fkey"
  FOREIGN KEY ("organization_id", "workflow_definition_id") REFERENCES "workflow_definitions"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
