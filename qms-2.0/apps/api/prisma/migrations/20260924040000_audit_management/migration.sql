CREATE TABLE audit_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  year integer NOT NULL CHECK (year BETWEEN 2000 AND 2200), title varchar(300) NOT NULL CHECK (length(trim(title)) > 0),
  audit_type varchar(32) NOT NULL CHECK (audit_type IN ('SYSTEM','PROCESS','PRODUCT','SECOND_PARTY','CUSTOMER')),
  planned_start timestamptz(3) NOT NULL, planned_end timestamptz(3) NOT NULL CHECK (planned_end >= planned_start),
  status varchar(24) NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','APPROVED','IN_PROGRESS','COMPLETED','CANCELLED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0), created_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE (organization_id, id)
);
CREATE INDEX audit_plans_org_year_idx ON audit_plans(organization_id, year, planned_start);

CREATE TABLE audit_postponements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, plan_id uuid NOT NULL,
  original_start timestamptz(3) NOT NULL, original_end timestamptz(3) NOT NULL, proposed_start timestamptz(3) NOT NULL,
  proposed_end timestamptz(3) NOT NULL CHECK (proposed_end >= proposed_start), reason varchar(2000) NOT NULL CHECK (length(trim(reason)) > 0),
  status varchar(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')), plan_version integer NOT NULL CHECK (plan_version > 0),
  requested_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, decided_by_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  decided_at timestamptz(3), version integer NOT NULL DEFAULT 1 CHECK (version > 0), created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id, plan_id) REFERENCES audit_plans(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, id)
);

CREATE TABLE audit_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name varchar(300) NOT NULL CHECK (length(trim(name)) > 0), audit_type varchar(32) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED')),
  draft_definition jsonb NOT NULL CHECK (jsonb_typeof(draft_definition) = 'object'), version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, updated_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, id)
);
CREATE TABLE audit_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, template_id uuid NOT NULL, version integer NOT NULL CHECK (version > 0),
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'), published_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  published_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id, template_id) REFERENCES audit_templates(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, template_id, version), UNIQUE (organization_id, id)
);
CREATE OR REPLACE FUNCTION audit_template_versions_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'published audit template versions are immutable'; END; $$;
CREATE TRIGGER audit_template_versions_immutable BEFORE UPDATE OR DELETE ON audit_template_versions FOR EACH ROW EXECUTE FUNCTION audit_template_versions_immutable();

CREATE TABLE audit_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, plan_id uuid NOT NULL, template_version_id uuid NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','SUBMITTED','COMPLETED','CANCELLED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0), started_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at timestamptz(3), created_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, plan_id) REFERENCES audit_plans(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, template_version_id) REFERENCES audit_template_versions(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, id)
);
CREATE TABLE audit_checklist_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, execution_id uuid NOT NULL,
  item_key varchar(120) NOT NULL, result varchar(8) NOT NULL CHECK (result IN ('OK','NG','NA')), note varchar(5000), evidence_file_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_file_ids) = 'array'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0), recorded_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, recorded_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id, execution_id) REFERENCES audit_executions(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, execution_id, item_key), UNIQUE (organization_id, id), UNIQUE (organization_id, execution_id, id)
);
CREATE TABLE audit_ncs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, execution_id uuid NOT NULL, checklist_result_id uuid NOT NULL,
  severity varchar(16) NOT NULL CHECK (severity IN ('MINOR','MAJOR','CRITICAL')), due_at timestamptz(3) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ASSIGNED','RESPONDED','VERIFIED','REJECTED','CLOSED')),
  assignee_user_id uuid REFERENCES users(id) ON DELETE RESTRICT, response varchar(10000), verification_note varchar(5000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0), created_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  verified_by_id uuid REFERENCES users(id) ON DELETE RESTRICT, closed_by_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id, execution_id) REFERENCES audit_executions(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, execution_id, checklist_result_id) REFERENCES audit_checklist_results(organization_id, execution_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, checklist_result_id)
);
CREATE TABLE audit_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  source_system varchar(32) NOT NULL CHECK (source_system IN ('CUSTOMER','SECOND_PARTY')), external_key varchar(200) NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'), status varchar(24) NOT NULL DEFAULT 'PENDING_REVIEW',
  imported_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, source_system, external_key)
);
INSERT INTO permissions(id, code, name) VALUES
  (gen_random_uuid(), 'audit-management:read', '查看审核管理'),
  (gen_random_uuid(), 'audit-management:write', '维护审核管理')
ON CONFLICT (code) DO NOTHING;
