CREATE UNIQUE INDEX "workflow_versions_one_draft_per_definition_key"
  ON "workflow_versions" ("workflow_definition_id")
  WHERE "status" = 'DRAFT';
