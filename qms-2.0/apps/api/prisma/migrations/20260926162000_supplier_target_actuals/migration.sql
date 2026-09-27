CREATE TABLE supplier_quality_target_actuals (
  id uuid PRIMARY KEY,
  owner_organization_id uuid NOT NULL,
  target_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  target_version integer NOT NULL CHECK (target_version > 0),
  metrics jsonb NOT NULL CHECK (jsonb_typeof(metrics) = 'object'),
  target_metrics jsonb NOT NULL CHECK (jsonb_typeof(target_metrics) = 'object'),
  deviations jsonb NOT NULL CHECK (jsonb_typeof(deviations) = 'object'),
  note varchar(1000),
  created_by_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (owner_organization_id, target_id, version),
  FOREIGN KEY (owner_organization_id, target_id)
    REFERENCES supplier_quality_targets(owner_organization_id, id)
);

CREATE INDEX supplier_quality_target_actuals_history_idx
  ON supplier_quality_target_actuals(owner_organization_id, target_id, version DESC);
