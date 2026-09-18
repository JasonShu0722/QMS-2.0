-- PostgreSQL ordinary compound uniqueness permits duplicate NULL organizations.
-- Preserve global roles while guaranteeing a unique code within the global scope.
CREATE UNIQUE INDEX "roles_global_code_key" ON "roles" ("code")
WHERE "organization_id" IS NULL;
