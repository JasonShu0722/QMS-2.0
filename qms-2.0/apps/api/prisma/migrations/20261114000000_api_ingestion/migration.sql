CREATE UNIQUE INDEX integration_receipts_scope_identity ON integration_receipts(organization_id,id);
CREATE TABLE integration_ingestion_rules (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  endpoint_id UUID NOT NULL,
  creator_id UUID NOT NULL,
  actor_snapshot JSONB NOT NULL,
  configuration JSONB NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  target TEXT NOT NULL CHECK (target IN ('SUPPLIER','CUSTOMER','MATERIAL','COMPONENT')),
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,id),
  FOREIGN KEY (organization_id,endpoint_id) REFERENCES integration_endpoints(organization_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX integration_ingestion_one_enabled_target ON integration_ingestion_rules(organization_id,endpoint_id,target) WHERE enabled;
CREATE TABLE integration_ingestion_queues (
  organization_id UUID NOT NULL,
  endpoint_id UUID NOT NULL,
  next_sequence BIGINT NOT NULL DEFAULT 1,
  PRIMARY KEY (organization_id,endpoint_id),
  FOREIGN KEY (organization_id,endpoint_id) REFERENCES integration_endpoints(organization_id,id) ON DELETE CASCADE
);
CREATE TABLE integration_ingestion_previews (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL,
  endpoint_id UUID NOT NULL,
  rule_id UUID NOT NULL,
  rule_version INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('SINGLE','HISTORY')),
  selections JSONB NOT NULL,
  expires_at TIMESTAMPTZ(3) NOT NULL,
  FOREIGN KEY(organization_id,rule_id) REFERENCES integration_ingestion_rules(organization_id,id) ON DELETE CASCADE
);
CREATE INDEX integration_ingestion_previews_expiry ON integration_ingestion_previews(expires_at);
CREATE TABLE integration_ingestion_jobs (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  endpoint_id UUID NOT NULL,
  receipt_id UUID,
  rule_id UUID NOT NULL,
  rule_version INTEGER NOT NULL,
  rule_snapshot JSONB NOT NULL,
  actor_snapshot JSONB NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('AUTO','SINGLE','HISTORY')),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PAUSED','BLOCKED','COMPLETED','CANCELLED')),
  sequence BIGINT NOT NULL,
  generation INTEGER NOT NULL DEFAULT 0 CHECK(generation>=0),
  selection_key INTEGER NOT NULL DEFAULT -1,
  reprocess_reason TEXT,
  error_code TEXT,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ(3),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,endpoint_id,sequence),
  UNIQUE(organization_id,receipt_id,rule_id,rule_version,generation,selection_key),
  FOREIGN KEY(organization_id,endpoint_id) REFERENCES integration_endpoints(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY(organization_id,receipt_id) REFERENCES integration_receipts(organization_id,id) ON DELETE SET NULL (receipt_id)
);
CREATE INDEX integration_ingestion_jobs_due ON integration_ingestion_jobs(organization_id,endpoint_id,sequence) WHERE status IN ('PENDING','PAUSED','BLOCKED');
CREATE TABLE integration_ingestion_items (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id UUID NOT NULL,
  receipt_id UUID NOT NULL,
  rule_id UUID NOT NULL,
  rule_version INTEGER NOT NULL,
  generation INTEGER NOT NULL DEFAULT 0,
  row_index INTEGER NOT NULL CHECK(row_index>=0),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','INSERTED','UPDATED','UNCHANGED','FILTERED','EXISTING_SKIPPED','AWAITING_CONFIRMATION','VALIDATION_FAILED','PROCESSING_FAILED','SKIPPED','CANCELLED')),
  target_id UUID,
  target_version INTEGER,
  source_updated_at TIMESTAMPTZ(3),
  error_code TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(job_id,row_index),
  UNIQUE(organization_id,receipt_id,rule_id,rule_version,row_index,generation),
  FOREIGN KEY(organization_id,job_id) REFERENCES integration_ingestion_jobs(organization_id,id) ON DELETE CASCADE
);
CREATE INDEX integration_ingestion_items_pending ON integration_ingestion_items(job_id,row_index) WHERE status='PENDING';
CREATE TABLE integration_ingestion_target_versions (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  target TEXT NOT NULL,
  target_id UUID NOT NULL,
  endpoint_id UUID NOT NULL,
  receipt_received_at TIMESTAMPTZ(3) NOT NULL,
  source_updated_at TIMESTAMPTZ(3),
  target_version INTEGER NOT NULL,
  PRIMARY KEY(organization_id,target,target_id)
);
