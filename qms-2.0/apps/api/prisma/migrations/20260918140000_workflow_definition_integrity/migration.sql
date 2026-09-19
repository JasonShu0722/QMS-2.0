DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'workflow_versions'::regclass
      AND conname = 'workflow_versions_workflow_definition_id_fkey'
  ) THEN
    ALTER TABLE "workflow_versions" DROP CONSTRAINT "workflow_versions_workflow_definition_id_fkey";
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'workflow_versions'::regclass
      AND conname = 'workflow_versions_organization_id_workflow_definition_id_fkey'
  ) THEN
    ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_organization_id_workflow_definition_id_fkey"
      FOREIGN KEY ("organization_id", "workflow_definition_id") REFERENCES "workflow_definitions"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
