CREATE TABLE quality_metric_definitions (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  code varchar(64) NOT NULL,
  name varchar(200) NOT NULL,
  unit varchar(32) NOT NULL,
  numerator_label varchar(100) NOT NULL,
  denominator_label varchar(100) NOT NULL,
  formula_version varchar(32) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, code),
  UNIQUE (organization_id, id)
);

CREATE TABLE quality_data_snapshots (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  source_system varchar(32) NOT NULL,
  external_record_key varchar(200) NOT NULL,
  observed_at timestamptz(3) NOT NULL,
  payload jsonb NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'PENDING_REVIEW',
  recorded_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recorded_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, source_system, external_record_key),
  UNIQUE (organization_id, id)
);

CREATE TABLE quality_metric_facts (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  metric_definition_id uuid NOT NULL,
  period_start timestamptz(3) NOT NULL,
  period_end timestamptz(3) NOT NULL,
  numerator numeric(20,6) NOT NULL CHECK (numerator >= 0),
  denominator numeric(20,6) NOT NULL CHECK (denominator > 0),
  value numeric(20,6) NOT NULL,
  source_snapshot_id uuid,
  source_system varchar(32) NOT NULL DEFAULT 'MANUAL',
  source_record_key varchar(200),
  dimensions jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recorded_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id, metric_definition_id) REFERENCES quality_metric_definitions(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, source_snapshot_id) REFERENCES quality_data_snapshots(organization_id, id) ON DELETE RESTRICT,
  CHECK (period_end > period_start),
  UNIQUE (organization_id, metric_definition_id, period_start, period_end, source_system, source_record_key)
);

CREATE INDEX quality_metric_facts_trend_idx ON quality_metric_facts(organization_id, metric_definition_id, period_start);
CREATE INDEX quality_data_snapshots_source_idx ON quality_data_snapshots(organization_id, source_system, observed_at);
