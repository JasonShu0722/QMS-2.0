CREATE TABLE supplier_audit_plans (
  id uuid PRIMARY KEY,
  owner_organization_id uuid NOT NULL REFERENCES organizations(id),
  supplier_organization_id uuid NOT NULL REFERENCES organizations(id),
  profile_id uuid NOT NULL,
  audit_year integer NOT NULL CHECK (audit_year BETWEEN 2000 AND 2200),
  audit_type varchar(32) NOT NULL CHECK (audit_type IN ('ANNUAL', 'SPECIAL')),
  title varchar(300) NOT NULL CHECK (length(trim(title)) > 0),
  planned_start timestamptz(3) NOT NULL,
  planned_end timestamptz(3) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'SUBMITTED', 'CLOSED', 'CANCELLED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_id uuid NOT NULL REFERENCES users(id),
  submitted_by_id uuid REFERENCES users(id),
  submitted_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (owner_organization_id, id),
  UNIQUE (owner_organization_id, profile_id, audit_year, audit_type),
  FOREIGN KEY (profile_id, owner_organization_id, supplier_organization_id)
    REFERENCES supplier_business_profiles(id, owner_organization_id, supplier_organization_id),
  CHECK (planned_end >= planned_start),
  CHECK ((status = 'PLANNED' AND submitted_by_id IS NULL AND submitted_at IS NULL)
    OR (status <> 'PLANNED' AND submitted_by_id IS NOT NULL AND submitted_at IS NOT NULL))
);

CREATE INDEX supplier_audit_plans_scope_idx
  ON supplier_audit_plans(owner_organization_id, audit_year DESC, planned_start, id);

CREATE TABLE supplier_audit_records (
  id uuid PRIMARY KEY,
  owner_organization_id uuid NOT NULL REFERENCES organizations(id),
  supplier_organization_id uuid NOT NULL REFERENCES organizations(id),
  profile_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  audit_date date NOT NULL,
  auditor varchar(200) NOT NULL CHECK (length(trim(auditor)) > 0),
  summary text NOT NULL CHECK (length(trim(summary)) > 0),
  findings jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(findings) = 'object'),
  conclusion varchar(24) CHECK (conclusion IN ('PASS', 'CONDITIONAL', 'FAIL')),
  close_note varchar(2000),
  status varchar(24) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'CLOSED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_id uuid NOT NULL REFERENCES users(id),
  submitted_by_id uuid REFERENCES users(id),
  submitted_at timestamptz(3),
  closed_by_id uuid REFERENCES users(id),
  closed_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (owner_organization_id, id),
  UNIQUE (owner_organization_id, plan_id),
  FOREIGN KEY (plan_id, owner_organization_id)
    REFERENCES supplier_audit_plans(id, owner_organization_id),
  FOREIGN KEY (profile_id, owner_organization_id, supplier_organization_id)
    REFERENCES supplier_business_profiles(id, owner_organization_id, supplier_organization_id),
  CHECK ((status = 'DRAFT' AND submitted_by_id IS NULL AND submitted_at IS NULL AND closed_by_id IS NULL AND closed_at IS NULL AND conclusion IS NULL)
    OR (status = 'SUBMITTED' AND submitted_by_id IS NOT NULL AND submitted_at IS NOT NULL AND closed_by_id IS NULL AND closed_at IS NULL AND conclusion IS NULL)
    OR (status = 'CLOSED' AND submitted_by_id IS NOT NULL AND submitted_at IS NOT NULL AND closed_by_id IS NOT NULL AND closed_at IS NOT NULL AND conclusion IS NOT NULL))
);

CREATE INDEX supplier_audit_records_scope_idx
  ON supplier_audit_records(owner_organization_id, audit_date DESC, id);

CREATE TABLE supplier_audit_record_events (
  id uuid PRIMARY KEY,
  owner_organization_id uuid NOT NULL REFERENCES organizations(id),
  record_id uuid NOT NULL,
  event_type varchar(24) NOT NULL CHECK (event_type IN ('CREATED', 'SUBMITTED', 'CLOSED')),
  record_version integer NOT NULL CHECK (record_version > 0),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  note varchar(2000),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (record_id, owner_organization_id)
    REFERENCES supplier_audit_records(id, owner_organization_id) ON DELETE CASCADE
);

CREATE INDEX supplier_audit_record_events_record_idx
  ON supplier_audit_record_events(record_id, record_version);

INSERT INTO permissions(id, code, name) VALUES
  (gen_random_uuid(), 'supplier-audit:plans:read', '查看供应商审核计划'),
  (gen_random_uuid(), 'supplier-audit:plans:write', '维护供应商审核计划'),
  (gen_random_uuid(), 'supplier-audit:records:read', '查看供应商审核记录'),
  (gen_random_uuid(), 'supplier-audit:records:write', '维护供应商审核记录'),
  (gen_random_uuid(), 'supplier-audit:records:close', '关闭供应商审核记录')
ON CONFLICT (code) DO NOTHING;
