-- Preserve legacy facts and events. New columns stay NULL on historical records.
ALTER TABLE customer_quality_complaints
  ALTER COLUMN customer_id DROP NOT NULL,
  ALTER COLUMN complaint_type DROP NOT NULL,
  ALTER COLUMN defect_description DROP NOT NULL,
  ALTER COLUMN severity DROP NOT NULL,
  ALTER COLUMN severity_policy_version DROP NOT NULL,
  ALTER COLUMN severity_snapshot DROP NOT NULL,
  ADD COLUMN ledger_status varchar(16) CHECK (ledger_status IN ('FOLLOWING', 'CLOSED')),
  ADD COLUMN ledger_raw jsonb,
  ADD COLUMN ledger_normalized jsonb,
  ADD COLUMN ledger_mapping_snapshot jsonb,
  ADD COLUMN quality_engineer_id uuid,
  ADD COLUMN quality_engineer_assignment_id uuid,
  ADD COLUMN quality_engineer_source varchar(16) CHECK (quality_engineer_source IN ('MANUAL', 'MAPPING')),
  ADD COLUMN registered_stage varchar(24) CHECK (registered_stage IN ('NEW_PRODUCT', 'MASS_PRODUCTION')),
  ADD COLUMN courier_number varchar(200),
  ADD COLUMN received_on date,
  ADD CONSTRAINT customer_complaint_engineer_scope_fk FOREIGN KEY (organization_id, quality_engineer_id) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT customer_complaint_engineer_assignment_fk FOREIGN KEY (quality_engineer_assignment_id) REFERENCES user_positions(id) ON DELETE RESTRICT,
  ADD CONSTRAINT customer_complaint_ledger_raw_check CHECK (ledger_raw IS NULL OR (jsonb_typeof(ledger_raw) = 'object' AND octet_length(ledger_raw::text) <= 128000)),
  ADD CONSTRAINT customer_complaint_ledger_normalized_check CHECK (ledger_normalized IS NULL OR jsonb_typeof(ledger_normalized) = 'object');

-- Remove only the original after-sales completeness check, not external identity checks.
DO $$
DECLARE constraint_name text;
BEGIN
  FOR constraint_name IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'customer_quality_complaints'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%complaint_type%AFTER_SALES%'
      AND pg_get_constraintdef(oid) LIKE '%purchase_date%'
  LOOP
    EXECUTE format('ALTER TABLE customer_quality_complaints DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

CREATE INDEX customer_complaint_ledger_engineer_idx ON customer_quality_complaints (organization_id, quality_engineer_id, created_at DESC);
