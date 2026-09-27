CREATE TABLE supplier_incoming_inspections (
  id uuid PRIMARY KEY,
  owner_organization_id uuid NOT NULL REFERENCES organizations(id),
  profile_id uuid NOT NULL,
  supplier_organization_id uuid NOT NULL,
  supplier_business_code varchar(100) NOT NULL,
  supplier_name varchar(200) NOT NULL,
  material_code varchar(100) NOT NULL CHECK (length(trim(material_code)) > 0),
  incoming_batch varchar(160) NOT NULL CHECK (length(trim(incoming_batch)) > 0),
  received_quantity integer NOT NULL CHECK (received_quantity > 0),
  sampled_quantity integer NOT NULL CHECK (sampled_quantity > 0 AND sampled_quantity <= received_quantity),
  conclusion varchar(16) NOT NULL DEFAULT 'PENDING' CHECK (conclusion IN ('PENDING', 'PASS', 'NG')),
  status varchar(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'COMPLETED', 'CORRECTED')),
  inspector_id uuid NOT NULL REFERENCES users(id),
  inspected_at timestamptz(3),
  source_system varchar(32) NOT NULL DEFAULT 'MANUAL' CHECK (source_system IN ('MANUAL', 'MES')),
  external_record_key varchar(200),
  external_batch_key varchar(200),
  observed_at timestamptz(3),
  source_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(source_snapshot) = 'object'),
  correction_reason varchar(2000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (profile_id, owner_organization_id, supplier_organization_id)
    REFERENCES supplier_business_profiles(id, owner_organization_id, supplier_organization_id)
);
CREATE UNIQUE INDEX supplier_incoming_external_key
  ON supplier_incoming_inspections(owner_organization_id, source_system, external_record_key)
  WHERE external_record_key IS NOT NULL;
CREATE INDEX supplier_incoming_scope_idx
  ON supplier_incoming_inspections(owner_organization_id, created_at DESC, id DESC);
CREATE INDEX supplier_incoming_filter_idx
  ON supplier_incoming_inspections(owner_organization_id, supplier_organization_id, material_code, incoming_batch);

CREATE TABLE supplier_incoming_items (
  id uuid PRIMARY KEY,
  inspection_id uuid NOT NULL REFERENCES supplier_incoming_inspections(id) ON DELETE CASCADE,
  item_order integer NOT NULL CHECK (item_order > 0),
  item_name varchar(200) NOT NULL CHECK (length(trim(item_name)) > 0),
  measured_value varchar(500),
  result varchar(16) NOT NULL CHECK (result IN ('PASS', 'NG', 'NA')),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (inspection_id, item_order)
);

CREATE TABLE supplier_incoming_photos (
  id uuid PRIMARY KEY,
  inspection_id uuid NOT NULL REFERENCES supplier_incoming_inspections(id) ON DELETE RESTRICT,
  file_id uuid NOT NULL REFERENCES file_objects(id),
  purpose varchar(100) NOT NULL DEFAULT 'INSPECTION_PHOTO',
  note varchar(1000),
  created_by_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (inspection_id, file_id)
);

CREATE TABLE supplier_incoming_problem_links (
  id uuid PRIMARY KEY,
  owner_organization_id uuid NOT NULL REFERENCES organizations(id),
  inspection_id uuid NOT NULL REFERENCES supplier_incoming_inspections(id) ON DELETE RESTRICT,
  problem_id uuid NOT NULL REFERENCES supplier_quality_problems(id) ON DELETE RESTRICT,
  conclusion_snapshot varchar(16) NOT NULL,
  source_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (inspection_id)
);
CREATE INDEX supplier_incoming_problem_links_problem_idx ON supplier_incoming_problem_links(owner_organization_id, problem_id);

CREATE FUNCTION validate_supplier_incoming_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source_system = 'MES' AND (NEW.external_record_key IS NULL OR NEW.observed_at IS NULL) THEN
    RAISE EXCEPTION 'MES source requires external key and observed time' USING ERRCODE = '23514';
  END IF;
  IF NEW.source_system = 'MANUAL' AND NEW.external_record_key IS NOT NULL THEN
    RAISE EXCEPTION 'Manual source cannot have external key' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER supplier_incoming_scope BEFORE INSERT OR UPDATE ON supplier_incoming_inspections
  FOR EACH ROW EXECUTE FUNCTION validate_supplier_incoming_scope();

INSERT INTO permissions(id, code, name) VALUES
  (gen_random_uuid(), 'supplier-incoming:inspections:read', '查看来料检验'),
  (gen_random_uuid(), 'supplier-incoming:inspections:write', '维护来料检验')
ON CONFLICT (code) DO NOTHING;
