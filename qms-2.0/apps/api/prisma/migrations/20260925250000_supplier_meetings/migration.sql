CREATE TABLE supplier_meetings (
  id uuid PRIMARY KEY,
  owner_organization_id uuid NOT NULL REFERENCES organizations(id),
  supplier_organization_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  title varchar(300) NOT NULL CHECK (length(trim(title)) > 0),
  scheduled_start timestamptz(3) NOT NULL,
  scheduled_end timestamptz(3) NOT NULL,
  location varchar(300),
  status varchar(16) NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_id uuid NOT NULL REFERENCES users(id),
  started_by_id uuid REFERENCES users(id),
  completed_by_id uuid REFERENCES users(id),
  started_at timestamptz(3),
  completed_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (owner_organization_id, id),
  FOREIGN KEY (profile_id, owner_organization_id, supplier_organization_id)
    REFERENCES supplier_business_profiles(id, owner_organization_id, supplier_organization_id),
  CHECK (scheduled_end >= scheduled_start),
  CHECK ((status IN ('IN_PROGRESS', 'COMPLETED') AND started_by_id IS NOT NULL AND started_at IS NOT NULL) OR status = 'PLANNED' OR status = 'CANCELLED'),
  CHECK ((status = 'COMPLETED' AND completed_by_id IS NOT NULL AND completed_at IS NOT NULL) OR status <> 'COMPLETED')
);
CREATE INDEX supplier_meetings_scope_idx ON supplier_meetings(owner_organization_id, scheduled_start DESC, id DESC);

CREATE TABLE supplier_meeting_topics (
  id uuid PRIMARY KEY,
  owner_organization_id uuid NOT NULL,
  meeting_id uuid NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  title varchar(300) NOT NULL CHECK (length(trim(title)) > 0),
  conclusion text,
  status varchar(16) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CONCLUDED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_id uuid NOT NULL REFERENCES users(id),
  concluded_by_id uuid REFERENCES users(id),
  concluded_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (owner_organization_id, id),
  FOREIGN KEY (owner_organization_id, meeting_id) REFERENCES supplier_meetings(owner_organization_id, id) ON DELETE CASCADE,
  UNIQUE (meeting_id, sequence),
  CHECK ((status = 'CONCLUDED' AND conclusion IS NOT NULL AND concluded_by_id IS NOT NULL AND concluded_at IS NOT NULL) OR status = 'OPEN')
);
CREATE INDEX supplier_meeting_topics_scope_idx ON supplier_meeting_topics(owner_organization_id, meeting_id, sequence);

CREATE TABLE supplier_meeting_actions (
  id uuid PRIMARY KEY,
  owner_organization_id uuid NOT NULL,
  meeting_id uuid NOT NULL,
  title varchar(500) NOT NULL CHECK (length(trim(title)) > 0),
  assignee_user_id uuid NOT NULL,
  due_date date NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_id uuid NOT NULL REFERENCES users(id),
  completed_by_id uuid REFERENCES users(id),
  completed_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (owner_organization_id, id),
  FOREIGN KEY (owner_organization_id, meeting_id) REFERENCES supplier_meetings(owner_organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (assignee_user_id) REFERENCES users(id),
  CHECK ((status = 'COMPLETED' AND completed_by_id IS NOT NULL AND completed_at IS NOT NULL) OR status <> 'COMPLETED')
);
CREATE INDEX supplier_meeting_actions_scope_idx ON supplier_meeting_actions(owner_organization_id, meeting_id, status, due_date);

CREATE TABLE supplier_meeting_events (
  id uuid PRIMARY KEY,
  owner_organization_id uuid NOT NULL,
  meeting_id uuid NOT NULL,
  entity_type varchar(16) NOT NULL CHECK (entity_type IN ('MEETING', 'TOPIC', 'ACTION')),
  entity_id uuid NOT NULL,
  event_type varchar(32) NOT NULL,
  entity_version integer NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  note text,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_organization_id, meeting_id) REFERENCES supplier_meetings(owner_organization_id, id) ON DELETE CASCADE
);
CREATE INDEX supplier_meeting_events_scope_idx ON supplier_meeting_events(owner_organization_id, meeting_id, created_at);

INSERT INTO permissions(id, code, name) VALUES
  (gen_random_uuid(), 'supplier-meetings:read', '查看供应商会议'),
  (gen_random_uuid(), 'supplier-meetings:write', '维护供应商会议'),
  (gen_random_uuid(), 'supplier-meetings:conclude', '完成供应商会议议题'),
  (gen_random_uuid(), 'supplier-meetings:actions', '维护供应商会议行动项')
ON CONFLICT (code) DO NOTHING;
