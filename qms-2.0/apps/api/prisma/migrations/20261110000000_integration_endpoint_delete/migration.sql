ALTER TABLE integration_endpoints ADD COLUMN deleted_at TIMESTAMPTZ(3);
ALTER TABLE integration_endpoints DROP CONSTRAINT integration_endpoints_organization_id_code_key;
CREATE UNIQUE INDEX integration_endpoints_active_code_key
  ON integration_endpoints (organization_id, code) WHERE deleted_at IS NULL;
ALTER TABLE integration_endpoints ADD CONSTRAINT integration_endpoints_deleted_disabled
  CHECK (deleted_at IS NULL OR status = 'DISABLED');
