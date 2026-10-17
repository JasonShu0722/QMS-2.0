CREATE TABLE material_masters (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  material_code VARCHAR(100) NOT NULL CHECK (length(btrim(material_code)) > 0 AND material_code = btrim(material_code)),
  material_name VARCHAR(200) NOT NULL CHECK (length(btrim(material_name)) > 0 AND material_name = btrim(material_name)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT material_masters_organization_id_material_code_key UNIQUE (organization_id, material_code)
);

INSERT INTO permissions (id, code, name) VALUES
  (gen_random_uuid(), 'material-master:read', '查看物料清单'),
  (gen_random_uuid(), 'material-master:write', '维护物料编码和名称'),
  (gen_random_uuid(), 'material-master:import', '批量新增物料')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN organizations o ON o.id = r.organization_id AND o.type = 'INTERNAL'
CROSS JOIN permissions p
WHERE p.code IN ('material-master:read', 'material-master:write', 'material-master:import')
  AND EXISTS (SELECT 1 FROM role_permissions rp JOIN permissions current ON current.id = rp.permission_id WHERE rp.role_id = r.id AND current.code = 'organization:manage')
  AND EXISTS (SELECT 1 FROM role_permissions rp JOIN permissions current ON current.id = rp.permission_id WHERE rp.role_id = r.id AND current.code = 'account:roles:assign')
ON CONFLICT DO NOTHING;
