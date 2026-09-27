CREATE TABLE announcements (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  title varchar(200) NOT NULL CHECK (length(trim(title)) > 0),
  content text NOT NULL CHECK (length(trim(content)) > 0 AND length(content) <= 20000),
  importance varchar(16) NOT NULL CHECK (importance IN ('NORMAL', 'IMPORTANT')),
  must_read boolean NOT NULL DEFAULT false,
  audience varchar(16) NOT NULL CHECK (audience IN ('ALL', 'SELECTED')),
  status varchar(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  recipient_count integer NOT NULL DEFAULT 0 CHECK (recipient_count >= 0),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  published_by_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  published_at timestamptz(3),
  archived_by_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  archived_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, id),
  CHECK ((status = 'DRAFT' AND published_at IS NULL AND published_by_id IS NULL) OR (status <> 'DRAFT' AND published_at IS NOT NULL AND published_by_id IS NOT NULL)),
  CHECK ((status = 'ARCHIVED' AND archived_at IS NOT NULL AND archived_by_id IS NOT NULL) OR (status <> 'ARCHIVED' AND archived_at IS NULL AND archived_by_id IS NULL))
);
CREATE INDEX announcements_scope_idx ON announcements (organization_id, status, created_at DESC, id DESC);

CREATE TABLE announcement_recipients (
  organization_id uuid NOT NULL,
  announcement_id uuid NOT NULL,
  user_id uuid NOT NULL,
  read_at timestamptz(3),
  read_session_id uuid,
  read_trace_id varchar(160),
  PRIMARY KEY (announcement_id, user_id),
  FOREIGN KEY (organization_id, announcement_id) REFERENCES announcements(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, user_id) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  CHECK ((read_at IS NULL AND read_session_id IS NULL AND read_trace_id IS NULL) OR (read_at IS NOT NULL AND read_session_id IS NOT NULL AND read_trace_id IS NOT NULL))
);
CREATE INDEX announcement_recipient_unread_idx ON announcement_recipients (organization_id, user_id, read_at, announcement_id);

CREATE FUNCTION guard_announcement_recipient_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE announcement_status varchar(16);
DECLARE target_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN target_id := OLD.announcement_id;
  ELSE target_id := NEW.announcement_id;
  END IF;
  SELECT status INTO announcement_status FROM announcements WHERE id = target_id;
  IF TG_OP = 'INSERT' THEN
    IF announcement_status <> 'DRAFT' OR NEW.read_at IS NOT NULL THEN
      RAISE EXCEPTION 'Published announcement audience is immutable' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF announcement_status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Published announcement audience is immutable' USING ERRCODE = '23514';
    END IF;
  ELSIF announcement_status <> 'PUBLISHED'
      OR OLD.read_at IS NOT NULL
      OR NEW.read_at IS NULL
      OR NEW.organization_id <> OLD.organization_id
      OR NEW.announcement_id <> OLD.announcement_id
      OR NEW.user_id <> OLD.user_id THEN
    RAISE EXCEPTION 'Announcement read receipt is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER announcement_recipient_guard BEFORE INSERT OR UPDATE OR DELETE ON announcement_recipients
  FOR EACH ROW EXECUTE FUNCTION guard_announcement_recipient_mutation();

INSERT INTO permissions(id, code, name) VALUES
  (gen_random_uuid(), 'announcement:read', '查看公告'),
  (gen_random_uuid(), 'announcement:manage', '管理公告'),
  (gen_random_uuid(), 'announcement:audit:read', '查看公告阅读审计')
ON CONFLICT (code) DO NOTHING;
