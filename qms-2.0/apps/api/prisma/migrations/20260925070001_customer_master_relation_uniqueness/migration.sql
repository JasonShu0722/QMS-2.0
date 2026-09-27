BEGIN;

ALTER TABLE customer_quality_customer_relations
  DROP CONSTRAINT IF EXISTS customer_quality_customer_rel_organization_id_customer_id_r_key;

ALTER TABLE customer_quality_customer_relations
  ADD CONSTRAINT customer_quality_customer_relation_unique
  UNIQUE NULLS NOT DISTINCT (organization_id, customer_id, relation_type, related_customer_id, related_code);

CREATE UNIQUE INDEX IF NOT EXISTS customer_quality_customer_one_parent_uq
  ON customer_quality_customer_relations (organization_id, customer_id)
  WHERE relation_type = 'CUSTOMER_PARENT';

COMMIT;
