INSERT INTO permissions (id, code, name) VALUES
  (gen_random_uuid(), 'customer-quality:complaints:reassign', '人工交接任职已失效的客诉跟进人')
ON CONFLICT (code) DO NOTHING;
