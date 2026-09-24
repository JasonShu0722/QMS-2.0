CREATE TABLE process_defect_types (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  code varchar(64) NOT NULL CHECK (length(trim(code)) > 0),
  name varchar(200) NOT NULL CHECK (length(trim(name)) > 0),
  active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL,
  UNIQUE (organization_id, code), UNIQUE (organization_id, id)
);

CREATE TABLE process_defects (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  defect_type_code varchar(64) NOT NULL,
  description text NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 10000),
  defect_quantity integer NOT NULL CHECK (defect_quantity > 0),
  occurred_at timestamptz(3) NOT NULL,
  batch_code varchar(100), work_order_code varchar(100), operation_code varchar(100), line_code varchar(100),
  project_code varchar(100), product_code varchar(100), material_code varchar(100),
  supplier_organization_id uuid REFERENCES organizations(id) ON DELETE RESTRICT,
  responsibility_category varchar(32) NOT NULL CHECK (responsibility_category IN ('MATERIAL','OPERATION','EQUIPMENT','PROCESS','DESIGN')),
  source_kind varchar(32) NOT NULL DEFAULT 'MANUAL' CHECK (source_kind = 'MANUAL'),
  external_source_system varchar(64) CHECK (external_source_system IS NULL OR external_source_system IN ('MES', 'IMS')),
  external_record_key varchar(200) CHECK (external_record_key IS NULL OR length(trim(external_record_key)) > 0),
  source_observed_at timestamptz(3),
  ingestion_status varchar(32) CHECK (ingestion_status IS NULL OR ingestion_status = 'PENDING_VERIFICATION'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  archived_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL,
  FOREIGN KEY (organization_id, defect_type_code) REFERENCES process_defect_types(organization_id, code) ON DELETE RESTRICT,
  CHECK ((external_source_system IS NULL AND external_record_key IS NULL AND source_observed_at IS NULL AND ingestion_status IS NULL)
    OR (external_source_system IS NOT NULL AND external_record_key IS NOT NULL AND source_observed_at IS NOT NULL AND ingestion_status = 'PENDING_VERIFICATION')),
  UNIQUE (organization_id, external_source_system, external_record_key),
  UNIQUE (organization_id, id)
);
CREATE INDEX process_defects_organization_id_archived_at_occurred_at_idx ON process_defects(organization_id, archived_at, occurred_at);
CREATE INDEX process_defects_organization_id_batch_code_work_order_code_idx ON process_defects(organization_id, batch_code, work_order_code);
CREATE INDEX process_defects_organization_id_project_code_product_code_idx ON process_defects(organization_id, project_code, product_code);

CREATE TABLE process_defect_ingestion_audits (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, defect_id uuid NOT NULL,
  external_source_system varchar(64) NOT NULL, external_record_key varchar(200) NOT NULL,
  status varchar(32) NOT NULL CHECK (status = 'PENDING_VERIFICATION'),
  observed_at timestamptz(3), recorded_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id, defect_id) REFERENCES process_defects(organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX process_defect_ingestion_audits_organization_id_defect_id_created_at_idx
  ON process_defect_ingestion_audits(organization_id, defect_id, created_at);

INSERT INTO permissions(id, code, name) VALUES
  (gen_random_uuid(), 'process-quality:defects:read', '查看制程不良品台账'),
  (gen_random_uuid(), 'process-quality:defects:write', '维护制程不良品台账')
ON CONFLICT (code) DO NOTHING;
