CREATE TABLE supplier_business_profiles (
  id uuid PRIMARY KEY, owner_organization_id uuid NOT NULL REFERENCES organizations(id),
  supplier_organization_id uuid NOT NULL REFERENCES organizations(id),
  business_code varchar(100) NOT NULL CHECK (length(trim(business_code)) > 0),
  display_name varchar(200) NOT NULL CHECK (length(trim(display_name)) > 0),
  contact_name varchar(100), contact_email varchar(254), version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at timestamptz(3) NOT NULL,
  UNIQUE (owner_organization_id, supplier_organization_id), UNIQUE (owner_organization_id, business_code),
  UNIQUE (id, owner_organization_id, supplier_organization_id)
);

CREATE TABLE supplier_quality_problems (
  id uuid PRIMARY KEY, owner_organization_id uuid NOT NULL, supplier_organization_id uuid NOT NULL,
  profile_id uuid NOT NULL, title varchar(500) NOT NULL CHECK (length(trim(title)) > 0),
  material_code varchar(100) NOT NULL CHECK (length(trim(material_code)) > 0),
  material_category varchar(32) CHECK (material_category IN ('STRUCTURE', 'ELECTRONIC')),
  defect_description text NOT NULL CHECK (length(trim(defect_description)) BETWEEN 1 AND 10000),
  defect_quantity integer NOT NULL CHECK (defect_quantity > 0),
  severity varchar(32) NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  response_form varchar(32) NOT NULL CHECK (response_form IN ('BRIEF', 'EIGHT_D')),
  reply_mode varchar(32) NOT NULL CHECK (reply_mode IN ('INTERNAL', 'SUPPLIER')),
  internal_responder_id uuid REFERENCES users(id),
  problem_index_id uuid UNIQUE REFERENCES problem_indexes(id), released_to_supplier_at timestamptz(3),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0), created_by_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at timestamptz(3) NOT NULL,
  FOREIGN KEY (profile_id, owner_organization_id, supplier_organization_id)
    REFERENCES supplier_business_profiles(id, owner_organization_id, supplier_organization_id),
  CHECK ((reply_mode = 'INTERNAL' AND internal_responder_id IS NOT NULL) OR (reply_mode = 'SUPPLIER' AND internal_responder_id IS NULL)),
  CHECK (released_to_supplier_at IS NULL OR (reply_mode = 'SUPPLIER' AND problem_index_id IS NOT NULL))
);
CREATE INDEX supplier_quality_problems_owner_updated_idx ON supplier_quality_problems(owner_organization_id, updated_at);
CREATE INDEX supplier_quality_problems_supplier_release_idx ON supplier_quality_problems(supplier_organization_id, released_to_supplier_at);

CREATE TABLE supplier_response_drafts (
  problem_id uuid PRIMARY KEY REFERENCES supplier_quality_problems(id) ON DELETE CASCADE,
  content jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(content) = 'object'),
  updated_by_id uuid NOT NULL REFERENCES users(id), updated_at timestamptz(3) NOT NULL
);
CREATE TABLE supplier_response_revisions (
  id uuid PRIMARY KEY, problem_id uuid NOT NULL REFERENCES supplier_quality_problems(id), revision integer NOT NULL CHECK (revision > 0),
  content jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object'), submitted_by_id uuid NOT NULL REFERENCES users(id),
  workflow_instance_id uuid NOT NULL REFERENCES workflow_instances(id), workflow_version integer NOT NULL CHECK (workflow_version > 0),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (problem_id, revision), UNIQUE (id, problem_id)
);
CREATE TABLE supplier_evidence_references (
  problem_id uuid NOT NULL REFERENCES supplier_quality_problems(id), file_id uuid NOT NULL REFERENCES file_objects(id),
  revision_id uuid, purpose varchar(100) NOT NULL CHECK (length(trim(purpose)) > 0),
  PRIMARY KEY (problem_id, file_id),
  FOREIGN KEY (revision_id, problem_id) REFERENCES supplier_response_revisions(id, problem_id)
);

CREATE FUNCTION validate_supplier_profile_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = NEW.owner_organization_id AND type = 'INTERNAL')
    OR NOT EXISTS (SELECT 1 FROM organizations WHERE id = NEW.supplier_organization_id AND type = 'SUPPLIER') THEN
    RAISE EXCEPTION 'Invalid supplier relationship scope' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER supplier_profile_scope BEFORE INSERT OR UPDATE ON supplier_business_profiles
  FOR EACH ROW EXECUTE FUNCTION validate_supplier_profile_scope();

CREATE FUNCTION validate_supplier_problem_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.internal_responder_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM users WHERE id = NEW.internal_responder_id AND organization_id = NEW.owner_organization_id AND account_type = 'INTERNAL' AND status = 'ACTIVE'
  ) THEN RAISE EXCEPTION 'Invalid internal responder' USING ERRCODE = '23514'; END IF;
  IF NEW.problem_index_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM problem_indexes WHERE id = NEW.problem_index_id AND organization_id = NEW.owner_organization_id
      AND domain_code = 'supplier-quality' AND source_id = NEW.id
  ) THEN RAISE EXCEPTION 'Invalid supplier problem index' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER supplier_problem_scope BEFORE INSERT OR UPDATE ON supplier_quality_problems
  FOR EACH ROW EXECUTE FUNCTION validate_supplier_problem_scope();

CREATE FUNCTION protect_supplier_identity_references() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.account_type IS DISTINCT FROM OLD.account_type THEN
    IF EXISTS (SELECT 1 FROM supplier_quality_problems WHERE internal_responder_id = OLD.id OR created_by_id = OLD.id)
      OR EXISTS (SELECT 1 FROM supplier_response_drafts WHERE updated_by_id = OLD.id)
      OR EXISTS (SELECT 1 FROM supplier_response_revisions WHERE submitted_by_id = OLD.id) THEN
      RAISE EXCEPTION 'Supplier business user reference prevents transfer' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER supplier_identity_reference BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION protect_supplier_identity_references();

INSERT INTO permissions(id, code, name) VALUES
  (gen_random_uuid(), 'supplier-quality:profiles:read', '查看供应商业务资料'),
  (gen_random_uuid(), 'supplier-quality:profiles:write', '维护供应商业务资料'),
  (gen_random_uuid(), 'supplier-quality:problems:read', '查看供应商问题'),
  (gen_random_uuid(), 'supplier-quality:problems:write', '维护供应商问题草稿'),
  (gen_random_uuid(), 'supplier-quality:responses:read', '查看本企业整改问题'),
  (gen_random_uuid(), 'supplier-quality:responses:write', '保存整改回复草稿')
ON CONFLICT (code) DO NOTHING;
