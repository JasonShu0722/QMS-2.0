INSERT INTO permissions(id, code, name) VALUES
  (gen_random_uuid(), 'console:api:read', '查看 API 技术观测'),
  (gen_random_uuid(), 'console:exchanges:read', '查看数据交换观测'),
  (gen_random_uuid(), 'console:services:read', '查看运行服务事实')
ON CONFLICT (code) DO NOTHING;
