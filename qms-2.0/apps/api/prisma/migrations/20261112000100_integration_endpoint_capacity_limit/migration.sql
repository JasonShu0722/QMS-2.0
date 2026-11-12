ALTER TABLE integration_endpoints DROP CONSTRAINT IF EXISTS integration_endpoints_capacity_bytes_check;
ALTER TABLE integration_endpoints ALTER COLUMN capacity_bytes TYPE BIGINT USING capacity_bytes::bigint;
ALTER TABLE integration_endpoints ADD CONSTRAINT integration_endpoints_capacity_bytes_check CHECK (capacity_bytes BETWEEN 16777216 AND 5368709120 AND capacity_bytes >= used_body_bytes);
