CREATE TYPE "SessionLifetimeType" AS ENUM ('STANDARD', 'REMEMBERED_ADMIN', 'REMEMBERED_USER');

ALTER TABLE "sessions" ADD COLUMN "lifetime_type" "SessionLifetimeType" NOT NULL DEFAULT 'STANDARD';
ALTER TABLE "mfa_challenges" ADD COLUMN "remember_me" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "password_change_challenges" ADD COLUMN "remember_me" BOOLEAN NOT NULL DEFAULT false;
