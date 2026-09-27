ALTER TABLE new_product_mass_production_approvals
  ADD CONSTRAINT new_product_mass_production_approvals_scope_id_key UNIQUE (organization_id, project_id, id);

CREATE TABLE new_product_handovers (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  project_version integer NOT NULL CHECK (project_version > 0),
  risk_statement text NOT NULL CHECK (length(trim(risk_statement)) BETWEEN 1 AND 10000),
  mass_production_approval_id uuid,
  stage_snapshot jsonb NOT NULL,
  trial_snapshot jsonb NOT NULL,
  open_issue_count integer NOT NULL CHECK (open_issue_count >= 0),
  handed_over_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  handed_over_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id, project_id) REFERENCES new_product_projects(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, project_id, mass_production_approval_id) REFERENCES new_product_mass_production_approvals(organization_id, project_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, project_id)
);
