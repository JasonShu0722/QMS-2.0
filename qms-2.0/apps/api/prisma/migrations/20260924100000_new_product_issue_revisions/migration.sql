CREATE TABLE new_product_issue_revisions (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  issue_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  response_form varchar(16) NOT NULL CHECK (response_form IN ('BRIEF', 'EIGHT_D')),
  workflow_instance_id uuid NOT NULL,
  workflow_version_id uuid NOT NULL,
  created_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id, issue_id) REFERENCES new_product_issues(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workflow_instance_id) REFERENCES workflow_instances(id) ON DELETE RESTRICT,
  FOREIGN KEY (workflow_version_id) REFERENCES workflow_versions(id) ON DELETE RESTRICT,
  UNIQUE (organization_id, issue_id, revision),
  UNIQUE (organization_id, id)
);

CREATE INDEX new_product_issue_revisions_latest_idx
  ON new_product_issue_revisions(organization_id, issue_id, revision DESC);
