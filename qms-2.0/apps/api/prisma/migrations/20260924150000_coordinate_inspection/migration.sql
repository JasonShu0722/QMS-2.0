CREATE TABLE coordinate_inspection_requests (
  id uuid PRIMARY KEY,
  owner_organization_id uuid NOT NULL REFERENCES organizations(id),
  requester_id uuid NOT NULL REFERENCES users(id),
  request_number varchar(80),
  part_number varchar(120) NOT NULL CHECK (length(trim(part_number)) > 0),
  part_name varchar(240) NOT NULL CHECK (length(trim(part_name)) > 0),
  drawing_revision varchar(80),
  batch_number varchar(160),
  sample_quantity integer NOT NULL CHECK (sample_quantity > 0),
  purpose varchar(32) NOT NULL CHECK (purpose IN ('INCOMING', 'PROCESS', 'CUSTOMER', 'NEW_PRODUCT', 'OTHER')),
  priority varchar(16) NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  requested_due_at timestamptz(3),
  status varchar(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED')),
  approval_note varchar(2000),
  approved_by_id uuid REFERENCES users(id),
  approved_at timestamptz(3),
  scheduled_at timestamptz(3),
  scheduled_by_id uuid REFERENCES users(id),
  assigned_to_id uuid REFERENCES users(id),
  progress_percent integer NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  progress_note varchar(2000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (owner_organization_id, request_number),
  UNIQUE (id, owner_organization_id),
  CHECK ((status IN ('APPROVED', 'REJECTED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED') AND approved_at IS NOT NULL AND approved_by_id IS NOT NULL) OR status IN ('DRAFT', 'SUBMITTED')),
  CHECK ((status IN ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED') AND scheduled_at IS NOT NULL) OR status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED')),
  CHECK ((status = 'COMPLETED' AND progress_percent = 100) OR status <> 'COMPLETED')
);
CREATE INDEX coordinate_inspection_scope_idx ON coordinate_inspection_requests(owner_organization_id, status, created_at DESC, id DESC);
CREATE INDEX coordinate_inspection_schedule_idx ON coordinate_inspection_requests(owner_organization_id, scheduled_at, status);

CREATE FUNCTION validate_coordinate_inspection_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'DRAFT' AND (NEW.approved_at IS NOT NULL OR NEW.scheduled_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Draft inspection cannot have approval or schedule' USING ERRCODE = '23514';
  END IF;
  IF NEW.status IN ('REJECTED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED') AND NEW.approved_at IS NULL THEN
    RAISE EXCEPTION 'Inspection status requires approval' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER coordinate_inspection_state BEFORE INSERT OR UPDATE ON coordinate_inspection_requests
  FOR EACH ROW EXECUTE FUNCTION validate_coordinate_inspection_state();
