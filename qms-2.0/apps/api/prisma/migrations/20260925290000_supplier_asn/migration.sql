CREATE TABLE supplier_asn_records (
  id uuid PRIMARY KEY,
  owner_organization_id uuid NOT NULL REFERENCES organizations(id),
  supplier_organization_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  asn_number varchar(120) NOT NULL,
  material_code varchar(100) NOT NULL,
  planned_arrival_date date NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  status varchar(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RECEIVED', 'CANCELLED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_id uuid NOT NULL REFERENCES users(id),
  submitted_by_id uuid REFERENCES users(id),
  submitted_at timestamptz(3),
  received_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (owner_organization_id, id),
  UNIQUE (owner_organization_id, asn_number),
  FOREIGN KEY (profile_id, owner_organization_id, supplier_organization_id)
    REFERENCES supplier_business_profiles(id, owner_organization_id, supplier_organization_id),
  CHECK ((status IN ('SUBMITTED', 'RECEIVED') AND submitted_by_id IS NOT NULL AND submitted_at IS NOT NULL) OR status IN ('DRAFT', 'CANCELLED')),
  CHECK ((status = 'RECEIVED' AND received_at IS NOT NULL) OR status <> 'RECEIVED')
);
CREATE INDEX supplier_asn_scope_idx ON supplier_asn_records(owner_organization_id, planned_arrival_date DESC, status, id DESC);
CREATE TABLE supplier_asn_events (
  id uuid PRIMARY KEY,
  owner_organization_id uuid NOT NULL,
  asn_id uuid NOT NULL,
  event_type varchar(32) NOT NULL,
  asn_version integer NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  note text,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_organization_id, asn_id) REFERENCES supplier_asn_records(owner_organization_id, id) ON DELETE CASCADE
);
CREATE INDEX supplier_asn_events_scope_idx ON supplier_asn_events(owner_organization_id, asn_id, created_at);
INSERT INTO permissions(id, code, name) VALUES
  (gen_random_uuid(), 'supplier-asn:read', '查看供应商 ASN'),
  (gen_random_uuid(), 'supplier-asn:write', '维护供应商 ASN'),
  (gen_random_uuid(), 'supplier-asn:submit', '提交供应商 ASN')
ON CONFLICT (code) DO NOTHING;
