ALTER TABLE administrative_deletions DROP CONSTRAINT administrative_deletions_entity_kind_check;
ALTER TABLE administrative_deletions ADD CONSTRAINT administrative_deletions_entity_kind_check
  CHECK (entity_kind IN ('ORGANIZATION', 'DEPARTMENT', 'POSITION', 'USER'));

INSERT INTO permissions(id, code, name)
VALUES (gen_random_uuid(), 'organization:positions:force-delete', '强制删除岗位')
ON CONFLICT (code) DO NOTHING;
