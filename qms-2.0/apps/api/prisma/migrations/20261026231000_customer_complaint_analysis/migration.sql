-- SQL-owned collaboration records; source ledger facts remain owned by the ledger.
CREATE TABLE customer_complaint_analyses (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  complaint_id uuid NOT NULL,
  section varchar(16) NOT NULL CHECK (section IN ('FAE', 'SUPPLIER')),
  assignee_user_id uuid NOT NULL,
  assignee_assignment_id uuid NOT NULL REFERENCES user_positions(id) ON DELETE RESTRICT,
  department_id uuid NOT NULL,
  content jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(content) = 'object' AND octet_length(content::text) <= 128000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by_user_id uuid NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, complaint_id, section),
  FOREIGN KEY (organization_id, complaint_id) REFERENCES customer_quality_complaints(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, assignee_user_id) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, updated_by_user_id) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, department_id) REFERENCES departments(organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX customer_complaint_analysis_assignee_idx ON customer_complaint_analyses(organization_id, assignee_user_id, section);
CREATE TABLE customer_complaint_analysis_history (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  analysis_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  action varchar(16) NOT NULL CHECK (action IN ('ASSIGNED', 'TRANSFERRED', 'SAVED')),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  UNIQUE (analysis_id, version),
  FOREIGN KEY (organization_id, analysis_id) REFERENCES customer_complaint_analyses(organization_id, id) ON DELETE RESTRICT
);
CREATE FUNCTION protect_customer_complaint_analysis_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'customer complaint analysis history is immutable';
END;
$$;
CREATE TRIGGER customer_complaint_analysis_history_immutable BEFORE UPDATE OR DELETE ON customer_complaint_analysis_history
FOR EACH ROW EXECUTE FUNCTION protect_customer_complaint_analysis_history();
