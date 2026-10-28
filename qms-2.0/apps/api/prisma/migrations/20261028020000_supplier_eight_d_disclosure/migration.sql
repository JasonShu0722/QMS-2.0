CREATE TABLE supplier_eight_d_disclosure_previews (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  supplier_problem_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  target_supplier_organization_id uuid NOT NULL,
  row_version integer NOT NULL CHECK (row_version > 0),
  content_version integer NOT NULL CHECK (content_version > 0),
  instance_version integer NOT NULL CHECK (instance_version > 0),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object' AND octet_length(snapshot::text) <= 1048576),
  digest varchar(64) NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz(3) NOT NULL,
  expires_at timestamptz(3) NOT NULL CHECK (expires_at > created_at),
  consumed_at timestamptz(3),
  UNIQUE (id, organization_id, supplier_problem_id, target_supplier_organization_id, actor_user_id),
  FOREIGN KEY (organization_id, supplier_problem_id) REFERENCES supplier_eight_d_controls(organization_id, supplier_problem_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, actor_user_id) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (supplier_problem_id, organization_id, target_supplier_organization_id)
    REFERENCES supplier_quality_problems(id, owner_organization_id, supplier_organization_id) ON DELETE RESTRICT,
  CHECK (consumed_at IS NULL OR (consumed_at >= created_at AND consumed_at <= expires_at))
);

CREATE TABLE supplier_eight_d_publications (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  supplier_problem_id uuid NOT NULL,
  target_supplier_organization_id uuid NOT NULL,
  preview_id uuid NOT NULL UNIQUE,
  released_by uuid NOT NULL,
  released_at timestamptz(3) NOT NULL,
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object' AND octet_length(snapshot::text) <= 2097152),
  UNIQUE (organization_id, supplier_problem_id),
  FOREIGN KEY (preview_id, organization_id, supplier_problem_id, target_supplier_organization_id, released_by)
    REFERENCES supplier_eight_d_disclosure_previews(id, organization_id, supplier_problem_id, target_supplier_organization_id, actor_user_id) ON DELETE RESTRICT,
  FOREIGN KEY (supplier_problem_id, organization_id, target_supplier_organization_id)
    REFERENCES supplier_quality_problems(id, owner_organization_id, supplier_organization_id) ON DELETE RESTRICT
);
CREATE TRIGGER supplier_eight_d_publication_immutable BEFORE UPDATE OR DELETE ON supplier_eight_d_publications
  FOR EACH ROW EXECUTE FUNCTION supplier_eight_d_reject_history_mutation();

CREATE FUNCTION supplier_eight_d_preserve_preview() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'consumed_at') IS DISTINCT FROM (to_jsonb(OLD) - 'consumed_at')
    OR (OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at) THEN
    RAISE EXCEPTION 'supplier disclosure preview is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER supplier_eight_d_preview_immutable BEFORE UPDATE ON supplier_eight_d_disclosure_previews
  FOR EACH ROW EXECUTE FUNCTION supplier_eight_d_preserve_preview();
