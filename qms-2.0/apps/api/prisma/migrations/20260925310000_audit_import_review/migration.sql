ALTER TABLE audit_import_rows
  ADD COLUMN version integer NOT NULL DEFAULT 1,
  ADD COLUMN review_note varchar(2000),
  ADD COLUMN reviewed_by_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN reviewed_at timestamptz(3),
  ADD COLUMN problem_index_id uuid,
  ADD CONSTRAINT audit_import_rows_version_check CHECK (version > 0),
  ADD CONSTRAINT audit_import_rows_status_check CHECK (status IN ('PENDING_REVIEW', 'ACCEPTED', 'REJECTED', 'ISSUED'));

ALTER TABLE audit_import_rows
  ADD CONSTRAINT audit_import_rows_organization_id_problem_index_id_fkey
  FOREIGN KEY (organization_id, problem_index_id)
  REFERENCES problem_indexes(organization_id, id) ON DELETE RESTRICT;

CREATE INDEX audit_import_rows_review_idx
  ON audit_import_rows(organization_id, status, created_at DESC, id);
