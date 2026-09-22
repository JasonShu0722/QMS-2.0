INSERT INTO permissions (id, code, name) VALUES
  (gen_random_uuid(), 'outbox:read', '查看失败事件'),
  (gen_random_uuid(), 'outbox:retry', '重试失败事件')
ON CONFLICT (code) DO NOTHING;
