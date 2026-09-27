ALTER TABLE new_product_issues
  ADD COLUMN owner_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN measure_plan text,
  ADD COLUMN measure_due_at timestamptz(3),
  ADD COLUMN verification_summary text,
  ADD COLUMN verification_evidence_object_id uuid REFERENCES file_objects(id) ON DELETE RESTRICT,
  ADD COLUMN verified_by_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN verified_at timestamptz(3),
  ADD COLUMN closed_by_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN closed_at timestamptz(3),
  ADD COLUMN closure_note text;

ALTER TABLE new_product_issues DROP CONSTRAINT IF EXISTS new_product_issues_status_check;
ALTER TABLE new_product_issues ADD CONSTRAINT new_product_issues_status_check CHECK (status IN ('OPEN', 'ESCALATED', 'IN_PROGRESS', 'VERIFIED', 'CLOSED'));
ALTER TABLE new_product_issues ADD CONSTRAINT new_product_issues_measure_plan_check CHECK (measure_plan IS NULL OR length(trim(measure_plan)) BETWEEN 1 AND 10000);
ALTER TABLE new_product_issues ADD CONSTRAINT new_product_issues_verification_summary_check CHECK (verification_summary IS NULL OR length(trim(verification_summary)) BETWEEN 1 AND 10000);
ALTER TABLE new_product_issues ADD CONSTRAINT new_product_issues_closure_note_check CHECK (closure_note IS NULL OR length(trim(closure_note)) BETWEEN 1 AND 2000);
CREATE INDEX new_product_issues_project_status_idx ON new_product_issues(organization_id, project_id, status, updated_at DESC);
