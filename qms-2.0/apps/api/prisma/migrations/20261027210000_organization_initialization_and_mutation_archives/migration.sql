-- Governance provenance and replay receipts survive independently of audit log availability.
CREATE TABLE organization_initializations (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  role_id uuid REFERENCES roles(id) ON DELETE SET NULL,
  creator_user_id uuid NOT NULL,
  permission_codes text[] NOT NULL,
  original_organization jsonb NOT NULL,
  grant_user_id uuid,
  grant_role_id uuid,
  grant_organization_id uuid,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (grant_user_id, grant_role_id, grant_organization_id)
    REFERENCES user_roles(user_id, role_id, organization_id) MATCH FULL ON DELETE SET NULL,
  CHECK (jsonb_typeof(original_organization) = 'object')
);
CREATE TABLE organization_mutation_archives (
  id uuid PRIMARY KEY,
  scope_organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  key varchar(128) NOT NULL,
  action varchar(100) NOT NULL,
  request_digest char(64) NOT NULL,
  response jsonb NOT NULL,
  original_organization jsonb NOT NULL,
  created_at timestamptz(3) NOT NULL,
  UNIQUE (actor_user_id, organization_id, key)
);
CREATE INDEX organization_mutation_archives_scope_idx ON organization_mutation_archives(scope_organization_id);
CREATE INDEX organization_mutation_archives_replay_idx ON organization_mutation_archives(actor_user_id, key, action);
