ALTER TABLE "workflow_versions"
  ADD COLUMN "published_by_id" UUID,
  ADD COLUMN "change_note" VARCHAR(500),
  ADD COLUMN "structure_snapshot" JSONB NOT NULL DEFAULT '{}';
