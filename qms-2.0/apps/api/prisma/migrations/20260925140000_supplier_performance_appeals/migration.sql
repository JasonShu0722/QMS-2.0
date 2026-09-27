CREATE TABLE supplier_performance_appeals (
  id uuid PRIMARY KEY,
  owner_organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  card_id uuid NOT NULL,
  supplier_organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  status varchar(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'ACCEPTED', 'REJECTED')),
  reason varchar(4000) NOT NULL CHECK (length(trim(reason)) > 0),
  decision_note varchar(4000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decided_by_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  decided_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (owner_organization_id, id),
  FOREIGN KEY (owner_organization_id, card_id) REFERENCES supplier_performance_cards(owner_organization_id, id) ON DELETE RESTRICT,
  CHECK ((status IN ('ACCEPTED', 'REJECTED') AND decided_by_id IS NOT NULL AND decided_at IS NOT NULL) OR status NOT IN ('ACCEPTED', 'REJECTED'))
);
CREATE INDEX supplier_performance_appeals_scope_idx ON supplier_performance_appeals(owner_organization_id, status, created_at DESC);
INSERT INTO permissions(id, code, name) VALUES
  (gen_random_uuid(), 'supplier-performance:appeals:read', '查看供应商绩效申诉'),
  (gen_random_uuid(), 'supplier-performance:appeals:write', '提交供应商绩效申诉'),
  (gen_random_uuid(), 'supplier-performance:appeals:review', '复核供应商绩效申诉')
ON CONFLICT (code) DO NOTHING;
