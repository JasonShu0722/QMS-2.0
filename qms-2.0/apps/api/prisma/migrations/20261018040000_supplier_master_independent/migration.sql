ALTER TABLE supplier_business_profiles
  ALTER COLUMN supplier_organization_id DROP NOT NULL,
  ADD CONSTRAINT supplier_business_profiles_id_owner_organization_id_key UNIQUE (id, owner_organization_id);

ALTER TABLE supplier_quality_problems
  ALTER COLUMN supplier_organization_id DROP NOT NULL,
  ADD CONSTRAINT supplier_quality_problems_collaboration_check CHECK (released_to_supplier_at IS NULL OR supplier_organization_id IS NOT NULL);

DO $$
DECLARE relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'supplier_quality_problems', 'supplier_incoming_inspections', 'supplier_performance_cards',
    'supplier_concession_requests', 'supplier_audit_plans', 'supplier_audit_records',
    'supplier_quality_targets', 'supplier_meetings', 'supplier_ppap_packages',
    'supplier_inspection_standards', 'supplier_barcode_rules', 'supplier_asn_records'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN supplier_organization_id DROP NOT NULL', relation_name);
    -- Nullable enterprise snapshots must never bypass the mandatory owner/profile boundary.
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (profile_id, owner_organization_id) REFERENCES supplier_business_profiles(id, owner_organization_id) ON DELETE RESTRICT', relation_name, relation_name || '_profile_owner_fkey');
  END LOOP;
END $$;

ALTER TABLE supplier_concession_requests
  ADD CONSTRAINT supplier_concession_requests_profile_supplier_fkey FOREIGN KEY (profile_id, owner_organization_id, supplier_organization_id)
    REFERENCES supplier_business_profiles(id, owner_organization_id, supplier_organization_id) ON DELETE RESTRICT;

ALTER TABLE supplier_performance_cards
  ADD CONSTRAINT supplier_performance_cards_collaboration_check CHECK (status <> 'PUBLISHED' OR supplier_organization_id IS NOT NULL);

CREATE OR REPLACE FUNCTION validate_supplier_profile_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = NEW.owner_organization_id AND type = 'INTERNAL')
    OR (NEW.supplier_organization_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM organizations WHERE id = NEW.supplier_organization_id AND type = 'SUPPLIER')) THEN
    RAISE EXCEPTION 'Invalid supplier relationship scope' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
