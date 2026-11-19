UPDATE process_defects AS defect
SET pending_configuration = true,
    completion_next_attempt_at = NULL
FROM organizations AS organization
WHERE defect.organization_id = organization.id
  AND defect.registration_version = 1
  AND defect.archived_at IS NULL
  AND defect.product_category IS NULL
  AND (NOT defect.pending_configuration OR defect.completion_next_attempt_at IS NOT NULL)
  AND organization.type = 'INTERNAL'
  AND organization.deleted_at IS NULL;
