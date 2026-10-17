-- AlterTable
ALTER TABLE "users" ADD COLUMN     "credential_version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "must_change_password" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "user_temporary_passwords" (
    "user_id" UUID NOT NULL,
    "credential_version" INTEGER NOT NULL,
    "encrypted_value" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_temporary_passwords_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "password_change_challenges" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "credential_version" INTEGER NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),

    CONSTRAINT "password_change_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_batches" (
    "id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "request_digest" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_batch_rows" (
    "batch_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "result" JSONB NOT NULL,

    CONSTRAINT "account_batch_rows_pkey" PRIMARY KEY ("batch_id","row_number")
);

-- CreateIndex
CREATE INDEX "user_temporary_passwords_expires_at_idx" ON "user_temporary_passwords"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "password_change_challenges_token_hash_key" ON "password_change_challenges"("token_hash");

-- CreateIndex
CREATE INDEX "password_change_challenges_user_id_expires_at_idx" ON "password_change_challenges"("user_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "account_batches_actor_id_organization_id_key_key" ON "account_batches"("actor_id", "organization_id", "key");

-- AddForeignKey
ALTER TABLE "user_temporary_passwords" ADD CONSTRAINT "user_temporary_passwords_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_change_challenges" ADD CONSTRAINT "password_change_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_batches" ADD CONSTRAINT "account_batches_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_batches" ADD CONSTRAINT "account_batches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_batch_rows" ADD CONSTRAINT "account_batch_rows_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "account_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
