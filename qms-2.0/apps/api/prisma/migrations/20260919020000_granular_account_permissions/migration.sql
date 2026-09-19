BEGIN;

LOCK TABLE permissions, role_permissions IN SHARE ROW EXCLUSIVE MODE;

INSERT INTO permissions (id, code, name) VALUES
  (gen_random_uuid(), 'account:users:create', '创建用户账号'),
  (gen_random_uuid(), 'account:users:update', '编辑用户邮箱'),
  (gen_random_uuid(), 'account:users:status', '启用或停用用户'),
  (gen_random_uuid(), 'account:users:transfer', '变更用户组织或账号类型'),
  (gen_random_uuid(), 'account:users:reset', '签发密码重置凭证'),
  (gen_random_uuid(), 'account:roles:create', '创建或复制角色'),
  (gen_random_uuid(), 'account:roles:update', '编辑角色与权限'),
  (gen_random_uuid(), 'account:roles:delete', '删除角色'),
  (gen_random_uuid(), 'account:roles:assign', '分配用户角色')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT existing.role_id, replacement.id
FROM role_permissions AS existing
JOIN permissions AS retired ON retired.id = existing.permission_id
JOIN permissions AS replacement ON
  (retired.code = 'account:users:manage' AND replacement.code IN (
    'account:users:create', 'account:users:update', 'account:users:status', 'account:users:transfer', 'account:users:reset'
  )) OR
  (retired.code = 'account:roles:manage' AND replacement.code IN (
    'account:roles:create', 'account:roles:update', 'account:roles:delete', 'account:roles:assign'
  ))
ON CONFLICT (role_id, permission_id) DO NOTHING;

DELETE FROM role_permissions
WHERE permission_id IN (SELECT id FROM permissions WHERE code IN ('account:users:manage', 'account:roles:manage'));

DELETE FROM permissions WHERE code IN ('account:users:manage', 'account:roles:manage');

COMMIT;
