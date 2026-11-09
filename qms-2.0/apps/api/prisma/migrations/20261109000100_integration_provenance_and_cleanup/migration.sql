ALTER TABLE integration_credentials ADD COLUMN created_by_id UUID;
ALTER TABLE integration_scope_capacities
  ADD COLUMN last_cleanup_succeeded_at TIMESTAMPTZ(3),
  ADD COLUMN last_cleanup_failed_at TIMESTAMPTZ(3);
