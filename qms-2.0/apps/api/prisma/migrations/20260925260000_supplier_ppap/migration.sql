CREATE TABLE supplier_ppap_packages (
  id uuid PRIMARY KEY,
  owner_organization_id uuid NOT NULL REFERENCES organizations(id),
  supplier_organization_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  level integer NOT NULL CHECK (level BETWEEN 1 AND 5),
  title varchar(300) NOT NULL CHECK (length(trim(title)) > 0),
  part_number varchar(120) NOT NULL CHECK (length(trim(part_number)) > 0),
  status varchar(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  review_note text,
  created_by_id uuid NOT NULL REFERENCES users(id),
  submitted_by_id uuid REFERENCES users(id),
  submitted_at timestamptz(3),
  reviewed_by_id uuid REFERENCES users(id),
  reviewed_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (owner_organization_id, id),
  FOREIGN KEY (profile_id, owner_organization_id, supplier_organization_id)
    REFERENCES supplier_business_profiles(id, owner_organization_id, supplier_organization_id),
  CHECK ((status IN ('SUBMITTED', 'APPROVED', 'REJECTED') AND submitted_by_id IS NOT NULL AND submitted_at IS NOT NULL) OR status = 'DRAFT'),
  CHECK ((status IN ('APPROVED', 'REJECTED') AND reviewed_by_id IS NOT NULL AND reviewed_at IS NOT NULL) OR status IN ('DRAFT', 'SUBMITTED'))
);
CREATE INDEX supplier_ppap_packages_scope_idx ON supplier_ppap_packages(owner_organization_id, status, created_at DESC, id DESC);

CREATE TABLE supplier_ppap_items (
  id uuid PRIMARY KEY,
  owner_organization_id uuid NOT NULL,
  package_id uuid NOT NULL,
  item_code varchar(80) NOT NULL,
  title varchar(300) NOT NULL CHECK (length(trim(title)) > 0),
  description text,
  required boolean NOT NULL DEFAULT true,
  status varchar(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROVIDED', 'ACCEPTED', 'REJECTED')),
  content jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(content) = 'object'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (owner_organization_id, id),
  UNIQUE (package_id, item_code),
  FOREIGN KEY (owner_organization_id, package_id) REFERENCES supplier_ppap_packages(owner_organization_id, id) ON DELETE CASCADE
);
CREATE INDEX supplier_ppap_items_scope_idx ON supplier_ppap_items(owner_organization_id, package_id, status, id);

CREATE TABLE supplier_ppap_events (
  id uuid PRIMARY KEY,
  owner_organization_id uuid NOT NULL,
  package_id uuid NOT NULL,
  entity_type varchar(16) NOT NULL CHECK (entity_type IN ('PACKAGE', 'ITEM')),
  entity_id uuid NOT NULL,
  event_type varchar(32) NOT NULL,
  entity_version integer NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  note text,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_organization_id, package_id) REFERENCES supplier_ppap_packages(owner_organization_id, id) ON DELETE CASCADE
);
CREATE INDEX supplier_ppap_events_scope_idx ON supplier_ppap_events(owner_organization_id, package_id, created_at);

INSERT INTO permissions(id, code, name) VALUES
  (gen_random_uuid(), 'supplier-ppap:read', '查看供应商 PPAP'),
  (gen_random_uuid(), 'supplier-ppap:write', '维护供应商 PPAP'),
  (gen_random_uuid(), 'supplier-ppap:review', '审核供应商 PPAP')
ON CONFLICT (code) DO NOTHING;
