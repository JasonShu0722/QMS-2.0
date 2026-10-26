ALTER TABLE process_defects
  ALTER COLUMN defect_type_code DROP NOT NULL,
  ALTER COLUMN defect_quantity DROP NOT NULL,
  ALTER COLUMN occurred_at DROP NOT NULL,
  ALTER COLUMN responsibility_category DROP NOT NULL,
  DROP CONSTRAINT process_defects_description_check,
  DROP CONSTRAINT process_defects_responsibility_category_check,
  ADD CONSTRAINT process_defects_description_check CHECK (length(description) <= 10000),
  ADD CONSTRAINT process_defects_responsibility_category_check CHECK (responsibility_category IS NULL OR responsibility_category IN ('MATERIAL','OPERATION','EQUIPMENT','PROCESS','DESIGN','FALSE_POSITIVE')),
  ADD COLUMN trace_code varchar(200),
  ADD COLUMN analysis_progress text CHECK (analysis_progress IS NULL OR length(analysis_progress) <= 10000),
  ADD COLUMN ledger_status varchar(16) NOT NULL DEFAULT 'FOLLOWING' CHECK (ledger_status IN ('FOLLOWING','CLOSED')),
  ADD COLUMN closed_by_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN closed_at timestamptz(3),
  ADD CONSTRAINT process_defects_close_fact_check CHECK (
    (ledger_status = 'FOLLOWING' AND closed_by_id IS NULL AND closed_at IS NULL)
    OR (ledger_status = 'CLOSED' AND closed_by_id IS NOT NULL AND closed_at IS NOT NULL));

CREATE INDEX process_defects_organization_id_operation_code_trace_code_idx ON process_defects(organization_id, operation_code, trace_code);
CREATE INDEX process_defects_organization_id_ledger_status_created_at_idx ON process_defects(organization_id, ledger_status, created_at);

CREATE TABLE process_defect_ledger_history (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, defect_id uuid NOT NULL,
  from_status varchar(16) NOT NULL, to_status varchar(16) NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason varchar(2000), defect_version integer NOT NULL CHECK (defect_version > 0),
  recorded_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id, defect_id) REFERENCES process_defects(organization_id, id) ON DELETE RESTRICT,
  CHECK ((from_status = 'FOLLOWING' AND to_status = 'CLOSED') OR (from_status = 'CLOSED' AND to_status = 'FOLLOWING' AND length(trim(reason)) > 0 AND reason IS NOT NULL)),
  UNIQUE (organization_id, defect_id, defect_version)
);

CREATE TABLE process_defect_material_items (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, defect_id uuid NOT NULL, position integer NOT NULL CHECK (position >= 0),
  material_code varchar(100), material_name varchar(200),
  supplier_organization_id uuid REFERENCES organizations(id) ON DELETE RESTRICT,
  supplier_profile_id uuid REFERENCES supplier_business_profiles(id) ON DELETE RESTRICT,
  material_batch varchar(100), sqe_user_id uuid REFERENCES users(id) ON DELETE RESTRICT, notes varchar(2000),
  verification varchar(32) NOT NULL DEFAULT 'UNREVIEWED' CHECK (verification IN ('UNREVIEWED','CONFIRMED_DEFECT','NOT_MATERIAL','NEGOTIATED','RETURN_ANALYSIS')),
  verification_notes varchar(2000), verified_by_id uuid REFERENCES users(id) ON DELETE RESTRICT, verified_at timestamptz(3),
  created_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, updated_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, removed_at timestamptz(3),
  FOREIGN KEY (organization_id, defect_id) REFERENCES process_defects(organization_id, id) ON DELETE RESTRICT,
  CHECK ((verification = 'UNREVIEWED' AND verified_by_id IS NULL AND verified_at IS NULL) OR (verification <> 'UNREVIEWED' AND verified_by_id IS NOT NULL AND verified_at IS NOT NULL)),
  UNIQUE (organization_id, defect_id, id)
);
CREATE INDEX process_defect_material_items_defect_idx ON process_defect_material_items(organization_id, defect_id, removed_at, position);
CREATE INDEX process_defect_material_items_code_idx ON process_defect_material_items(organization_id, material_code) WHERE removed_at IS NULL;

CREATE TABLE process_defect_material_verifications (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, defect_id uuid NOT NULL, material_item_id uuid NOT NULL,
  verification varchar(32) NOT NULL CHECK (verification IN ('CONFIRMED_DEFECT','NOT_MATERIAL','NEGOTIATED','RETURN_ANALYSIS')),
  verification_notes varchar(2000), actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  defect_version integer NOT NULL CHECK (defect_version > 0), recorded_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  material_snapshot jsonb NOT NULL CHECK (jsonb_typeof(material_snapshot) = 'object'),
  FOREIGN KEY (organization_id, defect_id, material_item_id) REFERENCES process_defect_material_items(organization_id, defect_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, defect_id, defect_version)
);

CREATE TABLE process_defect_classification_history (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, defect_id uuid NOT NULL,
  previous_category varchar(32) CHECK (previous_category IS NULL OR previous_category IN ('MATERIAL','OPERATION','EQUIPMENT','PROCESS','DESIGN','FALSE_POSITIVE')),
  category varchar(32) CHECK (category IS NULL OR category IN ('MATERIAL','OPERATION','EQUIPMENT','PROCESS','DESIGN','FALSE_POSITIVE')),
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  defect_version integer NOT NULL CHECK (defect_version > 0), recorded_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id, defect_id) REFERENCES process_defects(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, defect_id, defect_version)
);

-- Move historical single-material facts to their sole owner; legacy columns become projections.
INSERT INTO process_defect_material_items (id, organization_id, defect_id, position, material_code, supplier_organization_id, created_by_id, updated_by_id, created_at, updated_at)
SELECT gen_random_uuid(), organization_id, id, 0, material_code, supplier_organization_id, created_by_id, updated_by_id, created_at, updated_at
FROM process_defects WHERE material_code IS NOT NULL OR supplier_organization_id IS NOT NULL;

CREATE FUNCTION project_process_defect_first_material() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_org uuid; target_defect uuid;
BEGIN
  target_org := COALESCE(NEW.organization_id, OLD.organization_id);
  target_defect := COALESCE(NEW.defect_id, OLD.defect_id);
  UPDATE process_defects SET
    material_code = (SELECT material_code FROM process_defect_material_items WHERE organization_id = target_org AND defect_id = target_defect AND removed_at IS NULL ORDER BY position, id LIMIT 1),
    supplier_organization_id = (SELECT supplier_organization_id FROM process_defect_material_items WHERE organization_id = target_org AND defect_id = target_defect AND removed_at IS NULL ORDER BY position, id LIMIT 1)
  WHERE organization_id = target_org AND id = target_defect;
  RETURN NULL;
END $$;
CREATE TRIGGER process_defect_first_material_projection AFTER INSERT OR UPDATE OR DELETE ON process_defect_material_items
FOR EACH ROW EXECUTE FUNCTION project_process_defect_first_material();
