CREATE TABLE workflow_deadline_extensions (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  problem_id uuid NOT NULL,
  workflow_version_id uuid NOT NULL,
  stage varchar(16) NOT NULL CHECK (stage IN ('ANALYSIS', 'SUBMISSION', 'CLOSURE')),
  original_due_at timestamptz(3) NOT NULL,
  requested_due_at timestamptz(3) NOT NULL CHECK (requested_due_at > original_due_at),
  originally_overdue boolean NOT NULL,
  reason varchar(2000) NOT NULL CHECK (btrim(reason) <> ''),
  applicant_user_id uuid NOT NULL,
  context jsonb NOT NULL CHECK (jsonb_typeof(context) = 'object' AND octet_length(context::text) <= 65536),
  participants jsonb NOT NULL CHECK (jsonb_typeof(participants) = 'object' AND octet_length(participants::text) <= 32768),
  status varchar(24) NOT NULL CHECK (status IN ('LEADER_PENDING', 'QUALITY_PENDING', 'APPROVED', 'RETURNED', 'CANCELLED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  history jsonb NOT NULL CHECK (jsonb_typeof(history) = 'array' AND octet_length(history::text) <= 65536),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, problem_id) REFERENCES problem_indexes(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, workflow_version_id) REFERENCES workflow_versions(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, applicant_user_id) REFERENCES users(organization_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX workflow_deadline_extensions_pending_key ON workflow_deadline_extensions(organization_id, problem_id, stage)
  WHERE status IN ('LEADER_PENDING', 'QUALITY_PENDING');
CREATE INDEX workflow_deadline_extensions_history_idx ON workflow_deadline_extensions(organization_id, problem_id, created_at DESC, id);

CREATE TABLE workflow_deadline_extension_receipts (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL,
  key varchar(128) NOT NULL CHECK (key ~ '^[a-zA-Z0-9._:-]{8,128}$'),
  digest varchar(64) NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
  response jsonb NOT NULL CHECK (jsonb_typeof(response) = 'object' AND octet_length(response::text) <= 262144),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, actor_user_id, key),
  FOREIGN KEY (organization_id, actor_user_id) REFERENCES users(organization_id, id) ON DELETE RESTRICT
);

CREATE TABLE process_eight_d_reminder_slots (
  event_key varchar(256) PRIMARY KEY,
  organization_id uuid NOT NULL,
  problem_id uuid NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id, problem_id) REFERENCES problem_indexes(organization_id, id) ON DELETE RESTRICT
);

CREATE TABLE process_eight_d_notifications (
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
CREATE INDEX process_eight_d_notifications_inbox_idx ON process_eight_d_notifications(organization_id, recipient_user_id, delivered_at DESC, id);
