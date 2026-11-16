ALTER TABLE integration_ingestion_rules DROP CONSTRAINT integration_ingestion_rules_target_check;
ALTER TABLE integration_ingestion_rules ADD CONSTRAINT integration_ingestion_rules_target_check
  CHECK (target IN ('SUPPLIER', 'CUSTOMER', 'MATERIAL', 'COMPONENT', 'PROCESS_DEFECT'));

ALTER TABLE process_defects
  ADD COLUMN completion_next_attempt_at timestamptz(3),
  ADD COLUMN completion_attempts integer NOT NULL DEFAULT 0;
CREATE INDEX process_defects_completion_due_idx ON process_defects(completion_next_attempt_at, organization_id, id)
  WHERE pending_configuration AND archived_at IS NULL AND registration_version = 1;
