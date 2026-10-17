ALTER TABLE "users"
  ADD COLUMN "avatar_file_id" UUID,
  ADD COLUMN "avatar_version" INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT "users_avatar_version_check" CHECK ("avatar_version" > 0),
  ADD CONSTRAINT "users_avatar_file_id_fkey" FOREIGN KEY ("avatar_file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "account_avatar_receipts" (
  "actor_user_id" UUID NOT NULL,
  "key" VARCHAR(128) NOT NULL,
  "request_digest" CHAR(64) NOT NULL,
  "avatar_file_id" UUID,
  "avatar_version" INTEGER NOT NULL CHECK ("avatar_version" > 0),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "account_avatar_receipts_pkey" PRIMARY KEY ("actor_user_id", "key"),
  CONSTRAINT "account_avatar_receipts_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
