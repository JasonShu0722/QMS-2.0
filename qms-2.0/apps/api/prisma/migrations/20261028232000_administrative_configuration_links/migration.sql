CREATE TABLE administrative_configuration_links (
  kind varchar(16) NOT NULL CHECK (kind IN ('DEPARTMENT', 'POSITION')),
  source_id uuid NOT NULL,
  source_orgid uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  replacement_id uuid NOT NULL,
  replacement_orgid uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  source_department_id uuid GENERATED ALWAYS AS (CASE WHEN kind = 'DEPARTMENT' THEN source_id END) STORED,
  replacement_department_id uuid GENERATED ALWAYS AS (CASE WHEN kind = 'DEPARTMENT' THEN replacement_id END) STORED,
  source_position_id uuid GENERATED ALWAYS AS (CASE WHEN kind = 'POSITION' THEN source_id END) STORED,
  replacement_position_id uuid GENERATED ALWAYS AS (CASE WHEN kind = 'POSITION' THEN replacement_id END) STORED,
  PRIMARY KEY (kind, source_id),
  CHECK (source_id <> replacement_id),
  CONSTRAINT acl_source_department_fk FOREIGN KEY (source_orgid, source_department_id) REFERENCES departments(organization_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT acl_replacement_department_fk FOREIGN KEY (replacement_orgid, replacement_department_id) REFERENCES departments(organization_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT acl_source_position_fk FOREIGN KEY (source_orgid, source_position_id) REFERENCES positions(organization_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT acl_replacement_position_fk FOREIGN KEY (replacement_orgid, replacement_position_id) REFERENCES positions(organization_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE FUNCTION preserve_administrative_configuration_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ADMIN_CONFIGURATION_LINK_IMMUTABLE' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER administrative_configuration_link_immutable BEFORE UPDATE OR DELETE ON administrative_configuration_links
  FOR EACH ROW EXECUTE FUNCTION preserve_administrative_configuration_link();
