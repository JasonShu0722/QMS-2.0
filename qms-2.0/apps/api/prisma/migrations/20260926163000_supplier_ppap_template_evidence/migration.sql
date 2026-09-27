CREATE TABLE supplier_ppap_item_evidence (
  id uuid PRIMARY KEY,
  owner_organization_id uuid NOT NULL,
  item_id uuid NOT NULL,
  file_id uuid NOT NULL REFERENCES file_objects(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (item_id, file_id),
  UNIQUE (file_id),
  FOREIGN KEY (owner_organization_id, item_id) REFERENCES supplier_ppap_items(owner_organization_id, id) ON DELETE CASCADE
);
CREATE INDEX supplier_ppap_item_evidence_scope_idx ON supplier_ppap_item_evidence(owner_organization_id, item_id);

-- Legacy free text never proves that a file was scanned and attached.
UPDATE supplier_ppap_items SET status = 'PENDING', version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE status = 'PROVIDED';
