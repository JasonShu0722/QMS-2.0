ALTER TABLE quality_metric_definitions
  ADD COLUMN formula_code varchar(64) NOT NULL DEFAULT 'RATIO',
  ADD COLUMN threshold_direction varchar(3) NOT NULL DEFAULT 'GTE',
  ADD COLUMN green_threshold numeric(20,6),
  ADD COLUMN yellow_threshold numeric(20,6),
  ADD COLUMN abnormal_period_limit integer NOT NULL DEFAULT 1;

ALTER TABLE quality_metric_definitions
  ADD CONSTRAINT quality_metric_definitions_threshold_direction_check CHECK (threshold_direction IN ('GTE', 'LTE')),
  ADD CONSTRAINT quality_metric_definitions_thresholds_check CHECK (
    (green_threshold IS NULL AND yellow_threshold IS NULL)
    OR (green_threshold IS NOT NULL AND yellow_threshold IS NOT NULL AND green_threshold >= 0 AND yellow_threshold >= 0)
  ),
  ADD CONSTRAINT quality_metric_definitions_abnormal_period_limit_check CHECK (abnormal_period_limit > 0);

CREATE INDEX quality_metric_definitions_formula_idx ON quality_metric_definitions (organization_id, formula_code);
