ALTER TABLE "roles" ADD COLUMN "archived_at" TIMESTAMPTZ(3);

CREATE TABLE "legacy_authorization_archives" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "operation" VARCHAR(32) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legacy_authorization_archives_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "legacy_authorization_archive_scope_time_idx"
ON "legacy_authorization_archives"("organization_id", "role_id", "created_at");
