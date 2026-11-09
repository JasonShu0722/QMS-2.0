CREATE TABLE integration_endpoints (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(1000) NOT NULL DEFAULT '',
  source_code VARCHAR(64) NOT NULL,
  source_name VARCHAR(120) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ENABLED','DISABLED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  return_receipt BOOLEAN NOT NULL DEFAULT true,
  max_body_bytes INTEGER NOT NULL DEFAULT 1048576 CHECK (max_body_bytes BETWEEN 1 AND 1048576),
  rate_per_minute INTEGER NOT NULL DEFAULT 60 CHECK (rate_per_minute BETWEEN 1 AND 300),
  body_retention_days INTEGER NOT NULL DEFAULT 7 CHECK (body_retention_days BETWEEN 1 AND 30),
  capacity_bytes INTEGER NOT NULL DEFAULT 268435456 CHECK (capacity_bytes BETWEEN 16777216 AND 1073741824),
  used_body_bytes BIGINT NOT NULL DEFAULT 0 CHECK (used_body_bytes >= 0),
  allowed_ips TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, code), UNIQUE (organization_id, id)
);
CREATE INDEX integration_endpoints_scope_created_idx ON integration_endpoints(organization_id, created_at, id);
CREATE TABLE integration_credentials (
  id UUID PRIMARY KEY, organization_id UUID NOT NULL, endpoint_id UUID NOT NULL,
  name VARCHAR(120) NOT NULL, secret_hash CHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ(3) NOT NULL, revoked_at TIMESTAMPTZ(3),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id, endpoint_id) REFERENCES integration_endpoints(organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX integration_credentials_scope_endpoint_idx ON integration_credentials(organization_id, endpoint_id, created_at, id);
CREATE TABLE integration_receipts (
  id UUID PRIMARY KEY, organization_id UUID NOT NULL, endpoint_id UUID NOT NULL,
  credential_id UUID NOT NULL REFERENCES integration_credentials(id) ON DELETE RESTRICT,
  message_id VARCHAR(128) NOT NULL, body_digest CHAR(64) NOT NULL,
  configuration_version INTEGER NOT NULL CHECK (configuration_version > 0), configuration_snapshot JSONB NOT NULL,
  received_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  body_expires_at TIMESTAMPTZ(3) NOT NULL, metadata_expires_at TIMESTAMPTZ(3) NOT NULL,
  payload_ciphertext TEXT, payload_bytes INTEGER NOT NULL CHECK (payload_bytes >= 0),
  FOREIGN KEY (organization_id, endpoint_id) REFERENCES integration_endpoints(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, endpoint_id, message_id)
);
CREATE INDEX integration_receipts_scope_time_idx ON integration_receipts(organization_id, received_at DESC, id DESC);
CREATE INDEX integration_receipts_endpoint_time_idx ON integration_receipts(organization_id, endpoint_id, received_at DESC, id DESC);
CREATE INDEX integration_receipts_body_expiry_idx ON integration_receipts(body_expires_at, id) WHERE payload_ciphertext IS NOT NULL;
CREATE INDEX integration_receipts_metadata_expiry_idx ON integration_receipts(metadata_expires_at, id);
CREATE TABLE integration_rate_windows (
  endpoint_id UUID NOT NULL REFERENCES integration_endpoints(id) ON DELETE RESTRICT,
  window_started_at TIMESTAMPTZ(3) NOT NULL, requests INTEGER NOT NULL CHECK (requests > 0),
  PRIMARY KEY (endpoint_id, window_started_at)
);
CREATE TABLE integration_scope_capacities (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE RESTRICT,
  used_body_bytes BIGINT NOT NULL DEFAULT 0 CHECK (used_body_bytes >= 0),
  receipt_count INTEGER NOT NULL DEFAULT 0 CHECK (receipt_count >= 0)
);
CREATE TABLE integration_request_attempts (
  id UUID PRIMARY KEY, organization_id UUID NOT NULL, endpoint_id UUID NOT NULL, credential_id UUID NOT NULL,
  message_id VARCHAR(128), receipt_id UUID,
  configuration_version INTEGER NOT NULL CHECK (configuration_version > 0), return_receipt BOOLEAN NOT NULL,
  status_code INTEGER NOT NULL CHECK (status_code BETWEEN 100 AND 599),
  outcome VARCHAR(24) NOT NULL CHECK (outcome IN ('RECEIVED','DUPLICATE','REJECTED','FAILED','UNKNOWN')),
  reason_code VARCHAR(64), duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  observed_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id, endpoint_id) REFERENCES integration_endpoints(organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX integration_attempts_scope_time_idx ON integration_request_attempts(organization_id, observed_at DESC, id DESC);
CREATE INDEX integration_attempts_message_idx ON integration_request_attempts(organization_id, message_id, observed_at DESC);
INSERT INTO permissions (id, code, name)
VALUES (gen_random_uuid(), 'integration:read', '查看API接口配置'),
       (gen_random_uuid(), 'integration:manage', '管理API接收接口'),
       (gen_random_uuid(), 'integration:credentials:manage', '管理API机器凭据'),
       (gen_random_uuid(), 'integration:receipts:read', '查询API接收记录'),
       (gen_random_uuid(), 'integration:payload:read', '查看API接收正文')
ON CONFLICT (code) DO NOTHING;
