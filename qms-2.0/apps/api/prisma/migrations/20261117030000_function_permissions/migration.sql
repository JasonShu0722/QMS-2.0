INSERT INTO permissions (id, code, name)
VALUES (gen_random_uuid(), 'ai:connections:read', '查看模型渠道'),
       (gen_random_uuid(), 'ai:connections:manage', '维护模型渠道'),
       (gen_random_uuid(), 'ai:connections:test', '测试模型渠道'),
       (gen_random_uuid(), 'ai:credentials:manage', '维护AI渠道密钥'),
       (gen_random_uuid(), 'ai:applications:read', '查看和引用提示词应用'),
       (gen_random_uuid(), 'ai:applications:manage', '维护提示词应用草稿'),
       (gen_random_uuid(), 'ai:applications:publish', '发布提示词应用'),
       (gen_random_uuid(), 'ai:applications:test', '试运行提示词应用'),
       (gen_random_uuid(), 'process-quality:configuration:read', '查看工序板块映射'),
       (gen_random_uuid(), 'process-quality:configuration:manage', '维护工序板块映射'),
       (gen_random_uuid(), 'process-quality:defects:delete', '删除制程不良品台账')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT original.role_id, target.id
FROM role_permissions original
JOIN permissions source ON source.id = original.permission_id
JOIN (VALUES
  ('configuration:read', 'ai:connections:read'),
  ('configuration:read', 'ai:applications:read'),
  ('configuration:read', 'process-quality:configuration:read'),
  ('configuration:manage', 'ai:connections:manage'),
  ('configuration:manage', 'ai:connections:test'),
  ('configuration:manage', 'ai:credentials:manage'),
  ('configuration:manage', 'ai:applications:manage'),
  ('configuration:manage', 'ai:applications:publish'),
  ('configuration:manage', 'ai:applications:test'),
  ('configuration:manage', 'process-quality:configuration:manage')
) mapping(source_code, target_code) ON mapping.source_code = source.code
JOIN permissions target ON target.code = mapping.target_code
ON CONFLICT (role_id, permission_id) DO NOTHING;
