CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'DISABLED');
ALTER TABLE "organizations" ADD COLUMN "parent_id" UUID, ADD COLUMN "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE', ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_not_own_parent" CHECK ("parent_id" IS DISTINCT FROM "id");
CREATE INDEX "organizations_parent_id_idx" ON "organizations"("parent_id");
CREATE UNIQUE INDEX IF NOT EXISTS "users_organization_id_id_key" ON "users"("organization_id", "id");

CREATE TABLE "departments" (
  "id" UUID NOT NULL, "organization_id" UUID NOT NULL, "parent_id" UUID,
  "code" VARCHAR(64) NOT NULL, "name" VARCHAR(200) NOT NULL,
  "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE', "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "departments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "departments_not_own_parent" CHECK ("parent_id" IS DISTINCT FROM "id"),
  CONSTRAINT "departments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "departments_organization_id_id_key" ON "departments"("organization_id", "id");
CREATE UNIQUE INDEX "departments_organization_id_code_key" ON "departments"("organization_id", "code");
CREATE INDEX "departments_organization_id_parent_id_idx" ON "departments"("organization_id", "parent_id");
ALTER TABLE "departments" ADD CONSTRAINT "departments_organization_id_parent_id_fkey" FOREIGN KEY ("organization_id", "parent_id") REFERENCES "departments"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "positions" (
  "id" UUID NOT NULL, "organization_id" UUID NOT NULL, "department_id" UUID NOT NULL,
  "code" VARCHAR(64) NOT NULL, "name" VARCHAR(200) NOT NULL,
  "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE', "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "positions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "positions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "positions_organization_id_department_id_fkey" FOREIGN KEY ("organization_id", "department_id") REFERENCES "departments"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "positions_organization_id_id_key" ON "positions"("organization_id", "id");
CREATE UNIQUE INDEX "positions_organization_id_code_key" ON "positions"("organization_id", "code");
CREATE INDEX "positions_organization_id_department_id_idx" ON "positions"("organization_id", "department_id");

CREATE TABLE "user_positions" (
  "id" UUID NOT NULL, "organization_id" UUID NOT NULL, "user_id" UUID NOT NULL, "position_id" UUID NOT NULL,
  "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "ended_at" TIMESTAMPTZ(3),
  CONSTRAINT "user_positions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_positions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "user_positions_organization_id_user_id_fkey" FOREIGN KEY ("organization_id", "user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "user_positions_organization_id_position_id_fkey" FOREIGN KEY ("organization_id", "position_id") REFERENCES "positions"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "user_positions_organization_id_user_id_ended_at_idx" ON "user_positions"("organization_id", "user_id", "ended_at");
CREATE UNIQUE INDEX "user_positions_active_key" ON "user_positions"("organization_id", "user_id", "position_id") WHERE "ended_at" IS NULL;

INSERT INTO permissions (id, code, name) VALUES
  (gen_random_uuid(), 'organization:manage', '管理组织'),
  (gen_random_uuid(), 'organization:structure:read', '查看部门与岗位'),
  (gen_random_uuid(), 'organization:structure:manage', '管理部门与岗位'),
  (gen_random_uuid(), 'organization:positions:assign', '分配用户任职')
ON CONFLICT (code) DO NOTHING;
