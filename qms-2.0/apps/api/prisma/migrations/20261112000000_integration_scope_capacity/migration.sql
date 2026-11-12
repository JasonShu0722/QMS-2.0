ALTER TABLE integration_scope_capacities ADD COLUMN capacity_bytes BIGINT NOT NULL DEFAULT 1073741824;
ALTER TABLE integration_scope_capacities ADD CONSTRAINT integration_scope_capacities_capacity_bytes_check CHECK (capacity_bytes BETWEEN 16777216 AND 10737418240 AND capacity_bytes >= used_body_bytes);
