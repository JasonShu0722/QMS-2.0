CREATE TABLE process_eight_d_bindings (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE RESTRICT,
  workflow_definition_id uuid NOT NULL REFERENCES workflow_definitions(id) ON DELETE RESTRICT,
  workflow_version_id uuid NOT NULL REFERENCES workflow_versions(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE process_eight_d_reports (
  problem_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  responsible_section_department_id uuid NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  professional_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  content_version integer NOT NULL DEFAULT 1 CHECK (content_version > 0),
  analysis_completed_at timestamptz(3),
  analysis_due_at timestamptz(3),
  submission_due_at timestamptz(3),
  closure_due_at timestamptz(3),
  submitted_at timestamptz(3),
  closed_revision_id uuid,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, problem_id),
  FOREIGN KEY (organization_id, problem_id) REFERENCES problem_indexes(organization_id, id) ON DELETE RESTRICT
);

CREATE TABLE process_eight_d_collaborators (
  organization_id uuid NOT NULL,
  problem_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  added_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  added_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, problem_id, user_id),
  FOREIGN KEY (organization_id, problem_id) REFERENCES process_eight_d_reports(organization_id, problem_id) ON DELETE RESTRICT
);

CREATE TABLE process_eight_d_revisions (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  problem_id uuid NOT NULL,
  content_version integer NOT NULL CHECK (content_version > 0),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  recorded_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, problem_id, id),
  FOREIGN KEY (organization_id, problem_id) REFERENCES process_eight_d_reports(organization_id, problem_id) ON DELETE RESTRICT
);
ALTER TABLE process_eight_d_reports ADD CONSTRAINT process_eight_d_closed_revision_fkey
  FOREIGN KEY (organization_id, problem_id, closed_revision_id)
  REFERENCES process_eight_d_revisions(organization_id, problem_id, id) ON DELETE RESTRICT;

CREATE TABLE process_eight_d_source_confirmations (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  problem_id uuid NOT NULL,
  defect_id uuid NOT NULL REFERENCES process_defects(id) ON DELETE RESTRICT,
  related_problem_ids jsonb NOT NULL CHECK (jsonb_typeof(related_problem_ids) = 'array'),
  recurrence varchar(32) NOT NULL CHECK (recurrence IN ('RECURRENCE', 'NOT_RECURRENCE')),
  reason varchar(2000) NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recorded_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id, problem_id) REFERENCES process_eight_d_reports(organization_id, problem_id) ON DELETE RESTRICT
);

CREATE TABLE process_eight_d_receipts (
  organization_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  key varchar(128) NOT NULL,
  digest char(64) NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, actor_user_id, key)
);

CREATE FUNCTION process_eight_d_immutable_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'process 8D history is immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER process_eight_d_revision_immutable BEFORE UPDATE OR DELETE ON process_eight_d_revisions
  FOR EACH ROW EXECUTE FUNCTION process_eight_d_immutable_history();
CREATE TRIGGER process_eight_d_confirmation_immutable BEFORE UPDATE OR DELETE ON process_eight_d_source_confirmations
  FOR EACH ROW EXECUTE FUNCTION process_eight_d_immutable_history();
CREATE INDEX process_eight_d_reports_work_idx ON process_eight_d_reports(organization_id, responsible_section_department_id, updated_at);
