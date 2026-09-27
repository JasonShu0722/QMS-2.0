ALTER TABLE quality_data_snapshots
  ADD COLUMN metric_definition_id uuid,
  ADD COLUMN metric_version integer,
  ADD COLUMN problem_index_id uuid,
  ADD COLUMN problem_version integer,
  ADD COLUMN domain_code varchar(100),
  ADD COLUMN domain_source_type varchar(100),
  ADD COLUMN domain_source_id uuid,
  ADD COLUMN verified_by_id uuid,
  ADD COLUMN verified_at timestamptz(3);

ALTER TABLE quality_data_snapshots
  ADD CONSTRAINT quality_snapshots_metric_fk FOREIGN KEY (organization_id, metric_definition_id)
    REFERENCES quality_metric_definitions(organization_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT quality_snapshots_problem_fk FOREIGN KEY (organization_id, problem_index_id)
    REFERENCES problem_indexes(organization_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT quality_snapshots_verified_by_fk FOREIGN KEY (verified_by_id)
    REFERENCES users(id) ON DELETE RESTRICT,
  ADD CONSTRAINT quality_snapshots_internal_check CHECK (
    (status = 'PENDING_REVIEW' AND source_system <> 'INTERNAL' AND metric_definition_id IS NULL AND problem_index_id IS NULL AND verified_at IS NULL)
    OR (status = 'VERIFIED' AND source_system = 'INTERNAL' AND metric_definition_id IS NOT NULL AND metric_version > 0
      AND problem_index_id IS NOT NULL AND problem_version > 0 AND domain_code IS NOT NULL
      AND domain_source_type IS NOT NULL AND domain_source_id IS NOT NULL AND verified_by_id IS NOT NULL AND verified_at IS NOT NULL)
  );

CREATE INDEX quality_snapshots_internal_source_idx
  ON quality_data_snapshots (organization_id, problem_index_id, problem_version, metric_definition_id);
