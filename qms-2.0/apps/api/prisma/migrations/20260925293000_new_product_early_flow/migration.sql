CREATE TABLE new_product_early_flows (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  monitoring_window_days integer NOT NULL CHECK (monitoring_window_days BETWEEN 1 AND 365),
  plan text NOT NULL CHECK (length(trim(plan)) BETWEEN 1 AND 10000),
  status varchar(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED')),
  approval_note text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  submitted_by_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  submitted_at timestamptz(3),
  approved_by_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  approved_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id, project_id) REFERENCES new_product_projects(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, project_id),
  UNIQUE (organization_id, id),
  CHECK ((status = 'DRAFT' AND submitted_by_id IS NULL AND submitted_at IS NULL AND approved_by_id IS NULL AND approved_at IS NULL)
    OR (status IN ('SUBMITTED', 'REJECTED', 'APPROVED') AND submitted_by_id IS NOT NULL AND submitted_at IS NOT NULL)),
  CHECK ((status IN ('DRAFT', 'SUBMITTED') AND approved_by_id IS NULL AND approved_at IS NULL)
    OR (status IN ('REJECTED', 'APPROVED') AND approved_by_id IS NOT NULL AND approved_at IS NOT NULL))
);

CREATE INDEX new_product_early_flows_status_idx ON new_product_early_flows(organization_id, status, updated_at);
