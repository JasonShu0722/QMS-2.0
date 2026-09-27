-- A nullable target_month must not allow duplicate annual revision numbers.
CREATE UNIQUE INDEX supplier_quality_targets_revision_strict_idx
  ON supplier_quality_targets (owner_organization_id, profile_id, period_type, target_year, target_month, revision)
  NULLS NOT DISTINCT;
