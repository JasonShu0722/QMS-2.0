INSERT INTO permissions(id, code, name) VALUES
  (gen_random_uuid(), 'component-project:read', '查看组件项目映射'),
  (gen_random_uuid(), 'component-project:manage', '维护组件项目映射及项目状态')
ON CONFLICT (code) DO NOTHING;
