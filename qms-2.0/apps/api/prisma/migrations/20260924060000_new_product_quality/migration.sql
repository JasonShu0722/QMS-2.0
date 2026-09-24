CREATE TABLE new_product_projects (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  code varchar(100) NOT NULL CHECK (length(trim(code)) > 0),
  name varchar(200) NOT NULL CHECK (length(trim(name)) > 0),
  product_code varchar(100) NOT NULL CHECK (length(trim(product_code)) > 0),
  status varchar(32) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, code),
  UNIQUE (organization_id, id)
);

CREATE TABLE new_product_stages (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  code varchar(100) NOT NULL CHECK (length(trim(code)) > 0),
  name varchar(200) NOT NULL CHECK (length(trim(name)) > 0),
  status varchar(32) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'PASSED', 'REJECTED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  reviewed_by_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at timestamptz(3),
  created_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id, project_id) REFERENCES new_product_projects(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, project_id, code),
  UNIQUE (organization_id, id)
);

CREATE TABLE new_product_deliverables (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  stage_id uuid NOT NULL,
  code varchar(100) NOT NULL CHECK (length(trim(code)) > 0),
  name varchar(200) NOT NULL CHECK (length(trim(name)) > 0),
  required boolean NOT NULL DEFAULT true,
  evidence_object_id uuid REFERENCES file_objects(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id, stage_id) REFERENCES new_product_stages(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, stage_id, code),
  UNIQUE (organization_id, id)
);

CREATE TABLE new_product_lessons (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  title varchar(200) NOT NULL CHECK (length(trim(title)) > 0),
  lesson text NOT NULL CHECK (length(trim(lesson)) BETWEEN 1 AND 10000),
  product_code varchar(100),
  source_kind varchar(32) NOT NULL DEFAULT 'MANUAL' CHECK (source_kind = 'MANUAL'),
  created_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, id)
);

CREATE TABLE new_product_lesson_checks (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  lesson_id uuid NOT NULL,
  avoided boolean,
  reason text,
  evidence_object_id uuid REFERENCES file_objects(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  confirmed_by_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  confirmed_at timestamptz(3),
  created_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id, project_id) REFERENCES new_product_projects(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, lesson_id) REFERENCES new_product_lessons(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, project_id, lesson_id),
  UNIQUE (organization_id, id),
  CHECK (avoided IS NULL OR (evidence_object_id IS NOT NULL AND (avoided OR length(trim(coalesce(reason, ''))) > 0)))
);

CREATE TABLE new_product_trial_batches (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  code varchar(100) NOT NULL CHECK (length(trim(code)) > 0),
  work_order_code varchar(100),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id, project_id) REFERENCES new_product_projects(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, project_id, code),
  UNIQUE (organization_id, id)
);

CREATE TABLE new_product_trial_metrics (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  code varchar(40) NOT NULL CHECK (code IN ('INPUT', 'OUTPUT', 'FIRST_PASS', 'DEFECT', 'CPK', 'DIMENSION_PASS_RATE')),
  target numeric(16, 4) NOT NULL CHECK (target >= 0),
  actual numeric(16, 4) NOT NULL CHECK (actual >= 0),
  comparison varchar(3) NOT NULL CHECK (comparison IN ('GTE', 'LTE')),
  source varchar(20) NOT NULL CHECK (source = 'MANUAL'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  recorded_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recorded_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id, batch_id) REFERENCES new_product_trial_batches(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, batch_id, code)
);

INSERT INTO permissions(id, code, name) VALUES
  (gen_random_uuid(), 'new-product-quality:projects:read', '查看新品质量项目'),
  (gen_random_uuid(), 'new-product-quality:projects:write', '维护新品质量项目')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE new_product_defect_selections (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  defect_id uuid NOT NULL,
  source_version integer NOT NULL CHECK (source_version > 0),
  source_snapshot jsonb NOT NULL,
  selection_reason varchar(2000),
  selected_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  selected_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id, project_id) REFERENCES new_product_projects(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, defect_id) REFERENCES process_defects(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, project_id, defect_id),
  UNIQUE (organization_id, id)
);
CREATE INDEX new_product_defect_selections_project_id_idx ON new_product_defect_selections(organization_id, project_id, selected_at);

CREATE TABLE new_product_issues (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  trial_batch_id uuid REFERENCES new_product_trial_batches(id) ON DELETE RESTRICT,
  problem_index_id uuid,
  response_form varchar(16) NOT NULL CHECK (response_form IN ('BRIEF', 'EIGHT_D')),
  complexity varchar(16) NOT NULL CHECK (complexity IN ('SIMPLE', 'COMPLEX')),
  severity varchar(64) NOT NULL CHECK (length(trim(severity)) > 0),
  status varchar(32) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ESCALATED', 'CLOSED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id, project_id) REFERENCES new_product_projects(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, trial_batch_id) REFERENCES new_product_trial_batches(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, id)
);

CREATE TABLE new_product_issue_sources (
  organization_id uuid NOT NULL,
  issue_id uuid NOT NULL,
  selection_id uuid NOT NULL,
  source_version integer NOT NULL CHECK (source_version > 0),
  source_snapshot jsonb NOT NULL,
  PRIMARY KEY (organization_id, issue_id, selection_id),
  FOREIGN KEY (organization_id, issue_id) REFERENCES new_product_issues(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, selection_id) REFERENCES new_product_defect_selections(organization_id, id) ON DELETE RESTRICT
);

CREATE TABLE new_product_legacy_issues (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  description text NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 10000),
  risk_level varchar(32) NOT NULL CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  status varchar(32) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ACCEPTED', 'CLOSED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  accepted_by_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  accepted_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id, project_id) REFERENCES new_product_projects(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, id)
);

CREATE TABLE new_product_mass_production_approvals (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  decision varchar(16) NOT NULL CHECK (decision IN ('APPROVE', 'REJECT')),
  risk_statement text NOT NULL CHECK (length(trim(risk_statement)) BETWEEN 1 AND 10000),
  evidence_object_id uuid REFERENCES file_objects(id) ON DELETE RESTRICT,
  signed_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  signed_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  FOREIGN KEY (organization_id, project_id) REFERENCES new_product_projects(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, project_id)
);
