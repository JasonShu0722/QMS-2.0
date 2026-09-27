ALTER TABLE supplier_ppap_items
  ADD COLUMN review_note text,
  ADD COLUMN reviewed_by_id uuid REFERENCES users(id),
  ADD COLUMN reviewed_at timestamptz(3);

ALTER TABLE supplier_ppap_packages
  ADD COLUMN requalification_due_at timestamptz(3),
  ADD COLUMN last_requalified_at timestamptz(3),
  ADD COLUMN requalification_note text;

CREATE INDEX supplier_ppap_packages_requalification_idx
  ON supplier_ppap_packages(owner_organization_id, requalification_due_at, status);
