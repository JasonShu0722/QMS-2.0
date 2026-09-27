CREATE TABLE user_signatures (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  label varchar(120) NOT NULL CHECK (length(trim(label)) > 0),
  fingerprint char(64) NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at timestamptz(3),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, user_id) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  CHECK ((status = 'ACTIVE' AND revoked_at IS NULL) OR (status = 'REVOKED' AND revoked_at IS NOT NULL))
);
CREATE INDEX user_signatures_owner_idx ON user_signatures (organization_id, user_id, status, created_at DESC);

CREATE TABLE approval_signatures (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  signature_id uuid NOT NULL,
  signer_user_id uuid NOT NULL,
  resource_type varchar(64) NOT NULL CHECK (resource_type ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  resource_id varchar(128) NOT NULL CHECK (length(trim(resource_id)) > 0),
  resource_version integer NOT NULL CHECK (resource_version > 0),
  signature_fingerprint char(64) NOT NULL CHECK (signature_fingerprint ~ '^[0-9a-f]{64}$'),
  signed_digest char(64) NOT NULL CHECK (signed_digest ~ '^[0-9a-f]{64}$'),
  note varchar(2000),
  signed_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, signature_id) REFERENCES user_signatures(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, signer_user_id) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, resource_type, resource_id, resource_version, signer_user_id, signature_id)
);
CREATE INDEX approval_signatures_resource_idx ON approval_signatures (organization_id, resource_type, resource_id, resource_version, signed_at DESC);

CREATE FUNCTION reject_approval_signature_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Approval signatures are immutable' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER approval_signature_immutable BEFORE UPDATE OR DELETE ON approval_signatures
  FOR EACH ROW EXECUTE FUNCTION reject_approval_signature_mutation();

INSERT INTO permissions(id, code, name) VALUES
  (gen_random_uuid(), 'e-signature:signatures:read', '查看本人电子签名'),
  (gen_random_uuid(), 'e-signature:signatures:write', '注册和撤销电子签名'),
  (gen_random_uuid(), 'e-signature:approvals:read', '查看审批签章'),
  (gen_random_uuid(), 'e-signature:approvals:sign', '引用电子签名完成审批签章')
ON CONFLICT (code) DO NOTHING;
