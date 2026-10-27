CREATE TABLE customer_eight_d_bindings (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE RESTRICT,
  workflow_definition_id uuid NOT NULL REFERENCES workflow_definitions(id) ON DELETE RESTRICT,
  workflow_version_id uuid NOT NULL REFERENCES workflow_versions(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE customer_eight_d_reports (
  problem_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  responsible_section_department_id uuid NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  professional_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  content_version integer NOT NULL DEFAULT 1 CHECK (content_version > 0),
  analysis_completed_at timestamptz(3),
  analysis_due_at timestamptz(3),
  submission_due_at timestamptz(3),
  closure_due_at timestamptz(3),
  submitted_at timestamptz(3),
  closed_revision_id uuid,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, problem_id),
  FOREIGN KEY (organization_id, problem_id) REFERENCES problem_indexes(organization_id, id) ON DELETE RESTRICT
);

CREATE TABLE customer_eight_d_collaborators (
  organization_id uuid NOT NULL,
  problem_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  added_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  added_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, problem_id, user_id),
  FOREIGN KEY (organization_id, problem_id) REFERENCES customer_eight_d_reports(organization_id, problem_id) ON DELETE RESTRICT
);

CREATE TABLE customer_eight_d_revisions (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  problem_id uuid NOT NULL,
  content_version integer NOT NULL CHECK (content_version > 0),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  recorded_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, problem_id, id),
  FOREIGN KEY (organization_id, problem_id) REFERENCES customer_eight_d_reports(organization_id, problem_id) ON DELETE RESTRICT
);
ALTER TABLE customer_eight_d_reports ADD CONSTRAINT customer_eight_d_closed_revision_fkey
  FOREIGN KEY (organization_id, problem_id, closed_revision_id)
  REFERENCES customer_eight_d_revisions(organization_id, problem_id, id) ON DELETE RESTRICT;

CREATE TABLE customer_eight_d_source_confirmations (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  problem_id uuid NOT NULL,
  source_id uuid NOT NULL REFERENCES customer_quality_complaints(id) ON DELETE RESTRICT,
  related_problem_ids jsonb NOT NULL CHECK (jsonb_typeof(related_problem_ids) = 'array'),
  recurrence varchar(32) NOT NULL CHECK (recurrence IN ('RECURRENCE', 'NOT_RECURRENCE')),
  reason varchar(2000) NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recorded_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id, problem_id) REFERENCES customer_eight_d_reports(organization_id, problem_id) ON DELETE RESTRICT
);

CREATE TABLE customer_eight_d_receipts (
  organization_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  key varchar(128) NOT NULL,
  digest char(64) NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, actor_user_id, key)
);

CREATE FUNCTION customer_eight_d_immutable_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'customer_eight_d history is immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER customer_eight_d_revision_immutable BEFORE UPDATE OR DELETE ON customer_eight_d_revisions
  FOR EACH ROW EXECUTE FUNCTION customer_eight_d_immutable_history();
CREATE TRIGGER customer_eight_d_confirmation_immutable BEFORE UPDATE OR DELETE ON customer_eight_d_source_confirmations
  FOR EACH ROW EXECUTE FUNCTION customer_eight_d_immutable_history();
CREATE INDEX customer_eight_d_reports_work_idx ON customer_eight_d_reports(organization_id, responsible_section_department_id, updated_at);

ALTER TABLE customer_eight_d_receipts ADD CONSTRAINT customer_eight_d_receipts_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

CREATE TABLE customer_eight_d_reminder_slots (
  event_key varchar(256) PRIMARY KEY,
  organization_id uuid NOT NULL,
  problem_id uuid NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id, problem_id) REFERENCES problem_indexes(organization_id, id) ON DELETE RESTRICT
);

CREATE TABLE customer_eight_d_notifications (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  problem_id uuid NOT NULL,
  recipient_user_id uuid NOT NULL,
  event_key varchar(256) NOT NULL,
  kind varchar(32) NOT NULL CHECK (kind IN ('HANDLING_REMINDER', 'EXTENSION_PENDING', 'EXTENSION_CANCELLED', 'CLOSURE_REMINDER')),
  subject varchar(500) NOT NULL,
  body varchar(2000) NOT NULL,
  context jsonb NOT NULL CHECK (jsonb_typeof(context) = 'object' AND octet_length(context::text) <= 65536),
  delivered_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (event_key, recipient_user_id),
  FOREIGN KEY (organization_id, problem_id) REFERENCES problem_indexes(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, recipient_user_id) REFERENCES users(organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX customer_eight_d_notifications_inbox_idx ON customer_eight_d_notifications(organization_id, recipient_user_id, delivered_at DESC, id);

CREATE TABLE new_product_eight_d_bindings (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE RESTRICT,
  workflow_definition_id uuid NOT NULL REFERENCES workflow_definitions(id) ON DELETE RESTRICT,
  workflow_version_id uuid NOT NULL REFERENCES workflow_versions(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE new_product_eight_d_reports (
  problem_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  responsible_section_department_id uuid NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  professional_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  content_version integer NOT NULL DEFAULT 1 CHECK (content_version > 0),
  analysis_completed_at timestamptz(3),
  analysis_due_at timestamptz(3),
  submission_due_at timestamptz(3),
  closure_due_at timestamptz(3),
  submitted_at timestamptz(3),
  closed_revision_id uuid,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, problem_id),
  FOREIGN KEY (organization_id, problem_id) REFERENCES problem_indexes(organization_id, id) ON DELETE RESTRICT
);

CREATE TABLE new_product_eight_d_collaborators (
  organization_id uuid NOT NULL,
  problem_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  added_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  added_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, problem_id, user_id),
  FOREIGN KEY (organization_id, problem_id) REFERENCES new_product_eight_d_reports(organization_id, problem_id) ON DELETE RESTRICT
);

CREATE TABLE new_product_eight_d_revisions (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  problem_id uuid NOT NULL,
  content_version integer NOT NULL CHECK (content_version > 0),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  recorded_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, problem_id, id),
  FOREIGN KEY (organization_id, problem_id) REFERENCES new_product_eight_d_reports(organization_id, problem_id) ON DELETE RESTRICT
);
ALTER TABLE new_product_eight_d_reports ADD CONSTRAINT new_product_eight_d_closed_revision_fkey
  FOREIGN KEY (organization_id, problem_id, closed_revision_id)
  REFERENCES new_product_eight_d_revisions(organization_id, problem_id, id) ON DELETE RESTRICT;

CREATE TABLE new_product_eight_d_source_confirmations (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  problem_id uuid NOT NULL,
  source_id uuid NOT NULL REFERENCES new_product_defect_selections(id) ON DELETE RESTRICT,
  related_problem_ids jsonb NOT NULL CHECK (jsonb_typeof(related_problem_ids) = 'array'),
  recurrence varchar(32) NOT NULL CHECK (recurrence IN ('RECURRENCE', 'NOT_RECURRENCE')),
  reason varchar(2000) NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recorded_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id, problem_id) REFERENCES new_product_eight_d_reports(organization_id, problem_id) ON DELETE RESTRICT
);

CREATE TABLE new_product_eight_d_receipts (
  organization_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  key varchar(128) NOT NULL,
  digest char(64) NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, actor_user_id, key)
);

CREATE FUNCTION new_product_eight_d_immutable_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'new_product_eight_d history is immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER new_product_eight_d_revision_immutable BEFORE UPDATE OR DELETE ON new_product_eight_d_revisions
  FOR EACH ROW EXECUTE FUNCTION new_product_eight_d_immutable_history();
CREATE TRIGGER new_product_eight_d_confirmation_immutable BEFORE UPDATE OR DELETE ON new_product_eight_d_source_confirmations
  FOR EACH ROW EXECUTE FUNCTION new_product_eight_d_immutable_history();
CREATE INDEX new_product_eight_d_reports_work_idx ON new_product_eight_d_reports(organization_id, responsible_section_department_id, updated_at);

ALTER TABLE new_product_eight_d_receipts ADD CONSTRAINT new_product_eight_d_receipts_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

CREATE TABLE new_product_eight_d_reminder_slots (
  event_key varchar(256) PRIMARY KEY,
  organization_id uuid NOT NULL,
  problem_id uuid NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id, problem_id) REFERENCES problem_indexes(organization_id, id) ON DELETE RESTRICT
);

CREATE TABLE new_product_eight_d_notifications (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  problem_id uuid NOT NULL,
  recipient_user_id uuid NOT NULL,
  event_key varchar(256) NOT NULL,
  kind varchar(32) NOT NULL CHECK (kind IN ('HANDLING_REMINDER', 'EXTENSION_PENDING', 'EXTENSION_CANCELLED', 'CLOSURE_REMINDER')),
  subject varchar(500) NOT NULL,
  body varchar(2000) NOT NULL,
  context jsonb NOT NULL CHECK (jsonb_typeof(context) = 'object' AND octet_length(context::text) <= 65536),
  delivered_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (event_key, recipient_user_id),
  FOREIGN KEY (organization_id, problem_id) REFERENCES problem_indexes(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, recipient_user_id) REFERENCES users(organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX new_product_eight_d_notifications_inbox_idx ON new_product_eight_d_notifications(organization_id, recipient_user_id, delivered_at DESC, id);

INSERT INTO permissions (id, code, name) VALUES
  (gen_random_uuid(), 'customer-quality:issues:read', '客户查看8D及报告'),
  (gen_random_uuid(), 'customer-quality:issues:report', '客户导出有权读取的8D报告'),
  (gen_random_uuid(), 'customer-quality:issues:issue', '客户发起8D'),
  (gen_random_uuid(), 'customer-quality:issues:work', '客户办理本人负责或协作的8D'),
  (gen_random_uuid(), 'customer-quality:issues:sources', '客户调整8D来源范围'),
  (gen_random_uuid(), 'customer-quality:issues:risk', '客户调整8D风险'),
  (gen_random_uuid(), 'customer-quality:issues:reassign', '客户撤回重派8D责任范围'),
  (gen_random_uuid(), 'customer-quality:issues:deadlines', '客户设置8D质量侧期限'),
  (gen_random_uuid(), 'new-product-quality:issues:read', '新品查看8D及报告'),
  (gen_random_uuid(), 'new-product-quality:issues:report', '新品导出有权读取的8D报告'),
  (gen_random_uuid(), 'new-product-quality:issues:issue', '新品发起8D'),
  (gen_random_uuid(), 'new-product-quality:issues:work', '新品办理本人负责或协作的8D'),
  (gen_random_uuid(), 'new-product-quality:issues:sources', '新品调整8D来源范围'),
  (gen_random_uuid(), 'new-product-quality:issues:risk', '新品调整8D风险'),
  (gen_random_uuid(), 'new-product-quality:issues:reassign', '新品撤回重派8D责任范围'),
  (gen_random_uuid(), 'new-product-quality:issues:deadlines', '新品设置8D质量侧期限')
ON CONFLICT (code) DO NOTHING;
