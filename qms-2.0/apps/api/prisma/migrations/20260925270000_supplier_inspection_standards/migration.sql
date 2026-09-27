CREATE TABLE supplier_inspection_standards (
  id uuid PRIMARY KEY,
  owner_organization_id uuid NOT NULL REFERENCES organizations(id),
  supplier_organization_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  material_code varchar(100) NOT NULL CHECK (length(trim(material_code)) > 0),
  title varchar(300) NOT NULL CHECK (length(trim(title)) > 0),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  status varchar(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  effective_from date,
  effective_to date,
  created_by_id uuid NOT NULL REFERENCES users(id),
  published_by_id uuid REFERENCES users(id),
  published_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (owner_organization_id, id),
  UNIQUE (owner_organization_id, profile_id, material_code, revision),
  FOREIGN KEY (profile_id, owner_organization_id, supplier_organization_id)
    REFERENCES supplier_business_profiles(id, owner_organization_id, supplier_organization_id),
  CHECK ((status = 'PUBLISHED' AND effective_from IS NOT NULL AND published_by_id IS NOT NULL AND published_at IS NOT NULL) OR status IN ('DRAFT', 'RETIRED')),
  CHECK ((status = 'RETIRED' AND effective_to IS NOT NULL) OR status <> 'RETIRED')
);
CREATE UNIQUE INDEX supplier_inspection_standards_active_idx ON supplier_inspection_standards(owner_organization_id, profile_id, material_code) WHERE status = 'PUBLISHED';
CREATE INDEX supplier_inspection_standards_scope_idx ON supplier_inspection_standards(owner_organization_id, profile_id, material_code, status, revision DESC);

CREATE TABLE supplier_inspection_standard_items (
  id uuid PRIMARY KEY,
  owner_organization_id uuid NOT NULL,
  standard_id uuid NOT NULL,
  item_order integer NOT NULL CHECK (item_order > 0),
  item_name varchar(200) NOT NULL CHECK (length(trim(item_name)) > 0),
  characteristic varchar(300),
  method varchar(300),
  lower_limit varchar(80),
  upper_limit varchar(80),
  unit varchar(40),
  required boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (owner_organization_id, id),
  UNIQUE (standard_id, item_order),
  FOREIGN KEY (owner_organization_id, standard_id) REFERENCES supplier_inspection_standards(owner_organization_id, id) ON DELETE CASCADE
);
CREATE INDEX supplier_inspection_standard_items_scope_idx ON supplier_inspection_standard_items(owner_organization_id, standard_id, item_order);

CREATE TABLE supplier_inspection_standard_events (
  id uuid PRIMARY KEY,
  owner_organization_id uuid NOT NULL,
  standard_id uuid NOT NULL,
  event_type varchar(32) NOT NULL,
  standard_version integer NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  note text,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_organization_id, standard_id) REFERENCES supplier_inspection_standards(owner_organization_id, id) ON DELETE CASCADE
);
CREATE INDEX supplier_inspection_standard_events_scope_idx ON supplier_inspection_standard_events(owner_organization_id, standard_id, created_at);

INSERT INTO permissions(id, code, name) VALUES
  (gen_random_uuid(), 'supplier-inspection-standards:read', '查看供应商检验规范'),
  (gen_random_uuid(), 'supplier-inspection-standards:write', '维护供应商检验规范'),
  (gen_random_uuid(), 'supplier-inspection-standards:publish', '发布供应商检验规范')
ON CONFLICT (code) DO NOTHING;
