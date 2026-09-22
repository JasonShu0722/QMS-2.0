CREATE TABLE platform_settings (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE RESTRICT,
  notification_locale varchar(10) NOT NULL DEFAULT 'zh-CN' CHECK (notification_locale IN ('zh-CN', 'en-US')),
  export_retention_minutes integer NOT NULL DEFAULT 1440 CHECK (export_retention_minutes BETWEEN 5 AND 10080),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE position_categories (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  code varchar(64) NOT NULL,
  name varchar(200) NOT NULL,
  status "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE',
  sort_order integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, code)
);
ALTER TABLE positions ADD COLUMN category_id uuid;
ALTER TABLE positions ADD CONSTRAINT positions_category_fkey FOREIGN KEY (organization_id, category_id) REFERENCES position_categories(organization_id, id) ON DELETE RESTRICT;
CREATE INDEX positions_category_idx ON positions(organization_id, category_id);
CREATE TABLE notification_rules (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  kind varchar(32) NOT NULL CHECK (kind IN ('TASK_ASSIGNED', 'TASK_REMINDER', 'TASK_ESCALATED')),
  enabled boolean NOT NULL DEFAULT true,
  subject_template varchar(255) NOT NULL,
  body_template varchar(2000) NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, kind)
);
ALTER TABLE notifications ADD COLUMN kind varchar(32) NOT NULL DEFAULT 'LEGACY', ADD COLUMN rule_version integer;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN ('LEGACY', 'TASK_ASSIGNED', 'TASK_REMINDER', 'TASK_ESCALATED'));
INSERT INTO permissions(id, code, name) VALUES
  (gen_random_uuid(), 'configuration:read', '查看平台配置'),
  (gen_random_uuid(), 'configuration:manage', '维护平台配置')
ON CONFLICT (code) DO NOTHING;
