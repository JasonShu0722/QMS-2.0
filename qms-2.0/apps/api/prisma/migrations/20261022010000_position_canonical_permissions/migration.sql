ALTER TABLE "position_roles" ADD COLUMN "is_canonical" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "position_roles_canonical_position_key"
  ON "position_roles" ("organization_id", "position_id") WHERE "is_canonical";
CREATE UNIQUE INDEX "position_roles_canonical_role_key"
  ON "position_roles" ("organization_id", "role_id") WHERE "is_canonical";
