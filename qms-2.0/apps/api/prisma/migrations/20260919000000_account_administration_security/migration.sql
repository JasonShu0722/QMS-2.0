ALTER TABLE "users" ADD CONSTRAINT "users_username_format" CHECK (btrim(username) ~ '^[a-zA-Z0-9._-]+$');
ALTER TABLE "users" ADD CONSTRAINT "users_email_identifier" CHECK (email IS NULL OR position('@' in email) > 1);
CREATE UNIQUE INDEX "users_username_normalized_key" ON "users" (lower(btrim(username)));
CREATE UNIQUE INDEX "users_email_normalized_key" ON "users" (lower(btrim(email))) WHERE email IS NOT NULL;
UPDATE "users" SET username = btrim(username), email = lower(btrim(email));

CREATE TABLE "admin_mutations" (
  "id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "organization_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "key" VARCHAR(128) NOT NULL,
  "action" VARCHAR(100) NOT NULL,
  "request_digest" CHAR(64) NOT NULL,
  "response" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_mutations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "admin_mutations_actor_user_id_organization_id_key_key" ON "admin_mutations" ("actor_user_id", "organization_id", "key");

CREATE TABLE "password_resets" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "code_hash" CHAR(64) NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "consumed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "password_resets_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "password_resets_user_id_consumed_at_idx" ON "password_resets" ("user_id", "consumed_at");
