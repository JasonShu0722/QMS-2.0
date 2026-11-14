CREATE INDEX integration_ingestion_planner_parents
  ON integration_ingestion_jobs(organization_id,id)
  WHERE parent_job_id IS NULL AND planning_preview_id IS NOT NULL;
