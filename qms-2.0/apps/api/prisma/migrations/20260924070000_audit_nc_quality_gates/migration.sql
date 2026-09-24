ALTER TABLE audit_ncs
  ADD COLUMN due_policy_version varchar(100),
  ADD COLUMN calendar_version varchar(100),
  ADD COLUMN due_business_days integer,
  ADD COLUMN assigned_by_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN responded_by_id uuid REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE audit_ncs
  ADD CONSTRAINT audit_ncs_due_business_days_check CHECK (due_business_days IS NULL OR due_business_days > 0),
  ADD CONSTRAINT audit_ncs_due_policy_version_check CHECK (due_policy_version IS NULL OR length(trim(due_policy_version)) > 0),
  ADD CONSTRAINT audit_ncs_calendar_version_check CHECK (calendar_version IS NULL OR length(trim(calendar_version)) > 0);
