ALTER TABLE customer_quality_complaints
  ADD COLUMN eight_d_content jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN eight_d_version integer NOT NULL DEFAULT 0 CHECK (eight_d_version >= 0),
  ADD COLUMN eight_d_status varchar(24) NOT NULL DEFAULT 'DRAFT' CHECK (eight_d_status IN ('DRAFT', 'SUBMITTED', 'APPROVED')),
  ADD COLUMN eight_d_approval_level varchar(2) CHECK (eight_d_approval_level IS NULL OR eight_d_approval_level IN ('L1', 'L2', 'L3')),
  ADD COLUMN eight_d_submitted_at timestamptz(3),
  ADD COLUMN eight_d_submitted_by_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN eight_d_approved_at timestamptz(3),
  ADD COLUMN eight_d_approved_by_id uuid REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE customer_quality_complaints
  ADD CONSTRAINT customer_quality_complaints_8d_approval_check CHECK (
    (eight_d_status = 'DRAFT' AND eight_d_approved_at IS NULL AND eight_d_approved_by_id IS NULL)
    OR (eight_d_status IN ('SUBMITTED', 'APPROVED'))
  );
