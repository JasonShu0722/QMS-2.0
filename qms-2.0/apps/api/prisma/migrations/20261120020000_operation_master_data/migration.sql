BEGIN;

CREATE TABLE process_operation_master (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  operation_code varchar(100) NOT NULL CHECK (length(btrim(operation_code)) > 0),
  operation_name varchar(200) NOT NULL CHECK (length(btrim(operation_name)) > 0),
  manual_name_changed_at timestamptz(3),
  sector_name varchar(200) CHECK (length(btrim(sector_name)) > 0),
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, operation_code)
);
CREATE INDEX process_operation_master_name_idx ON process_operation_master (organization_id, operation_name);

ALTER TABLE integration_ingestion_rules DROP CONSTRAINT integration_ingestion_rules_target_check;
ALTER TABLE integration_ingestion_rules ADD CONSTRAINT integration_ingestion_rules_target_check
  CHECK (target IN ('SUPPLIER', 'CUSTOMER', 'MATERIAL', 'COMPONENT', 'OPERATION', 'PROCESS_DEFECT'));

COMMIT;
