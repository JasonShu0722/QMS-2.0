ALTER TABLE user_positions ADD CONSTRAINT user_positions_organization_id_id_key UNIQUE (organization_id, id);

CREATE TABLE component_project_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  code VARCHAR(100) NOT NULL CHECK (code = btrim(code) AND length(code) > 0),
  name VARCHAR(200) NOT NULL CHECK (name = btrim(name) AND length(name) > 0),
  stage VARCHAR(30) NOT NULL CHECK (stage IN ('NEW_PRODUCT', 'MASS_PRODUCTION')),
  customer_engineer_assignment_id UUID,
  project_engineer_assignment_id UUID,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_user_id UUID NOT NULL,
  updated_by_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, code),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY (organization_id, customer_engineer_assignment_id) REFERENCES user_positions(organization_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY (organization_id, project_engineer_assignment_id) REFERENCES user_positions(organization_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE component_project_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  component_code VARCHAR(100) NOT NULL CHECK (component_code = btrim(component_code) AND length(component_code) > 0),
  project_record_id UUID NOT NULL,
  product_category VARCHAR(100) NOT NULL CHECK (product_category = btrim(product_category) AND length(product_category) > 0),
  product_subcategory VARCHAR(100) CHECK (product_subcategory = btrim(product_subcategory) AND length(product_subcategory) > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_user_id UUID NOT NULL,
  updated_by_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, component_code),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY (organization_id, project_record_id) REFERENCES component_project_records(organization_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX component_project_records_customer_assignment_idx ON component_project_records(organization_id, customer_engineer_assignment_id);
CREATE INDEX component_project_records_project_assignment_idx ON component_project_records(organization_id, project_engineer_assignment_id);
CREATE INDEX component_project_mappings_project_idx ON component_project_mappings(organization_id, project_record_id);
