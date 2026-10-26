INSERT INTO permissions (id, code, name)
VALUES (gen_random_uuid(), 'platform:admin', '平台管理员（全部活跃内部组织的适用权限，须显式授予）')
ON CONFLICT (code) DO NOTHING;
