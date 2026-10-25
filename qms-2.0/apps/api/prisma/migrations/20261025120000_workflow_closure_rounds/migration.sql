CREATE TABLE workflow_closure_rounds (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  problem_id uuid NOT NULL,
  instance_id uuid NOT NULL,
  workflow_version_id uuid NOT NULL,
  node_id uuid NOT NULL,
  content_version integer NOT NULL CHECK (content_version > 0),
  content_snapshot jsonb NOT NULL CHECK (octet_length(content_snapshot::text) <= 1048576),
  context jsonb NOT NULL CHECK (jsonb_typeof(context) = 'object' AND octet_length(context::text) <= 2097152),
  round_number integer NOT NULL CHECK (round_number > 0),
  status varchar(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'RETURNED', 'CANCELLED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, problem_id, round_number),
  FOREIGN KEY (organization_id, problem_id) REFERENCES problem_indexes(organization_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY (organization_id, problem_id, instance_id) REFERENCES workflow_instances(organization_id, problem_index_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY (organization_id, workflow_version_id, instance_id) REFERENCES workflow_instances(organization_id, workflow_version_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY (organization_id, workflow_version_id, node_id) REFERENCES workflow_nodes(organization_id, workflow_version_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY (organization_id, created_by) REFERENCES users(organization_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE UNIQUE INDEX workflow_closure_rounds_one_pending_key ON workflow_closure_rounds(organization_id, problem_id) WHERE status = 'PENDING';
CREATE INDEX workflow_closure_rounds_history_idx ON workflow_closure_rounds(organization_id, problem_id, round_number DESC);

CREATE TABLE workflow_closure_duties (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  round_id uuid NOT NULL,
  duty varchar(32) NOT NULL CHECK (duty IN ('PROFESSIONAL', 'SECTION_MANAGER', 'MINISTER')),
  status varchar(32) NOT NULL CHECK (status IN ('PENDING', 'WAITING', 'APPROVED', 'SKIPPED_SAME_PERSON', 'CANCELLED')),
  user_id uuid NOT NULL,
  participant jsonb NOT NULL CHECK (jsonb_typeof(participant) = 'object' AND participant->>'userId' = user_id::text AND octet_length(participant::text) <= 8192),
  decided_by uuid,
  comment varchar(2000),
  decided_at timestamptz(3),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, round_id, duty),
  CHECK (status <> 'APPROVED' OR (decided_by = user_id AND decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CHECK (status <> 'SKIPPED_SAME_PERSON' OR duty = 'SECTION_MANAGER'),
  FOREIGN KEY (organization_id, round_id) REFERENCES workflow_closure_rounds(organization_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY (organization_id, user_id) REFERENCES users(organization_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY (organization_id, decided_by) REFERENCES users(organization_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX workflow_closure_duties_inbox_idx ON workflow_closure_duties(organization_id, user_id, status, round_id);

CREATE TABLE workflow_closure_receipts (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  actor_user_id uuid NOT NULL,
  key varchar(128) NOT NULL CHECK (key ~ '^[a-zA-Z0-9._:-]{8,128}$'),
  digest varchar(64) NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
  response jsonb NOT NULL CHECK (jsonb_typeof(response) = 'object' AND octet_length(response::text) <= 4194304),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, actor_user_id, key),
  FOREIGN KEY (organization_id, actor_user_id) REFERENCES users(organization_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
