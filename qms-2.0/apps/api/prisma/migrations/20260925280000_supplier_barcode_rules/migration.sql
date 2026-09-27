CREATE TABLE supplier_barcode_rules (
  id uuid PRIMARY KEY,
  owner_organization_id uuid NOT NULL REFERENCES organizations(id),
  supplier_organization_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  material_code varchar(100) NOT NULL CHECK (length(trim(material_code)) > 0),
  title varchar(300) NOT NULL CHECK (length(trim(title)) > 0),
  prefix varchar(40) NOT NULL CHECK (length(prefix) > 0),
  code_length integer NOT NULL CHECK (code_length BETWEEN 1 AND 200),
  status varchar(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_id uuid NOT NULL REFERENCES users(id),
  published_by_id uuid REFERENCES users(id),
  published_at timestamptz(3),
  retired_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (owner_organization_id, id),
  UNIQUE (owner_organization_id, profile_id, material_code, title),
  FOREIGN KEY (profile_id, owner_organization_id, supplier_organization_id)
    REFERENCES supplier_business_profiles(id, owner_organization_id, supplier_organization_id),
  CHECK ((status = 'PUBLISHED' AND published_by_id IS NOT NULL AND published_at IS NOT NULL) OR status IN ('DRAFT', 'RETIRED')),
  CHECK ((status = 'RETIRED' AND retired_at IS NOT NULL) OR status <> 'RETIRED')
);
CREATE UNIQUE INDEX supplier_barcode_rules_active_idx ON supplier_barcode_rules(owner_organization_id, profile_id, material_code) WHERE status = 'PUBLISHED';
CREATE INDEX supplier_barcode_rules_scope_idx ON supplier_barcode_rules(owner_organization_id, profile_id, material_code, status, id DESC);

CREATE TABLE supplier_barcode_scans (
  id uuid PRIMARY KEY,
  owner_organization_id uuid NOT NULL,
  rule_id uuid NOT NULL,
  barcode varchar(200) NOT NULL CHECK (length(trim(barcode)) > 0),
  batch_code varchar(160),
  scanned_by_id uuid NOT NULL REFERENCES users(id),
  scanned_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (owner_organization_id, id),
  UNIQUE (rule_id, barcode),
  FOREIGN KEY (owner_organization_id, rule_id) REFERENCES supplier_barcode_rules(owner_organization_id, id) ON DELETE CASCADE
);
CREATE INDEX supplier_barcode_scans_scope_idx ON supplier_barcode_scans(owner_organization_id, rule_id, scanned_at DESC);

CREATE TABLE supplier_barcode_rule_events (
  id uuid PRIMARY KEY,
  owner_organization_id uuid NOT NULL,
  rule_id uuid NOT NULL,
  event_type varchar(32) NOT NULL,
  rule_version integer NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  barcode varchar(200),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_organization_id, rule_id) REFERENCES supplier_barcode_rules(owner_organization_id, id) ON DELETE CASCADE
);
CREATE INDEX supplier_barcode_rule_events_scope_idx ON supplier_barcode_rule_events(owner_organization_id, rule_id, created_at);

INSERT INTO permissions(id, code, name) VALUES
  (gen_random_uuid(), 'supplier-barcode:read', '查看供应商条码规则'),
  (gen_random_uuid(), 'supplier-barcode:write', '维护供应商条码规则'),
  (gen_random_uuid(), 'supplier-barcode:publish', '发布供应商条码规则'),
  (gen_random_uuid(), 'supplier-barcode:scan', '扫描供应商条码')
ON CONFLICT (code) DO NOTHING;
