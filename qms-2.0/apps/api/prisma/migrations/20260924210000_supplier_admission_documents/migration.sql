CREATE TABLE supplier_admission_documents (
  id uuid PRIMARY KEY,
  owner_organization_id uuid NOT NULL REFERENCES organizations(id),
  supplier_organization_id uuid NOT NULL REFERENCES organizations(id),
  profile_id uuid NOT NULL,
  document_type varchar(32) NOT NULL CHECK (document_type IN ('QUALITY_MANUAL', 'CERTIFICATE', 'PROCESS_CONTROL', 'PPAP', 'OTHER')),
  title varchar(200) NOT NULL CHECK (length(trim(title)) > 0),
  status varchar(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'NEEDS_CHANGES', 'ACCEPTED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  file_id uuid REFERENCES file_objects(id) ON DELETE RESTRICT,
  review_note varchar(2000),
  created_by_id uuid NOT NULL REFERENCES users(id),
  reviewed_by_id uuid REFERENCES users(id),
  submitted_at timestamptz(3),
  reviewed_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (profile_id, owner_organization_id, supplier_organization_id)
    REFERENCES supplier_business_profiles(id, owner_organization_id, supplier_organization_id) ON DELETE RESTRICT,
  CHECK (status NOT IN ('SUBMITTED', 'ACCEPTED') OR (file_id IS NOT NULL AND submitted_at IS NOT NULL)),
  CHECK (status <> 'ACCEPTED' OR (reviewed_by_id IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE INDEX supplier_admission_owner_idx ON supplier_admission_documents(owner_organization_id, created_at DESC, id DESC);
CREATE INDEX supplier_admission_supplier_idx ON supplier_admission_documents(supplier_organization_id, created_at DESC, id DESC);
CREATE INDEX supplier_admission_profile_idx ON supplier_admission_documents(profile_id, document_type);

CREATE TABLE supplier_admission_document_events (
  id uuid PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES supplier_admission_documents(id) ON DELETE RESTRICT,
  event_type varchar(20) NOT NULL CHECK (event_type IN ('CREATED', 'SUBMITTED', 'NEEDS_CHANGES', 'ACCEPTED')),
  document_version integer NOT NULL CHECK (document_version > 0),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  file_id uuid REFERENCES file_objects(id) ON DELETE RESTRICT,
  note varchar(2000),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (document_id, document_version)
);

INSERT INTO permissions(id, code, name) VALUES
  (gen_random_uuid(), 'supplier-admission:documents:read', '查看供应商质量资料'),
  (gen_random_uuid(), 'supplier-admission:documents:review', '审核供应商质量资料'),
  (gen_random_uuid(), 'supplier-admission:submissions:read', '查看本企业质量资料'),
  (gen_random_uuid(), 'supplier-admission:submissions:write', '提交本企业质量资料')
ON CONFLICT (code) DO NOTHING;
