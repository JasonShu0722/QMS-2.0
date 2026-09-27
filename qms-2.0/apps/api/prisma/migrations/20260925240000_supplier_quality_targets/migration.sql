CREATE TABLE supplier_quality_targets (
  id uuid PRIMARY KEY,
  owner_organization_id uuid NOT NULL REFERENCES organizations(id),
  supplier_organization_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  period_type varchar(12) NOT NULL CHECK (period_type IN ('ANNUAL', 'MONTHLY')),
  target_year integer NOT NULL CHECK (target_year BETWEEN 2000 AND 2200),
  target_month integer CHECK (target_month BETWEEN 1 AND 12),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  title varchar(300) NOT NULL CHECK (length(trim(title)) > 0),
  metrics jsonb NOT NULL CHECK (jsonb_typeof(metrics) = 'object'),
  status varchar(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'PUBLISHED', 'RETIRED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  effective_from date,
  effective_to date,
  approval_signature_id uuid,
  created_by_id uuid NOT NULL REFERENCES users(id),
  submitted_by_id uuid REFERENCES users(id),
  approved_by_id uuid REFERENCES users(id),
  published_by_id uuid REFERENCES users(id),
  submitted_at timestamptz(3), approved_at timestamptz(3), published_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (owner_organization_id, id),
  UNIQUE (owner_organization_id, profile_id, period_type, target_year, target_month, revision),
  FOREIGN KEY (profile_id, owner_organization_id, supplier_organization_id)
    REFERENCES supplier_business_profiles(id, owner_organization_id, supplier_organization_id),
  FOREIGN KEY (owner_organization_id, approval_signature_id)
    REFERENCES approval_signatures(organization_id, id),
  CHECK ((period_type = 'ANNUAL' AND target_month IS NULL) OR (period_type = 'MONTHLY' AND target_month IS NOT NULL)),
  CHECK ((status IN ('PUBLISHED', 'RETIRED') AND effective_from IS NOT NULL) OR status IN ('DRAFT', 'SUBMITTED', 'APPROVED')),
  CHECK ((status IN ('APPROVED', 'PUBLISHED', 'RETIRED') AND approved_by_id IS NOT NULL AND approved_at IS NOT NULL) OR status IN ('DRAFT', 'SUBMITTED')),
  CHECK ((status IN ('SUBMITTED', 'APPROVED', 'PUBLISHED', 'RETIRED') AND submitted_by_id IS NOT NULL AND submitted_at IS NOT NULL) OR status = 'DRAFT')
);
CREATE INDEX supplier_quality_targets_scope_idx ON supplier_quality_targets(owner_organization_id, target_year DESC, target_month, status, id DESC);
CREATE UNIQUE INDEX supplier_quality_targets_active_period_idx ON supplier_quality_targets(owner_organization_id, profile_id, period_type, target_year, target_month) WHERE status = 'PUBLISHED';
INSERT INTO permissions(id, code, name) VALUES
  (gen_random_uuid(), 'supplier-quality:targets:read', '查看供应商质量目标'),
  (gen_random_uuid(), 'supplier-quality:targets:write', '维护供应商质量目标'),
  (gen_random_uuid(), 'supplier-quality:targets:approve', '审批供应商质量目标'),
  (gen_random_uuid(), 'supplier-quality:targets:publish', '发布供应商质量目标')
ON CONFLICT (code) DO NOTHING;
