CREATE TABLE supplier_workflow_bindings (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  severity varchar(32) NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  response_form varchar(32) NOT NULL CHECK (response_form IN ('BRIEF', 'EIGHT_D')),
  reply_mode varchar(32) NOT NULL CHECK (reply_mode IN ('INTERNAL', 'SUPPLIER')),
  version integer NOT NULL CHECK (version > 0),
  workflow_version_id uuid NOT NULL,
  enabled boolean NOT NULL,
  created_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT supplier_workflow_bindings_selector_version_key UNIQUE (organization_id, severity, response_form, reply_mode, version),
  CONSTRAINT supplier_workflow_bindings_workflow_scope_fkey FOREIGN KEY (organization_id, workflow_version_id)
    REFERENCES workflow_versions(organization_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX supplier_workflow_bindings_workflow_version_id_idx ON supplier_workflow_bindings(workflow_version_id);
CREATE INDEX supplier_workflow_bindings_created_by_id_idx ON supplier_workflow_bindings(created_by_id);

CREATE FUNCTION protect_supplier_workflow_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'SUPPLIER_BINDING_IMMUTABLE' USING ERRCODE = '23514'; END IF;
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = NEW.organization_id AND type = 'INTERNAL') THEN
    RAISE EXCEPTION 'SUPPLIER_BINDING_OWNER_INVALID' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER supplier_workflow_binding_immutable BEFORE INSERT OR UPDATE OR DELETE ON supplier_workflow_bindings
  FOR EACH ROW EXECUTE FUNCTION protect_supplier_workflow_binding();

CREATE FUNCTION protect_supplier_binding_organization() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.type IS DISTINCT FROM OLD.type AND EXISTS (SELECT 1 FROM supplier_workflow_bindings WHERE organization_id = OLD.id) THEN
    RAISE EXCEPTION 'Supplier workflow binding prevents organization type change' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER supplier_binding_organization_reference BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION protect_supplier_binding_organization();
