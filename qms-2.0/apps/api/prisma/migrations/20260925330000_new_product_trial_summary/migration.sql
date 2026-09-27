CREATE TABLE new_product_trial_summaries (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  conclusion text NOT NULL CHECK (length(trim(conclusion)) BETWEEN 1 AND 10000),
  status varchar(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED')),
  metric_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  issue_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_sha256 varchar(64),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  submitted_by_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  submitted_at timestamptz(3),
  approved_by_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  approved_at timestamptz(3),
  approval_note text CHECK (approval_note IS NULL OR length(trim(approval_note)) BETWEEN 1 AND 2000),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id, project_id) REFERENCES new_product_projects(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, batch_id) REFERENCES new_product_trial_batches(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, batch_id),
  UNIQUE (organization_id, id),
  CHECK (status = 'DRAFT' OR (submitted_by_id IS NOT NULL AND submitted_at IS NOT NULL AND source_sha256 IS NOT NULL)),
  CHECK ((status IN ('DRAFT', 'SUBMITTED') AND approved_by_id IS NULL AND approved_at IS NULL)
    OR (status IN ('APPROVED', 'REJECTED') AND approved_by_id IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK (approved_by_id IS NULL OR approved_by_id <> submitted_by_id)
);

CREATE INDEX new_product_trial_summaries_project_idx ON new_product_trial_summaries(organization_id, project_id, status);
