ALTER TABLE quality_metric_definitions
  ADD COLUMN domain varchar(32) NOT NULL DEFAULT 'UNSPECIFIED';

ALTER TABLE quality_metric_definitions
  ADD CONSTRAINT quality_metric_definitions_domain_check
  CHECK (domain IN ('SUPPLIER', 'PROCESS', 'CUSTOMER', 'NEW_PRODUCT', 'UNSPECIFIED'));

CREATE INDEX quality_metric_definitions_domain_idx
  ON quality_metric_definitions (organization_id, domain, code);
