CREATE TABLE customer_quality_customers (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  code varchar(100) NOT NULL CHECK (length(trim(code)) > 0),
  name varchar(200) NOT NULL CHECK (length(trim(name)) > 0),
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL,
  UNIQUE (organization_id, code),
  UNIQUE (organization_id, id)
);

CREATE TABLE customer_quality_complaints (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  complaint_number varchar(80) NOT NULL,
  customer_id uuid NOT NULL,
  complaint_type varchar(20) NOT NULL CHECK (complaint_type IN ('ZERO_KM', 'AFTER_SALES')),
  terminal_customer_name varchar(200),
  product_code varchar(100),
  product_model varchar(100),
  defect_description text NOT NULL CHECK (length(trim(defect_description)) BETWEEN 1 AND 10000),
  vin varchar(100),
  mileage integer CHECK (mileage IS NULL OR mileage >= 0),
  purchase_date date,
  return_required boolean NOT NULL DEFAULT false,
  physical_analysis_required boolean NOT NULL DEFAULT false,
  severity varchar(32) NOT NULL CHECK (length(trim(severity)) BETWEEN 1 AND 32),
  severity_policy_version varchar(100) NOT NULL CHECK (length(trim(severity_policy_version)) BETWEEN 1 AND 100),
  severity_snapshot jsonb NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_ANALYSIS', 'RESOLVED', 'ARCHIVED')),
  external_source_system varchar(32) CHECK (external_source_system IS NULL OR external_source_system IN ('ERP', 'SAP', 'IMS')),
  external_record_key varchar(200),
  source_observed_at timestamptz(3),
  ingestion_status varchar(32) CHECK (ingestion_status IS NULL OR ingestion_status = 'PENDING_VERIFICATION'),
  problem_index_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  archived_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL,
  FOREIGN KEY (organization_id, customer_id) REFERENCES customer_quality_customers(organization_id, id) ON DELETE RESTRICT,
  CHECK (complaint_type <> 'AFTER_SALES' OR (length(trim(coalesce(vin, ''))) > 0 AND mileage IS NOT NULL AND purchase_date IS NOT NULL)),
  CHECK ((external_source_system IS NULL AND external_record_key IS NULL AND source_observed_at IS NULL AND ingestion_status IS NULL)
    OR (external_source_system IS NOT NULL AND length(trim(coalesce(external_record_key, ''))) > 0 AND source_observed_at IS NOT NULL AND ingestion_status = 'PENDING_VERIFICATION')),
  UNIQUE (organization_id, complaint_number),
  UNIQUE (organization_id, id)
);
CREATE UNIQUE INDEX customer_quality_complaints_external_identity_uq ON customer_quality_complaints(organization_id, external_source_system, external_record_key) WHERE external_source_system IS NOT NULL;
CREATE INDEX customer_quality_complaints_org_status_created_idx ON customer_quality_complaints(organization_id, status, created_at DESC);

CREATE TABLE customer_quality_ingestion_audits (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  complaint_id uuid NOT NULL,
  external_source_system varchar(32) NOT NULL,
  external_record_key varchar(200) NOT NULL,
  status varchar(32) NOT NULL CHECK (status = 'PENDING_VERIFICATION'),
  observed_at timestamptz(3) NOT NULL,
  recorded_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id, complaint_id) REFERENCES customer_quality_complaints(organization_id, id) ON DELETE RESTRICT
);

CREATE TABLE customer_quality_physical_dispositions (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  complaint_id uuid NOT NULL,
  action varchar(32) NOT NULL CHECK (action IN ('RETURN', 'REPAIR', 'SCRAP', 'NO_RETURN', 'OTHER')),
  status varchar(32) NOT NULL CHECK (status IN ('PENDING', 'RECEIVED', 'REPAIRED', 'SCRAPPED', 'CLOSED')),
  responsibility varchar(200),
  notes text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL,
  FOREIGN KEY (organization_id, complaint_id) REFERENCES customer_quality_complaints(organization_id, id) ON DELETE RESTRICT
);

CREATE TABLE customer_quality_physical_analyses (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  complaint_id uuid NOT NULL,
  summary text NOT NULL CHECK (length(trim(summary)) BETWEEN 1 AND 10000),
  status varchar(32) NOT NULL CHECK (status IN ('MISSING', 'IN_PROGRESS', 'COMPLETED')),
  evidence_summary text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL,
  FOREIGN KEY (organization_id, complaint_id) REFERENCES customer_quality_complaints(organization_id, id) ON DELETE RESTRICT
);

INSERT INTO permissions(id, code, name) VALUES
  (gen_random_uuid(), 'customer-quality:complaints:read', '查看客户客诉台账'),
  (gen_random_uuid(), 'customer-quality:complaints:write', '维护客户客诉台账')
ON CONFLICT (code) DO NOTHING;
