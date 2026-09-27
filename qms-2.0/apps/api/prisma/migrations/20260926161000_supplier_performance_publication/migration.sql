ALTER TABLE supplier_performance_cards
  ADD COLUMN status varchar(16) NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN version integer NOT NULL DEFAULT 1,
  ADD COLUMN published_by_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN published_at timestamptz(3),
  ADD COLUMN updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD CONSTRAINT supplier_performance_card_status_check CHECK (status IN ('DRAFT', 'PUBLISHED')),
  ADD CONSTRAINT supplier_performance_card_version_check CHECK (version > 0),
  ADD CONSTRAINT supplier_performance_card_publication_check CHECK (
    (status = 'DRAFT' AND published_by_id IS NULL AND published_at IS NULL)
    OR (status = 'PUBLISHED' AND published_by_id IS NOT NULL AND published_at IS NOT NULL)
  ),
  ADD CONSTRAINT supplier_performance_card_supplier_key UNIQUE (owner_organization_id, id, supplier_organization_id);

ALTER TABLE supplier_performance_appeals
  ADD CONSTRAINT supplier_performance_appeal_supplier_fkey
  FOREIGN KEY (owner_organization_id, card_id, supplier_organization_id)
  REFERENCES supplier_performance_cards(owner_organization_id, id, supplier_organization_id) ON DELETE RESTRICT;

CREATE INDEX supplier_performance_cards_portal_idx
  ON supplier_performance_cards(supplier_organization_id, score_month DESC, id DESC)
  WHERE status = 'PUBLISHED';

CREATE INDEX supplier_performance_appeals_portal_idx
  ON supplier_performance_appeals(supplier_organization_id, created_at DESC, id DESC);

INSERT INTO permissions(id, code, name) VALUES
  (gen_random_uuid(), 'supplier-performance:cards:publish', '发布供应商绩效卡'),
  (gen_random_uuid(), 'supplier-performance:portal:cards:read', '查看本企业已发布绩效卡'),
  (gen_random_uuid(), 'supplier-performance:portal:appeals:read', '查看本企业绩效申诉'),
  (gen_random_uuid(), 'supplier-performance:portal:appeals:write', '提交本企业绩效申诉')
ON CONFLICT (code) DO NOTHING;
