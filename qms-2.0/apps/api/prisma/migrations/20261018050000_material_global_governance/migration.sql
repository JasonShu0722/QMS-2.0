INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.organization_id IS NULL
  AND p.code IN ('material-master:read', 'material-master:write', 'material-master:import')
  AND EXISTS (SELECT 1 FROM role_permissions rp JOIN permissions current ON current.id = rp.permission_id WHERE rp.role_id = r.id AND current.code = 'organization:manage')
  AND EXISTS (SELECT 1 FROM role_permissions rp JOIN permissions current ON current.id = rp.permission_id WHERE rp.role_id = r.id AND current.code = 'account:roles:assign')
  AND EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN users u ON u.id = ur.user_id
    JOIN organizations home ON home.id = u.organization_id
    JOIN organizations scope ON scope.id = ur.organization_id
    WHERE ur.role_id = r.id AND u.account_type = 'INTERNAL'
      AND home.type = 'INTERNAL' AND scope.type = 'INTERNAL'
  )
  -- Global roles are shared: never expand grants when any assignment reaches a supplier.
  AND NOT EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN users u ON u.id = ur.user_id
    JOIN organizations home ON home.id = u.organization_id
    JOIN organizations scope ON scope.id = ur.organization_id
    WHERE ur.role_id = r.id
      AND (u.account_type = 'SUPPLIER' OR home.type = 'SUPPLIER' OR scope.type = 'SUPPLIER')
  )
ON CONFLICT DO NOTHING;
