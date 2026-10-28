ALTER TABLE supplier_quality_problems
  ADD CONSTRAINT supplier_eight_d_problem_identity UNIQUE (id, owner_organization_id, problem_index_id),
  ADD CONSTRAINT supplier_eight_d_supplier_identity UNIQUE (id, owner_organization_id, supplier_organization_id);
ALTER TABLE user_positions
  ADD CONSTRAINT supplier_eight_d_appointment_identity UNIQUE (id, organization_id, user_id);

CREATE TABLE supplier_eight_d_controls (
  supplier_problem_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  problem_index_id uuid NOT NULL,
  sqe_user_id uuid NOT NULL,
  sqe_assignment_id uuid NOT NULL,
  responsible_section_department_id uuid NOT NULL,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  analysis_due_at timestamptz(3),
  analysis_completed_at timestamptz(3),
  submission_due_at timestamptz(3),
  closure_due_at timestamptz(3),
  submitted_revision_id uuid,
  approved_revision_id uuid,
  approved_snapshot jsonb CHECK (jsonb_typeof(approved_snapshot) = 'object' AND octet_length(approved_snapshot::text) <= 2097152),
  closed_at timestamptz(3),
  updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, supplier_problem_id),
  UNIQUE (organization_id, problem_index_id),
  FOREIGN KEY (supplier_problem_id, organization_id, problem_index_id)
    REFERENCES supplier_quality_problems(id, owner_organization_id, problem_index_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, problem_index_id) REFERENCES problem_indexes(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (sqe_assignment_id, organization_id, sqe_user_id) REFERENCES user_positions(id, organization_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, responsible_section_department_id) REFERENCES departments(organization_id, id) ON DELETE RESTRICT,
  CHECK ((approved_revision_id IS NULL) = (approved_snapshot IS NULL)),
  CHECK ((approved_revision_id IS NULL) = (closed_at IS NULL))
);

-- The response remains in the existing immutable revision table; this is its controlled origin and snapshot.
CREATE TABLE supplier_eight_d_submission_origins (
  revision_id uuid PRIMARY KEY,
  supplier_problem_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  submitted_by uuid NOT NULL,
  submitted_organization_id uuid NOT NULL,
  supplier_organization_id uuid,
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object' AND octet_length(snapshot::text) <= 2097152),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (revision_id, organization_id, submitted_by, submitted_organization_id),
  UNIQUE (organization_id, supplier_problem_id, revision_id),
  FOREIGN KEY (revision_id, supplier_problem_id) REFERENCES supplier_response_revisions(id, problem_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, supplier_problem_id) REFERENCES supplier_eight_d_controls(organization_id, supplier_problem_id) ON DELETE RESTRICT,
  FOREIGN KEY (supplier_problem_id, organization_id, supplier_organization_id)
    REFERENCES supplier_quality_problems(id, owner_organization_id, supplier_organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (submitted_organization_id, submitted_by) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (supplier_organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  CHECK (submitted_organization_id = organization_id
    OR (supplier_organization_id IS NOT NULL AND submitted_organization_id = supplier_organization_id))
);

ALTER TABLE supplier_eight_d_controls
  ADD CONSTRAINT supplier_eight_d_current_submission_fkey
    FOREIGN KEY (organization_id, supplier_problem_id, submitted_revision_id)
    REFERENCES supplier_eight_d_submission_origins(organization_id, supplier_problem_id, revision_id) ON DELETE RESTRICT,
  ADD CONSTRAINT supplier_eight_d_approved_submission_fkey
    FOREIGN KEY (organization_id, supplier_problem_id, approved_revision_id)
    REFERENCES supplier_eight_d_submission_origins(organization_id, supplier_problem_id, revision_id) ON DELETE RESTRICT;

-- Keep the real supplier submitter, without relaxing internal approver/duty membership constraints.
ALTER TABLE workflow_closure_rounds ADD COLUMN creator_organization_id uuid;
UPDATE workflow_closure_rounds SET creator_organization_id = organization_id;
ALTER TABLE workflow_closure_rounds ALTER COLUMN creator_organization_id SET NOT NULL;
ALTER TABLE workflow_closure_rounds ADD COLUMN supplier_response_revision_id uuid;
ALTER TABLE workflow_closure_rounds DROP CONSTRAINT workflow_closure_rounds_organization_id_created_by_fkey;
ALTER TABLE workflow_closure_rounds
  ADD CONSTRAINT workflow_closure_creator_identity_fkey FOREIGN KEY (creator_organization_id, created_by)
    REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT workflow_closure_supplier_origin_fkey
    FOREIGN KEY (supplier_response_revision_id, organization_id, created_by, creator_organization_id)
    REFERENCES supplier_eight_d_submission_origins(revision_id, organization_id, submitted_by, submitted_organization_id) ON DELETE RESTRICT,
  ADD CONSTRAINT workflow_closure_creator_scope_check CHECK (
    (supplier_response_revision_id IS NULL AND creator_organization_id = organization_id)
    OR (supplier_response_revision_id IS NOT NULL AND context->>'policy' IS NOT DISTINCT FROM 'SUPPLIER')
  );

CREATE TABLE supplier_eight_d_supplements (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  supplier_problem_id uuid NOT NULL,
  approved_revision_id uuid NOT NULL,
  content_version integer NOT NULL CHECK (content_version > 0),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object' AND octet_length(document::text) <= 1048576),
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'array' AND octet_length(evidence::text) <= 1048576),
  updated_by uuid NOT NULL,
  recorded_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id, supplier_problem_id, approved_revision_id)
    REFERENCES supplier_eight_d_submission_origins(organization_id, supplier_problem_id, revision_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, updated_by) REFERENCES users(organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX supplier_eight_d_supplement_history_idx
  ON supplier_eight_d_supplements(organization_id, supplier_problem_id, content_version DESC);

CREATE TABLE supplier_eight_d_receipts (
  organization_id uuid NOT NULL,
  supplier_problem_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  actor_organization_id uuid NOT NULL,
  key varchar(128) NOT NULL CHECK (key ~ '^[a-zA-Z0-9._:-]{8,128}$'),
  action varchar(64) NOT NULL,
  digest varchar(64) NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
  response jsonb NOT NULL CHECK (octet_length(response::text) <= 2097152),
  recorded_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, actor_user_id, key),
  FOREIGN KEY (organization_id, supplier_problem_id) REFERENCES supplier_eight_d_controls(organization_id, supplier_problem_id) ON DELETE RESTRICT,
  FOREIGN KEY (actor_organization_id, actor_user_id) REFERENCES users(organization_id, id) ON DELETE RESTRICT
);

CREATE FUNCTION supplier_eight_d_reject_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'supplier 8D history is immutable' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER supplier_eight_d_origin_immutable BEFORE UPDATE OR DELETE ON supplier_eight_d_submission_origins
  FOR EACH ROW EXECUTE FUNCTION supplier_eight_d_reject_history_mutation();
CREATE TRIGGER supplier_eight_d_supplement_immutable BEFORE UPDATE OR DELETE ON supplier_eight_d_supplements
  FOR EACH ROW EXECUTE FUNCTION supplier_eight_d_reject_history_mutation();
CREATE TRIGGER supplier_eight_d_receipt_immutable BEFORE UPDATE OR DELETE ON supplier_eight_d_receipts
  FOR EACH ROW EXECUTE FUNCTION supplier_eight_d_reject_history_mutation();

CREATE FUNCTION supplier_eight_d_preserve_approval() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.approved_revision_id IS NOT NULL AND (
    NEW.approved_revision_id IS DISTINCT FROM OLD.approved_revision_id
    OR NEW.approved_snapshot IS DISTINCT FROM OLD.approved_snapshot
    OR NEW.closed_at IS DISTINCT FROM OLD.closed_at
  ) THEN
    RAISE EXCEPTION 'supplier 8D approval is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER supplier_eight_d_preserve_approval BEFORE UPDATE ON supplier_eight_d_controls
  FOR EACH ROW EXECUTE FUNCTION supplier_eight_d_preserve_approval();
