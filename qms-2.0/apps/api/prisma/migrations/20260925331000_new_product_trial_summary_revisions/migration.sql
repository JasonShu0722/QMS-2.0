CREATE TABLE new_product_trial_summary_revisions (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  summary_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  conclusion text NOT NULL,
  metric_snapshot jsonb NOT NULL,
  issue_snapshot jsonb NOT NULL,
  source_sha256 varchar(64) NOT NULL,
  submitted_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  submitted_at timestamptz(3) NOT NULL,
  decision varchar(16) CHECK (decision IN ('APPROVE', 'REJECT')),
  decided_by_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  decided_at timestamptz(3),
  decision_note text,
  FOREIGN KEY (organization_id, summary_id) REFERENCES new_product_trial_summaries(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, summary_id, revision),
  CHECK ((decision IS NULL AND decided_by_id IS NULL AND decided_at IS NULL)
    OR (decision IS NOT NULL AND decided_by_id IS NOT NULL AND decided_at IS NOT NULL))
);

INSERT INTO new_product_trial_summary_revisions(id, organization_id, summary_id, revision, conclusion, metric_snapshot, issue_snapshot, source_sha256, submitted_by_id, submitted_at, decision, decided_by_id, decided_at, decision_note)
SELECT gen_random_uuid(), organization_id, id, 1, conclusion, metric_snapshot, issue_snapshot, source_sha256, submitted_by_id, submitted_at,
  CASE status WHEN 'APPROVED' THEN 'APPROVE' WHEN 'REJECTED' THEN 'REJECT' ELSE NULL END,
  approved_by_id, approved_at, approval_note
FROM new_product_trial_summaries WHERE status <> 'DRAFT';
