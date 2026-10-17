ALTER TABLE "users" ADD COLUMN "mfa_requirement_override" BOOLEAN;

-- Preserve legacy binding-based requirements without letting future personal enrollment change policy.
UPDATE "users" AS u
SET "mfa_requirement_override" = TRUE
WHERE u."mfa_enabled" = TRUE
  AND NOT EXISTS (
    SELECT 1
    FROM "user_roles" AS ur
    JOIN "role_permissions" AS rp ON rp."role_id" = ur."role_id"
    JOIN "permissions" AS p ON p."id" = rp."permission_id"
    WHERE ur."user_id" = u."id"
      AND p."code" IN (
        'account:users:create', 'account:users:update', 'account:users:status',
        'account:users:transfer', 'account:users:reset', 'account:roles:create',
        'account:roles:update', 'account:roles:delete', 'account:roles:assign',
        'organization:manage', 'organization:structure:manage',
        'organization:positions:assign', 'configuration:manage', 'outbox:retry'
      )
  );
