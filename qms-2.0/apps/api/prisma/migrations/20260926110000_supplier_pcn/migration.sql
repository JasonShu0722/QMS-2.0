CREATE TABLE supplier_pcns (
  id uuid PRIMARY KEY,
  owner_organization_id uuid NOT NULL REFERENCES organizations(id),
  supplier_organization_id uuid NOT NULL REFERENCES organizations(id),
  profile_id uuid NOT NULL,
  supplier_name varchar(200) NOT NULL,
  change_type varchar(20) NOT NULL CHECK (change_type IN ('MATERIAL','PROCESS','EQUIPMENT','SITE')),
  title varchar(200) NOT NULL CHECK (length(trim(title)) > 0),
  material_code varchar(100) NOT NULL CHECK (length(trim(material_code)) > 0),
  before_change varchar(4000) NOT NULL CHECK (length(trim(before_change)) > 0),
  after_change varchar(4000) NOT NULL CHECK (length(trim(after_change)) > 0),
  reason varchar(2000) NOT NULL CHECK (length(trim(reason)) > 0),
  risk_control varchar(4000) NOT NULL CHECK (length(trim(risk_control)) > 0),
  planned_date date NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','NEEDS_CHANGES','APPROVED','CLOSED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  file_id uuid REFERENCES file_objects(id) ON DELETE RESTRICT,
  problem_index_id uuid UNIQUE REFERENCES problem_indexes(id) ON DELETE RESTRICT,
  review_note varchar(2000),
  created_by_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (profile_id, owner_organization_id, supplier_organization_id)
    REFERENCES supplier_business_profiles(id, owner_organization_id, supplier_organization_id) ON DELETE RESTRICT,
  CHECK (status = 'DRAFT' OR file_id IS NOT NULL),
  CHECK (status NOT IN ('APPROVED','CLOSED') OR problem_index_id IS NOT NULL)
);
CREATE INDEX supplier_pcns_owner_idx ON supplier_pcns(owner_organization_id, created_at DESC, id DESC);
CREATE INDEX supplier_pcns_supplier_idx ON supplier_pcns(supplier_organization_id, created_at DESC, id DESC);
CREATE TABLE supplier_pcn_events (
  id uuid PRIMARY KEY,
  pcn_id uuid NOT NULL REFERENCES supplier_pcns(id) ON DELETE RESTRICT,
  event_type varchar(20) NOT NULL CHECK (event_type IN ('CREATED','UPDATED','SUBMITTED','STARTED','NEEDS_CHANGES','APPROVED','CLOSED')),
  pcn_version integer NOT NULL CHECK (pcn_version > 0),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  file_id uuid REFERENCES file_objects(id) ON DELETE RESTRICT,
  note varchar(2000),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(pcn_id, pcn_version)
);
INSERT INTO permissions(id,code,name) VALUES
  (gen_random_uuid(),'supplier-pcn:requests:read','查看供应商 PCN'),
  (gen_random_uuid(),'supplier-pcn:requests:approve','审批供应商 PCN'),
  (gen_random_uuid(),'supplier-pcn:submissions:read','查看本企业 PCN'),
  (gen_random_uuid(),'supplier-pcn:submissions:write','提交本企业 PCN')
ON CONFLICT(code) DO NOTHING;
