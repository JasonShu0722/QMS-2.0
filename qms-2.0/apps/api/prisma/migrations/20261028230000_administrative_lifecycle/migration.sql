ALTER TABLE organizations
  ADD COLUMN deleted_at timestamptz(3),
  ADD COLUMN configuration_required boolean NOT NULL DEFAULT false;
ALTER TABLE departments
  ADD COLUMN deleted_at timestamptz(3),
  ADD COLUMN configuration_required boolean NOT NULL DEFAULT false;
ALTER TABLE positions
  ADD COLUMN deleted_at timestamptz(3),
  ADD COLUMN configuration_required boolean NOT NULL DEFAULT false;
ALTER TABLE users
  ADD COLUMN deleted_at timestamptz(3),
  ADD COLUMN configuration_required boolean NOT NULL DEFAULT false;

CREATE TABLE administrative_deletions (
  id uuid PRIMARY KEY,
  scope_organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  entity_kind varchar(16) NOT NULL CHECK (entity_kind IN ('ORGANIZATION','DEPARTMENT','USER')),
  entity_id uuid NOT NULL,
  original_organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  original_identity jsonb NOT NULL CHECK (jsonb_typeof(original_identity) = 'object'),
  impact jsonb NOT NULL CHECK (jsonb_typeof(impact) = 'object'),
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(entity_kind, entity_id)
);
CREATE INDEX administrative_deletions_scope_created_idx ON administrative_deletions(scope_organization_id, created_at, id);

-- Deleted identities remain only to preserve historical UUIDs and immutable signatures.
CREATE FUNCTION prevent_administrative_identity_revival() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'ADMIN_DELETED_IDENTITY_IMMUTABLE' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    RAISE EXCEPTION 'ADMIN_DELETED_IDENTITY_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF (NEW.deleted_at IS NOT NULL OR NEW.configuration_required) AND NEW.status::text <> 'DISABLED' THEN
    RAISE EXCEPTION 'ADMIN_IDENTITY_NOT_CONFIGURED' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER organizations_deleted_identity_guard BEFORE INSERT OR UPDATE OR DELETE ON organizations
  FOR EACH ROW EXECUTE FUNCTION prevent_administrative_identity_revival();
CREATE TRIGGER departments_deleted_identity_guard BEFORE INSERT OR UPDATE OR DELETE ON departments
  FOR EACH ROW EXECUTE FUNCTION prevent_administrative_identity_revival();
CREATE TRIGGER positions_deleted_identity_guard BEFORE INSERT OR UPDATE OR DELETE ON positions
  FOR EACH ROW EXECUTE FUNCTION prevent_administrative_identity_revival();
CREATE TRIGGER users_deleted_identity_guard BEFORE INSERT OR UPDATE OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION prevent_administrative_identity_revival();

CREATE FUNCTION preserve_administrative_deletion_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ADMIN_DELETION_HISTORY_IMMUTABLE' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER administrative_deletions_immutable BEFORE UPDATE OR DELETE ON administrative_deletions
  FOR EACH ROW EXECUTE FUNCTION preserve_administrative_deletion_history();

INSERT INTO permissions(id, code, name) VALUES
  (gen_random_uuid(), 'organization:force-delete', '强制删除组织'),
  (gen_random_uuid(), 'organization:departments:force-delete', '强制删除部门或科室'),
  (gen_random_uuid(), 'account:users:delete', '永久删除用户账号'),
  (gen_random_uuid(), 'organization:reconfigure', '补配组织部门和用户失效关联')
ON CONFLICT (code) DO NOTHING;
