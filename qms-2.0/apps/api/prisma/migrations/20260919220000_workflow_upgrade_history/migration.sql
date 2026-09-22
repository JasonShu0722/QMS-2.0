ALTER TABLE workflow_instances ADD COLUMN problem_index_id UUID;
CREATE UNIQUE INDEX problem_indexes_organization_id_id_key ON problem_indexes(organization_id, id);
WITH ownership AS (
  SELECT workflow_instance_id, min(id::text)::uuid AS problem_id
  FROM problem_indexes WHERE workflow_instance_id IS NOT NULL
  GROUP BY workflow_instance_id HAVING count(*) = 1
)
UPDATE workflow_instances instance SET problem_index_id = ownership.problem_id
FROM ownership WHERE instance.id = ownership.workflow_instance_id;
DO $$
DECLARE unresolved BIGINT;
BEGIN
  SELECT count(*) INTO unresolved FROM workflow_instances WHERE problem_index_id IS NULL;
  IF unresolved > 0 THEN
    RAISE NOTICE 'WORKFLOW_HISTORY_UNRESOLVED: % legacy instances retain NULL problem ownership and are denied runtime, upgrade, and historical access', unresolved;
  END IF;
END $$;
ALTER TABLE workflow_instances ADD CONSTRAINT workflow_instances_problem_history_fkey
  FOREIGN KEY (organization_id, problem_index_id) REFERENCES problem_indexes(organization_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE UNIQUE INDEX workflow_instances_problem_identity_key ON workflow_instances(organization_id, problem_index_id, id);
CREATE INDEX workflow_instances_problem_history_idx ON workflow_instances(organization_id, problem_index_id, created_at);
ALTER TABLE problem_indexes ADD CONSTRAINT problem_indexes_current_instance_identity_fkey
  FOREIGN KEY (organization_id, id, workflow_instance_id) REFERENCES workflow_instances(organization_id, problem_index_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT NOT VALID;
CREATE FUNCTION prevent_workflow_history_reassignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.problem_index_id IS DISTINCT FROM NEW.problem_index_id OR OLD.organization_id IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'WORKFLOW_HISTORY_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workflow_instance_history_immutable BEFORE UPDATE ON workflow_instances
  FOR EACH ROW EXECUTE FUNCTION prevent_workflow_history_reassignment();

CREATE TABLE workflow_upgrades (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  problem_index_id UUID NOT NULL,
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  before_instance_id UUID NOT NULL,
  after_instance_id UUID NOT NULL,
  before_problem_version INTEGER NOT NULL CHECK (before_problem_version > 0),
  after_problem_version INTEGER NOT NULL CHECK (after_problem_version = before_problem_version + 1),
  before_domain_revision_id UUID NOT NULL,
  after_domain_revision_id UUID NOT NULL,
  mapping_version VARCHAR(100) NOT NULL CHECK (length(mapping_version) > 0),
  mapping_summary JSONB NOT NULL CHECK (jsonb_typeof(mapping_summary) = 'array'),
  reason VARCHAR(1000) NOT NULL CHECK (length(btrim(reason)) > 0),
  key VARCHAR(128) NOT NULL,
  request_digest CHAR(64) NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT workflow_upgrades_distinct_instances CHECK (before_instance_id <> after_instance_id),
  CONSTRAINT workflow_upgrades_before_identity_fkey FOREIGN KEY (organization_id, problem_index_id, before_instance_id)
    REFERENCES workflow_instances(organization_id, problem_index_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT workflow_upgrades_after_identity_fkey FOREIGN KEY (organization_id, problem_index_id, after_instance_id)
    REFERENCES workflow_instances(organization_id, problem_index_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX workflow_upgrades_before_instance_id_key ON workflow_upgrades(before_instance_id);
CREATE UNIQUE INDEX workflow_upgrades_after_instance_id_key ON workflow_upgrades(after_instance_id);
CREATE UNIQUE INDEX workflow_upgrades_organization_id_actor_user_id_key_key ON workflow_upgrades(organization_id, actor_user_id, key);
CREATE INDEX workflow_upgrades_problem_history_idx ON workflow_upgrades(organization_id, problem_index_id, created_at);
CREATE INDEX workflow_upgrades_actor_user_id_idx ON workflow_upgrades(actor_user_id);
CREATE FUNCTION prevent_workflow_upgrade_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'WORKFLOW_UPGRADE_IMMUTABLE' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER workflow_upgrade_immutable BEFORE UPDATE OR DELETE ON workflow_upgrades
  FOR EACH ROW EXECUTE FUNCTION prevent_workflow_upgrade_mutation();
