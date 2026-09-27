CREATE TABLE process_shipment_report_evidence_refs (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  report_id uuid NOT NULL,
  file_id uuid NOT NULL REFERENCES file_objects(id) ON DELETE RESTRICT,
  file_version integer NOT NULL CHECK (file_version > 0),
  sha256 char(64) NOT NULL,
  scanned_at timestamptz(3) NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  created_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id, report_id) REFERENCES process_shipment_reports(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, report_id, file_id),
  UNIQUE (organization_id, report_id, position)
);
CREATE INDEX process_shipment_report_evidence_report_idx ON process_shipment_report_evidence_refs(organization_id, report_id, position);

CREATE TABLE process_shipment_report_customers (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  report_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  customer_version integer NOT NULL CHECK (customer_version > 0),
  customer_code varchar(100) NOT NULL,
  customer_name varchar(200) NOT NULL,
  created_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id, report_id) REFERENCES process_shipment_reports(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, report_id, customer_id)
);
CREATE INDEX process_shipment_report_customers_report_idx ON process_shipment_report_customers(organization_id, report_id);

CREATE TABLE process_shipment_report_issues (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  report_id uuid NOT NULL,
  problem_id uuid NOT NULL,
  problem_version integer NOT NULL CHECK (problem_version > 0),
  report_number varchar(100) NOT NULL,
  created_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id, report_id) REFERENCES process_shipment_reports(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, problem_id) REFERENCES problem_indexes(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, report_id, problem_id)
);
CREATE INDEX process_shipment_report_issues_report_idx ON process_shipment_report_issues(organization_id, report_id);

CREATE VIEW process_shipment_customer_read AS
  SELECT organization_id, id, code, name, version
  FROM customer_quality_customers WHERE active = true;

CREATE VIEW process_shipment_issue_read AS
  SELECT organization_id, id, report_number, status, version, archived_at
  FROM problem_indexes
  WHERE domain_code = 'process-quality' AND workflow_instance_id IS NOT NULL;
