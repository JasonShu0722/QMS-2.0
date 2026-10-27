INSERT INTO permissions (id, code, name) VALUES
  (gen_random_uuid(), 'customer-quality:complaints:close', '关闭及恢复本人跟进的客诉台账'),
  (gen_random_uuid(), 'customer-quality:complaints:closed-edit', '补充已关闭客诉资料'),
  (gen_random_uuid(), 'customer-quality:analyses:fae', '办理本人负责的客诉功能解析'),
  (gen_random_uuid(), 'customer-quality:analyses:supplier', '办理本人负责的客诉供应商分析')
ON CONFLICT (code) DO NOTHING;
