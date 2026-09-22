ALTER TABLE file_objects DROP CONSTRAINT file_available_evidence_check;
ALTER TABLE file_objects ADD CONSTRAINT file_available_evidence_check CHECK (status <> 'AVAILABLE' OR (
  scan_status = 'CLEAN' AND verified_sha256 IS NOT NULL AND verified_sha256 = sha256
  AND object_version_id IS NOT NULL AND upload_completed_at IS NOT NULL AND scanned_at IS NOT NULL
  AND scanner_engine IS NOT NULL AND length(scanner_engine) > 0 AND verified_content_type = content_type
  AND verified_size_bytes = size_bytes AND resource_type IS NOT NULL AND resource_id IS NOT NULL AND resource_version > 0
) IS TRUE);
