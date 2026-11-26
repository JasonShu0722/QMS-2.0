CREATE TABLE department_responsible_appointments (
  organization_id uuid NOT NULL,
  department_id uuid NOT NULL,
  assignment_ids uuid[] NOT NULL,
  primary_assignment_id uuid,
  version integer NOT NULL CHECK (version > 0),
  PRIMARY KEY (organization_id, department_id),
  FOREIGN KEY (organization_id, department_id) REFERENCES departments(organization_id, id) ON DELETE CASCADE,
  CHECK (cardinality(assignment_ids) <= 100 AND array_position(assignment_ids, NULL) IS NULL),
  CHECK ((cardinality(assignment_ids) = 0 AND primary_assignment_id IS NULL)
    OR (primary_assignment_id IS NOT NULL AND primary_assignment_id = ANY(assignment_ids)))
);

ALTER TABLE department_minister_scopes
  ADD COLUMN department_leadership boolean NOT NULL DEFAULT false,
  DROP CONSTRAINT department_minister_scopes_no_overlap,
  ADD CONSTRAINT department_minister_scopes_no_overlap EXCLUDE USING gist (
    organization_id WITH =,
    section_department_id WITH =,
    (department_leadership::integer) WITH =,
    tstzrange(valid_from, valid_to, '[)') WITH &&
  ) WHERE (status = 'ACTIVE');
