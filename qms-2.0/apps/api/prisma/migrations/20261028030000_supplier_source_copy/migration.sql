ALTER TABLE supplier_quality_problems
  ADD CONSTRAINT supplier_copy_problem_owner_identity UNIQUE (id, owner_organization_id);

CREATE TABLE supplier_copy_previews (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL,
  actor_session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
  supplier_profile_id uuid NOT NULL,
  sources jsonb NOT NULL CHECK (jsonb_typeof(sources) = 'array' AND jsonb_array_length(sources) BETWEEN 1 AND 100 AND octet_length(sources::text) <= 262144),
  projection_digest varchar(64) NOT NULL CHECK (projection_digest ~ '^[0-9a-f]{64}$'),
  profile_digest varchar(64) NOT NULL CHECK (profile_digest ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, id, actor_user_id),
  FOREIGN KEY (organization_id, actor_user_id) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (supplier_profile_id, organization_id) REFERENCES supplier_business_profiles(id, owner_organization_id) ON DELETE RESTRICT,
  CHECK (expires_at > created_at)
);
CREATE TABLE supplier_copy_provenance (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  preview_id uuid NOT NULL UNIQUE,
  supplier_problem_id uuid NOT NULL UNIQUE,
  actor_user_id uuid NOT NULL,
  sources jsonb NOT NULL CHECK (jsonb_typeof(sources) = 'array' AND jsonb_array_length(sources) BETWEEN 1 AND 100 AND octet_length(sources::text) <= 262144),
  projection_digest varchar(64) NOT NULL CHECK (projection_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id, preview_id, actor_user_id) REFERENCES supplier_copy_previews(organization_id, id, actor_user_id) ON DELETE RESTRICT,
  FOREIGN KEY (supplier_problem_id, organization_id) REFERENCES supplier_quality_problems(id, owner_organization_id) ON DELETE RESTRICT
);
CREATE TRIGGER supplier_copy_preview_immutable BEFORE UPDATE OR DELETE ON supplier_copy_previews
  FOR EACH ROW EXECUTE FUNCTION supplier_eight_d_reject_history_mutation();
CREATE TRIGGER supplier_copy_provenance_immutable BEFORE UPDATE OR DELETE ON supplier_copy_provenance
  FOR EACH ROW EXECUTE FUNCTION supplier_eight_d_reject_history_mutation();
