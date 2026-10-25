CREATE TABLE closure_notifications (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  round_id uuid NOT NULL,
  round_version integer NOT NULL CHECK (round_version > 0),
  recipient_user_id uuid NOT NULL,
  kind varchar(32) NOT NULL CHECK (kind = 'CLOSURE_PENDING'),
  subject varchar(500) NOT NULL CHECK (btrim(subject) <> ''),
  body varchar(2000) NOT NULL CHECK (btrim(body) <> ''),
  delivered_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (round_id, round_version, recipient_user_id, kind),
  FOREIGN KEY (organization_id, round_id) REFERENCES workflow_closure_rounds(organization_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY (organization_id, recipient_user_id) REFERENCES users(organization_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX closure_notifications_inbox_idx ON closure_notifications(organization_id, recipient_user_id, delivered_at DESC, id DESC);
