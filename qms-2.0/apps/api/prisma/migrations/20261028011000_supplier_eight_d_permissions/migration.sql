INSERT INTO permissions (id, code, name) VALUES
  (gen_random_uuid(), 'supplier-quality:issues:read', '查看供应商受控8D'),
  (gen_random_uuid(), 'supplier-quality:issues:issue', '正式发起供应商8D'),
  (gen_random_uuid(), 'supplier-quality:issues:work', '办理供应商专业工作及资料修补'),
  (gen_random_uuid(), 'supplier-quality:issues:reassign', '交接供应商责任SQE'),
  (gen_random_uuid(), 'supplier-quality:issues:deadlines', '维护供应商阶段期限'),
  (gen_random_uuid(), 'supplier-quality:issues:report', '查看供应商受控报告'),
  (gen_random_uuid(), 'supplier-quality:issues:copy', '受控复制内部来源至供应商草稿')
ON CONFLICT (code) DO NOTHING;
