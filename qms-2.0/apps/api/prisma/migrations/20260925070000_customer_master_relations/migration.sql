CREATE TABLE customer_quality_customer_relations (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL,
  relation_type varchar(32) NOT NULL CHECK (relation_type IN ('CUSTOMER_PARENT', 'VEHICLE_MODEL', 'PROJECT', 'PRODUCT')),
  related_customer_id uuid,
  related_code varchar(100),
  related_name varchar(200),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id, customer_id) REFERENCES customer_quality_customers(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, related_customer_id) REFERENCES customer_quality_customers(organization_id, id) ON DELETE RESTRICT,
  CHECK ((relation_type = 'CUSTOMER_PARENT' AND related_customer_id IS NOT NULL AND related_code IS NULL AND related_name IS NULL)
    OR (relation_type <> 'CUSTOMER_PARENT' AND related_customer_id IS NULL AND length(trim(coalesce(related_code, ''))) > 0 AND length(trim(coalesce(related_name, ''))) > 0)),
  CHECK (related_customer_id IS NULL OR related_customer_id <> customer_id),
  UNIQUE NULLS NOT DISTINCT (organization_id, customer_id, relation_type, related_customer_id, related_code)
);
CREATE INDEX customer_quality_customer_relations_customer_idx ON customer_quality_customer_relations(organization_id, customer_id, relation_type);
CREATE UNIQUE INDEX customer_quality_customer_one_parent_uq ON customer_quality_customer_relations(organization_id, customer_id) WHERE relation_type = 'CUSTOMER_PARENT';
