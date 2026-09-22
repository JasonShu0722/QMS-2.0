ALTER TABLE "workflow_transitions" ADD COLUMN "action" VARCHAR(20);
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transition_action_allowed"
  CHECK ("action" IS NULL OR "action" IN ('SUBMIT', 'APPROVE', 'VERIFY', 'REJECT', 'RETURN', 'REOPEN'));

CREATE TABLE "workflow_mutations" (
  "id" UUID NOT NULL PRIMARY KEY,
  "organization_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT,
  "actor_user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "key" VARCHAR(128) NOT NULL,
  "request_digest" CHAR(64) NOT NULL,
  "instance_id" UUID NOT NULL REFERENCES "workflow_instances"("id") ON DELETE RESTRICT,
  "instance_version" INTEGER NOT NULL CHECK ("instance_version" > 0),
  "node_id" UUID NOT NULL REFERENCES "workflow_nodes"("id") ON DELETE RESTRICT,
  "action" VARCHAR(20) NOT NULL,
  "response" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "workflow_mutations_organization_id_actor_user_id_key_key"
  ON "workflow_mutations"("organization_id", "actor_user_id", "key");
CREATE UNIQUE INDEX "workflow_mutations_instance_id_instance_version_key"
  ON "workflow_mutations"("instance_id", "instance_version");

INSERT INTO "permissions" ("id", "code", "name") VALUES
  (gen_random_uuid(), 'workflow:start', '启动流程'),
  (gen_random_uuid(), 'workflow:act', '执行被授权的流程节点')
ON CONFLICT ("code") DO NOTHING;
