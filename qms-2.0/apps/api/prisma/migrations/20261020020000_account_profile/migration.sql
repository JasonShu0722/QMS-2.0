ALTER TABLE "users"
  ADD COLUMN "full_name" VARCHAR(100),
  ADD COLUMN "phone" VARCHAR(40),
  ADD COLUMN "profile_version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "users" ADD CONSTRAINT "users_profile_version_positive" CHECK ("profile_version" >= 1);
