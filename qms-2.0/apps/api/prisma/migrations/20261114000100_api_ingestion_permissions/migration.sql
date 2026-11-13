INSERT INTO permissions (id, code, name)
VALUES (gen_random_uuid(), 'ingestion:read', '查看API入库规则与结果'),
       (gen_random_uuid(), 'ingestion:manage', '配置API入库规则'),
       (gen_random_uuid(), 'ingestion:run', '执行导入、队列控制与差异确认')
ON CONFLICT (code) DO NOTHING;
