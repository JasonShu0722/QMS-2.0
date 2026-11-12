ALTER TABLE integration_endpoints ALTER COLUMN capacity_bytes TYPE BIGINT USING capacity_bytes::bigint;
