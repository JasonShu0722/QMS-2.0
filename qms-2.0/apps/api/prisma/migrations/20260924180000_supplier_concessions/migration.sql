CREATE TABLE supplier_concession_requests (
  id uuid PRIMARY KEY,
  owner_organization_id uuid NOT NULL REFERENCES organizations(id),
  inspection_id uuid NOT NULL REFERENCES supplier_incoming_inspections(id) ON DELETE RESTRICT,
  inspection_version integer NOT NULL CHECK (inspection_version > 0),
  profile_id uuid NOT NULL REFERENCES supplier_business_profiles(id),
  supplier_organization_id uuid NOT NULL REFERENCES organizations(id),
  supplier_name varchar(200) NOT NULL,
  material_code varchar(100) NOT NULL,
  incoming_batch varchar(160) NOT NULL,
  received_quantity integer NOT NULL CHECK (received_quantity > 0),
  quantity integer NOT NULL CHECK (quantity > 0 AND quantity <= received_quantity),
  reason varchar(2000) NOT NULL CHECK (length(trim(reason)) > 0),
  expires_at timestamptz(3) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'RELEASED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  requested_by_id uuid NOT NULL REFERENCES users(id),
  submitted_at timestamptz(3),
  approved_by_id uuid REFERENCES users(id),
  approved_at timestamptz(3),
  decision_note varchar(2000),
  released_by_id uuid REFERENCES users(id),
  released_at timestamptz(3),
  release_note varchar(2000),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (status <> 'APPROVED' OR (approved_by_id IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK (status <> 'RELEASED' OR (approved_by_id IS NOT NULL AND approved_at IS NOT NULL AND released_by_id IS NOT NULL AND released_at IS NOT NULL))
);
CREATE UNIQUE INDEX supplier_concession_one_active_inspection ON supplier_concession_requests(inspection_id) WHERE status <> 'REJECTED';
CREATE INDEX supplier_concession_scope_idx ON supplier_concession_requests(owner_organization_id, created_at DESC, id DESC);
CREATE INDEX supplier_concession_batch_idx ON supplier_concession_requests(owner_organization_id, material_code, incoming_batch);

CREATE TABLE supplier_concession_events (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES supplier_concession_requests(id) ON DELETE RESTRICT,
  event_type varchar(16) NOT NULL CHECK (event_type IN ('CREATED', 'SUBMITTED', 'APPROVED', 'REJECTED', 'RELEASED')),
  request_version integer NOT NULL CHECK (request_version > 0),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  note varchar(2000),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (request_id, request_version)
);

INSERT INTO permissions(id, code, name) VALUES
  (gen_random_uuid(), 'supplier-concession:requests:read', '查看特采申请'),
  (gen_random_uuid(), 'supplier-concession:requests:write', '提交特采申请'),
  (gen_random_uuid(), 'supplier-concession:requests:approve', '审批特采申请'),
  (gen_random_uuid(), 'supplier-concession:requests:release', '登记特采放行')
ON CONFLICT (code) DO NOTHING;
