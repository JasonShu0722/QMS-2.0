INSERT INTO permissions (id, code, name)
VALUES (gen_random_uuid(), 'audit:read', '查询管理审计')
ON CONFLICT (code) DO NOTHING;
