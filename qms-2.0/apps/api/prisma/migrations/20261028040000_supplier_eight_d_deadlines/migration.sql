-- Dedicated supplier 8D requests; no generic deadline engine and no old due overwritten before final approval.
CREATE TABLE supplier_eight_d_deadline_requests (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  supplier_problem_id uuid NOT NULL REFERENCES supplier_eight_d_controls(supplier_problem_id),
  stage text NOT NULL CHECK (stage IN ('ANALYSIS', 'SUBMISSION', 'CLOSURE')),
  severity text NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  status text NOT NULL CHECK (status IN ('QUALITY_PENDING', 'MANAGER_PENDING', 'APPROVED', 'RETURNED', 'CANCELLED')),
  original_due_at timestamptz NOT NULL,
  requested_due_at timestamptz NOT NULL CHECK (requested_due_at > original_due_at),
  originally_overdue boolean NOT NULL,
  row_version integer NOT NULL CHECK (row_version > 0),
  content_version integer NOT NULL CHECK (content_version > 0),
  instance_version integer NOT NULL CHECK (instance_version > 0),
  sqe_user_id uuid NOT NULL REFERENCES users(id),
  sqe_assignment_id uuid NOT NULL REFERENCES user_positions(id),
  sqe_fingerprint varchar(64) NOT NULL CHECK (sqe_fingerprint ~ '^[0-9a-f]{64}$'),
  manager_user_id uuid REFERENCES users(id),
  manager_fingerprint varchar(64) CHECK (manager_fingerprint IS NULL OR manager_fingerprint ~ '^[0-9a-f]{64}$'),
  applicant_user_id uuid NOT NULL REFERENCES users(id),
  applicant_organization_id uuid NOT NULL REFERENCES organizations(id),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, supplier_problem_id, id),
  FOREIGN KEY (organization_id, supplier_problem_id) REFERENCES supplier_eight_d_controls(organization_id, supplier_problem_id),
  FOREIGN KEY (sqe_assignment_id, organization_id, sqe_user_id) REFERENCES user_positions(id, organization_id, user_id),
  FOREIGN KEY (organization_id, manager_user_id) REFERENCES users(organization_id, id),
  FOREIGN KEY (applicant_organization_id, applicant_user_id) REFERENCES users(organization_id, id),
  CHECK ((severity IN ('HIGH', 'CRITICAL') AND manager_user_id IS NOT NULL AND manager_fingerprint IS NOT NULL)
    OR (severity IN ('LOW', 'MEDIUM') AND manager_user_id IS NULL AND manager_fingerprint IS NULL)),
  CHECK (status <> 'MANAGER_PENDING' OR severity IN ('HIGH', 'CRITICAL'))
);
CREATE UNIQUE INDEX supplier_eight_d_deadline_one_pending
  ON supplier_eight_d_deadline_requests (organization_id, supplier_problem_id, stage)
  WHERE status IN ('QUALITY_PENDING', 'MANAGER_PENDING');

CREATE TABLE supplier_eight_d_deadline_decisions (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES supplier_eight_d_deadline_requests(id),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  duty text NOT NULL CHECK (duty IN ('SQE', 'MANAGER', 'APPLICANT')),
  decision text NOT NULL CHECK (decision IN ('APPROVE', 'RETURN', 'CANCEL')),
  comment text NOT NULL CHECK (length(btrim(comment)) BETWEEN 1 AND 2000),
  from_status text NOT NULL CHECK (from_status IN ('QUALITY_PENDING', 'MANAGER_PENDING')),
  to_status text NOT NULL CHECK (to_status IN ('MANAGER_PENDING', 'APPROVED', 'RETURNED', 'CANCELLED')),
  request_version integer NOT NULL CHECK (request_version > 0),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (request_id, request_version),
  CHECK ((decision = 'CANCEL' AND duty = 'APPLICANT' AND to_status = 'CANCELLED')
    OR (decision = 'RETURN' AND duty IN ('SQE', 'MANAGER') AND to_status = 'RETURNED')
    OR (decision = 'APPROVE' AND duty IN ('SQE', 'MANAGER') AND to_status IN ('MANAGER_PENDING', 'APPROVED')))
);

CREATE TABLE supplier_eight_d_deadline_receipts (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  supplier_problem_id uuid NOT NULL REFERENCES supplier_eight_d_controls(supplier_problem_id),
  request_id uuid NOT NULL REFERENCES supplier_eight_d_deadline_requests(id),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  actor_organization_id uuid NOT NULL REFERENCES organizations(id),
  key text NOT NULL CHECK (length(key) BETWEEN 8 AND 128),
  action text NOT NULL CHECK (action IN ('REQUEST', 'DECIDE', 'CANCEL')),
  digest varchar(64) NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
  response jsonb NOT NULL CHECK (jsonb_typeof(response) = 'object' AND octet_length(response::text) <= 2097152),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, actor_user_id, key)
  ,FOREIGN KEY (organization_id, supplier_problem_id, request_id) REFERENCES supplier_eight_d_deadline_requests(organization_id, supplier_problem_id, id)
  ,FOREIGN KEY (actor_organization_id, actor_user_id) REFERENCES users(organization_id, id)
);

CREATE TRIGGER supplier_eight_d_deadline_decision_immutable BEFORE UPDATE OR DELETE ON supplier_eight_d_deadline_decisions
  FOR EACH ROW EXECUTE FUNCTION supplier_eight_d_reject_history_mutation();
CREATE TRIGGER supplier_eight_d_deadline_receipt_immutable BEFORE UPDATE OR DELETE ON supplier_eight_d_deadline_receipts
  FOR EACH ROW EXECUTE FUNCTION supplier_eight_d_reject_history_mutation();

CREATE FUNCTION supplier_eight_d_deadline_preserve_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'supplier deadline request cannot be deleted' USING ERRCODE = '55000'; END IF;
  IF (to_jsonb(NEW) - ARRAY['status', 'version', 'updated_at']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status', 'version', 'updated_at'])
    OR OLD.status NOT IN ('QUALITY_PENDING', 'MANAGER_PENDING')
    OR NEW.version <> OLD.version + 1
    OR NOT ((OLD.status = 'QUALITY_PENDING' AND NEW.status IN ('MANAGER_PENDING', 'APPROVED', 'RETURNED', 'CANCELLED'))
      OR (OLD.status = 'MANAGER_PENDING' AND NEW.status IN ('APPROVED', 'RETURNED', 'CANCELLED'))) THEN
    RAISE EXCEPTION 'supplier deadline snapshot or terminal state is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER supplier_eight_d_deadline_request_immutable BEFORE UPDATE OR DELETE ON supplier_eight_d_deadline_requests
  FOR EACH ROW EXECUTE FUNCTION supplier_eight_d_deadline_preserve_request();
