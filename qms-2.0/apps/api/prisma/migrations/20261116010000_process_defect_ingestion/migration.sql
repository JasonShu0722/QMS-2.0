ALTER TABLE process_defects
  ADD COLUMN operation_name varchar(200),
  ADD COLUMN line_name varchar(200),
  ADD COLUMN shift varchar(8) CHECK (shift IN ('DAY', 'NIGHT')),
  ADD COLUMN registration_version integer,
  ADD COLUMN registration_issues text[] NOT NULL DEFAULT '{}',
  ADD COLUMN pending_completion boolean NOT NULL DEFAULT false,
  ADD COLUMN pending_configuration boolean NOT NULL DEFAULT false,
  ADD COLUMN project_snapshot jsonb,
  ADD COLUMN product_subcategory varchar(100),
  ADD COLUMN subcategory_snapshot jsonb,
  ADD COLUMN operation_sector varchar(200),
  ADD COLUMN sector_snapshot jsonb,
  ADD COLUMN source_receipt_id uuid,
  ADD COLUMN source_row_index integer,
  ADD COLUMN manual_fields text[] NOT NULL DEFAULT '{}';

ALTER TABLE process_defects DROP CONSTRAINT process_defects_source_kind_check;
ALTER TABLE process_defects ADD CONSTRAINT process_defects_source_kind_check CHECK (source_kind IN ('MANUAL', 'IMS'));

DO $$ DECLARE constraint_name text;
BEGIN
  FOR constraint_name IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'process_defects'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%external_source_system IS NULL%'
  LOOP EXECUTE format('ALTER TABLE process_defects DROP CONSTRAINT %I', constraint_name); END LOOP;
END $$;

ALTER TABLE process_defects ADD CONSTRAINT process_defects_source_identity_check CHECK (
  (source_kind = 'IMS' AND external_source_system = 'IMS' AND source_receipt_id IS NOT NULL AND source_row_index >= 0)
  OR (source_kind = 'MANUAL' AND ((external_source_system IS NULL AND external_record_key IS NULL AND source_observed_at IS NULL AND ingestion_status IS NULL)
    OR (external_source_system IS NOT NULL AND external_record_key IS NOT NULL AND source_observed_at IS NOT NULL AND ingestion_status = 'PENDING_VERIFICATION')))
);
CREATE UNIQUE INDEX process_defects_receipt_row_key ON process_defects(organization_id, source_receipt_id, source_row_index);
CREATE INDEX process_defects_pending_configuration_idx ON process_defects(organization_id, updated_at, id)
  WHERE pending_configuration AND archived_at IS NULL AND registration_version = 1;

CREATE TABLE process_operation_sectors (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  operation_name varchar(200) NOT NULL CHECK (length(btrim(operation_name)) > 0),
  sector_name varchar(200) NOT NULL CHECK (length(btrim(sector_name)) > 0),
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, operation_name)
);

CREATE TABLE process_defect_registration_history (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  defect_id uuid NOT NULL,
  defect_version integer NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  action varchar(32) NOT NULL,
  before_facts jsonb,
  after_facts jsonb NOT NULL,
  recorded_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id, defect_id) REFERENCES process_defects(organization_id, id) ON DELETE RESTRICT,
  UNIQUE(defect_id, defect_version)
);
