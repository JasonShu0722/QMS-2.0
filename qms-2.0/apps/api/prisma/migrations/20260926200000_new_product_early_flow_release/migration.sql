ALTER TABLE new_product_early_flows
  ADD COLUMN monitoring_frequency varchar(200),
  ADD COLUMN exit_criteria text;

UPDATE new_product_early_flows
SET monitoring_frequency = '未记录', exit_criteria = '未记录'
WHERE monitoring_frequency IS NULL;

ALTER TABLE new_product_early_flows
  ALTER COLUMN monitoring_frequency SET NOT NULL,
  ALTER COLUMN exit_criteria SET NOT NULL;

ALTER TABLE new_product_early_flows
  ADD CONSTRAINT new_product_early_flows_monitoring_frequency_check CHECK (length(trim(monitoring_frequency)) BETWEEN 1 AND 200),
  ADD CONSTRAINT new_product_early_flows_exit_criteria_check CHECK (length(trim(exit_criteria)) BETWEEN 1 AND 10000);

CREATE TABLE new_product_early_flow_releases (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  early_flow_id uuid NOT NULL,
  flow_version integer NOT NULL CHECK (flow_version > 0),
  decision varchar(8) NOT NULL CHECK (decision IN ('APPROVE', 'REJECT')),
  note text,
  evidence_object_id uuid NOT NULL,
  decided_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decided_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, early_flow_id, flow_version),
  FOREIGN KEY (organization_id, early_flow_id) REFERENCES new_product_early_flows(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (evidence_object_id) REFERENCES file_objects(id) ON DELETE RESTRICT
);

CREATE INDEX new_product_early_flow_releases_lookup_idx
  ON new_product_early_flow_releases(organization_id, early_flow_id, decided_at DESC);
