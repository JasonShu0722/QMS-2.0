ALTER TABLE "positions" ADD COLUMN "role_version" INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX "roles_organization_id_id_key" ON "roles"("organization_id", "id");

CREATE TABLE "position_roles" (
    "organization_id" UUID NOT NULL,
    "position_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    CONSTRAINT "position_roles_pkey" PRIMARY KEY ("organization_id", "position_id", "role_id")
);

CREATE INDEX "position_roles_organization_id_role_id_idx" ON "position_roles"("organization_id", "role_id");

ALTER TABLE "position_roles" ADD CONSTRAINT "position_roles_organization_id_position_id_fkey"
    FOREIGN KEY ("organization_id", "position_id") REFERENCES "positions"("organization_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE "position_roles" ADD CONSTRAINT "position_roles_organization_id_role_id_fkey"
    FOREIGN KEY ("organization_id", "role_id") REFERENCES "roles"("organization_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
