INSERT INTO permissions (id, code, name) VALUES
  (gen_random_uuid(), 'process-quality:defects:close', '关闭及恢复制程台账'),
  (gen_random_uuid(), 'process-quality:materials:review', '复核本人负责的物料不良'),
  (gen_random_uuid(), 'process-quality:issues:read', '查看制程8D及报告'),
  (gen_random_uuid(), 'process-quality:issues:report', '导出有权读取的制程8D报告'),
  (gen_random_uuid(), 'process-quality:issues:issue', '发起制程8D'),
  (gen_random_uuid(), 'process-quality:issues:work', '办理本人负责或协作的制程8D'),
  (gen_random_uuid(), 'process-quality:issues:sources', '调整制程8D来源范围'),
  (gen_random_uuid(), 'process-quality:issues:risk', '调整制程8D风险'),
  (gen_random_uuid(), 'process-quality:issues:reassign', '撤回重派制程8D责任范围'),
  (gen_random_uuid(), 'process-quality:issues:deadlines', '设置制程8D质量侧期限')
ON CONFLICT (code) DO NOTHING;
