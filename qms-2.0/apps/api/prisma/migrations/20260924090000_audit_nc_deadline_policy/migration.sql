CREATE TABLE audit_nc_deadline_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  policy_version varchar(100) NOT NULL,
  calendar_version varchar(100) NOT NULL,
  time_zone varchar(100) NOT NULL,
  working_weekdays jsonb NOT NULL,
  exceptions jsonb NOT NULL,
  severity_days jsonb NOT NULL,
  created_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, policy_version, calendar_version),
  CHECK (length(trim(policy_version)) > 0 AND length(trim(calendar_version)) > 0 AND length(trim(time_zone)) > 0),
  CHECK (jsonb_typeof(working_weekdays) = 'array' AND jsonb_typeof(exceptions) = 'object' AND jsonb_typeof(severity_days) = 'object')
);

CREATE FUNCTION audit_nc_deadline_policy_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT_NC_DEADLINE_POLICY_IMMUTABLE';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_nc_deadline_policy_immutable_trigger
  BEFORE UPDATE OR DELETE ON audit_nc_deadline_policies
  FOR EACH ROW EXECUTE FUNCTION audit_nc_deadline_policy_immutable();

CREATE INDEX audit_ncs_due_open_idx ON audit_ncs (organization_id, due_at)
  WHERE status <> 'CLOSED';
