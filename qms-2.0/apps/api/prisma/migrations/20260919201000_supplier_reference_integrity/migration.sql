CREATE OR REPLACE FUNCTION protect_supplier_identity_references() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.account_type IS DISTINCT FROM OLD.account_type THEN
    IF EXISTS (SELECT 1 FROM supplier_quality_problems WHERE internal_responder_id = OLD.id OR created_by_id = OLD.id)
      OR EXISTS (SELECT 1 FROM supplier_response_drafts WHERE updated_by_id = OLD.id)
      OR EXISTS (SELECT 1 FROM supplier_response_revisions WHERE submitted_by_id = OLD.id) THEN
      RAISE EXCEPTION 'Supplier business user reference prevents transfer' USING ERRCODE = '23503';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION protect_supplier_organization_references() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.type IS DISTINCT FROM OLD.type AND EXISTS (
    SELECT 1 FROM supplier_business_profiles WHERE owner_organization_id = OLD.id OR supplier_organization_id = OLD.id
  ) THEN RAISE EXCEPTION 'Supplier relationship prevents organization type change' USING ERRCODE = '23503'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER supplier_organization_reference BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION protect_supplier_organization_references();
