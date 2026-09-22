CREATE TABLE "export_artifacts" (
  "id" UUID PRIMARY KEY,
  "organization_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT,
  "created_by_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "ciphertext" TEXT,
  "row_count" INTEGER NOT NULL CHECK ("row_count" >= 0 AND "row_count" <= 5000),
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("expires_at" > "created_at")
);
CREATE INDEX "export_artifacts_expires_at_idx" ON "export_artifacts"("expires_at");
CREATE INDEX "export_artifacts_organization_id_created_by_id_created_at_idx" ON "export_artifacts"("organization_id", "created_by_id", "created_at");
INSERT INTO "permissions" ("id", "code", "name") VALUES (gen_random_uuid(), 'audit:export', '导出管理审计') ON CONFLICT ("code") DO NOTHING;
