CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE department_management_bindings (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  department_id uuid NOT NULL,
  responsibility varchar(32) NOT NULL CHECK (responsibility IN ('SECTION_MANAGER', 'MINISTER')),
  position_id uuid NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id, department_id) REFERENCES departments(organization_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY (organization_id, position_id) REFERENCES positions(organization_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE UNIQUE INDEX department_management_bindings_active_key
  ON department_management_bindings(organization_id, department_id, responsibility) WHERE status = 'ACTIVE';
CREATE INDEX department_management_bindings_position_idx ON department_management_bindings(organization_id, position_id);

CREATE TABLE department_minister_scopes (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  department_id uuid NOT NULL,
  section_department_id uuid NOT NULL,
  minister_assignment_id uuid NOT NULL,
  valid_from timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  valid_to timestamptz(3),
  status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (department_id <> section_department_id),
  CHECK (valid_to IS NULL OR valid_from < valid_to),
  FOREIGN KEY (organization_id, department_id) REFERENCES departments(organization_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY (organization_id, section_department_id) REFERENCES departments(organization_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY (organization_id, minister_assignment_id) REFERENCES user_positions(organization_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT department_minister_scopes_no_overlap EXCLUDE USING gist (
    organization_id WITH =,
    section_department_id WITH =,
    tstzrange(valid_from, valid_to, '[)') WITH &&
  ) WHERE (status = 'ACTIVE')
);

CREATE INDEX department_minister_scopes_department_idx ON department_minister_scopes(organization_id, department_id);
CREATE INDEX department_minister_scopes_assignment_idx ON department_minister_scopes(organization_id, minister_assignment_id);
