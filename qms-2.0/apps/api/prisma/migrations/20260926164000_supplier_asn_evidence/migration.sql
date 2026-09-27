CREATE TABLE supplier_asn_evidence_refs (
  id uuid PRIMARY KEY,
  owner_organization_id uuid NOT NULL,
  asn_id uuid NOT NULL,
  file_id uuid NOT NULL REFERENCES file_objects(id),
  file_version integer NOT NULL CHECK (file_version > 0),
  sha256 char(64) NOT NULL,
  scanned_at timestamptz(3) NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (owner_organization_id, asn_id, file_id),
  UNIQUE (owner_organization_id, asn_id, position),
  FOREIGN KEY (owner_organization_id, asn_id)
    REFERENCES supplier_asn_records(owner_organization_id, id) ON DELETE CASCADE
);

CREATE INDEX supplier_asn_evidence_refs_asn_idx
  ON supplier_asn_evidence_refs(owner_organization_id, asn_id, position);
