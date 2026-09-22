ALTER TABLE file_objects
  ADD COLUMN verified_sha256 CHAR(64),
  ADD COLUMN object_version_id VARCHAR(1024),
  ADD COLUMN verified_content_type VARCHAR(150),
  ADD COLUMN verified_size_bytes BIGINT,
  ADD COLUMN upload_expires_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN upload_completed_at TIMESTAMPTZ(3),
  ADD COLUMN resource_version INTEGER,
  ADD COLUMN scan_status VARCHAR(24) NOT NULL DEFAULT 'WAITING_UPLOAD',
  ADD COLUMN scanned_at TIMESTAMPTZ(3),
  ADD COLUMN scanner_engine VARCHAR(255),
  ADD COLUMN scan_reason VARCHAR(64),
  ADD COLUMN deleted_at TIMESTAMPTZ(3),
  ADD COLUMN deleted_by_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN retain_until TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE file_objects SET status = 'QUARANTINED' WHERE status = 'AVAILABLE';
UPDATE file_objects SET scan_status = 'EXPIRED', scan_reason = 'FILE_LEGACY_UNVERIFIED', upload_expires_at = created_at,
  retain_until = CURRENT_TIMESTAMP + INTERVAL '7 days';
ALTER TABLE file_objects
  ADD CONSTRAINT file_scan_status_check CHECK (scan_status IN ('WAITING_UPLOAD', 'PENDING', 'CLEAN', 'REJECTED', 'ERROR', 'EXPIRED')),
  ADD CONSTRAINT file_verified_hash_check CHECK (verified_sha256 IS NULL OR verified_sha256 ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT file_version_id_check CHECK (object_version_id IS NULL OR (length(object_version_id) > 0 AND object_version_id <> 'null')),
  ADD CONSTRAINT file_available_evidence_check CHECK (status <> 'AVAILABLE' OR (
    scan_status = 'CLEAN' AND verified_sha256 IS NOT NULL AND verified_sha256 = sha256
    AND object_version_id IS NOT NULL AND upload_completed_at IS NOT NULL AND scanned_at IS NOT NULL
    AND scanner_engine IS NOT NULL AND length(scanner_engine) > 0 AND verified_content_type = content_type
    AND verified_size_bytes = size_bytes AND resource_type IS NOT NULL AND resource_id IS NOT NULL AND resource_version > 0
  ));
CREATE INDEX file_objects_resource_scope_idx ON file_objects(organization_id, resource_type, resource_id, status);
CREATE INDEX file_objects_scan_status_upload_expires_at_idx ON file_objects(scan_status, upload_expires_at);
CREATE INDEX file_objects_deleted_by_id_idx ON file_objects(deleted_by_id);
CREATE TABLE file_upload_receipts (
  id UUID PRIMARY KEY,
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  key VARCHAR(128) NOT NULL,
  request_digest CHAR(64) NOT NULL,
  file_id UUID NOT NULL REFERENCES file_objects(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT file_upload_receipts_actor_user_id_key_key UNIQUE(actor_user_id, key)
);
CREATE INDEX file_upload_receipts_file_id_idx ON file_upload_receipts(file_id);
