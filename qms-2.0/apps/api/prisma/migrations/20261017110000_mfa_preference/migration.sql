CREATE TYPE "MfaPreference" AS ENUM ('DEFAULT', 'ENABLED', 'DISABLED');

ALTER TABLE "users" ADD COLUMN "mfa_preference" "MfaPreference" NOT NULL DEFAULT 'DEFAULT';
