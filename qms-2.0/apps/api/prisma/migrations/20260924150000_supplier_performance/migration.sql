CREATE TABLE supplier_performance_cards (
  id uuid PRIMARY KEY,
  owner_organization_id uuid NOT NULL REFERENCES organizations(id),
  profile_id uuid NOT NULL,
  supplier_organization_id uuid NOT NULL,
  supplier_name varchar(200) NOT NULL,
  score_month date NOT NULL,
  inspection_count integer NOT NULL CHECK (inspection_count > 0),
  pass_count integer NOT NULL CHECK (pass_count >= 0 AND pass_count <= inspection_count),
  incoming_score numeric(6,2) NOT NULL CHECK (incoming_score BETWEEN 0 AND 100),
  cooperation_score integer NOT NULL CHECK (cooperation_score BETWEEN 0 AND 100),
  incoming_weight integer NOT NULL CHECK (incoming_weight BETWEEN 0 AND 100),
  cooperation_weight integer NOT NULL CHECK (cooperation_weight BETWEEN 0 AND 100),
  cooperation_note varchar(2000) NOT NULL CHECK (length(trim(cooperation_note)) > 0),
  total_score numeric(6,2) NOT NULL CHECK (total_score BETWEEN 0 AND 100),
  source_inspections jsonb NOT NULL CHECK (jsonb_typeof(source_inspections) = 'array'),
  created_by_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (owner_organization_id, id),
  CONSTRAINT supplier_performance_weights_check CHECK (incoming_weight + cooperation_weight = 100),
  CONSTRAINT supplier_performance_month_check CHECK (score_month = date_trunc('month', score_month)::date),
  CONSTRAINT supplier_performance_profile_fkey FOREIGN KEY (profile_id, owner_organization_id, supplier_organization_id)
    REFERENCES supplier_business_profiles(id, owner_organization_id, supplier_organization_id),
  CONSTRAINT supplier_performance_month_unique UNIQUE (owner_organization_id, profile_id, score_month)
);
CREATE INDEX supplier_performance_cards_scope_idx ON supplier_performance_cards(owner_organization_id, score_month DESC, id DESC);

INSERT INTO permissions(id, code, name) VALUES
  (gen_random_uuid(), 'supplier-performance:cards:read', '查看供应商绩效卡'),
  (gen_random_uuid(), 'supplier-performance:cards:write', '记录供应商绩效卡')
ON CONFLICT (code) DO NOTHING;
