ALTER TABLE customer_quality_complaints
  ADD COLUMN category varchar(32),
  ADD COLUMN category_note varchar(200),
  ADD COLUMN responsible_department_id uuid,
  ADD COLUMN owner_user_id uuid,
  ADD COLUMN resolution_summary text,
  ADD COLUMN resolved_at timestamptz(3),
  ADD COLUMN resolved_by_id uuid,
  ADD COLUMN closed_at timestamptz(3),
  ADD COLUMN closed_by_id uuid,
  ADD COLUMN closure_note text;

ALTER TABLE customer_quality_complaints
  DROP CONSTRAINT customer_quality_complaints_status_check,
  ADD CONSTRAINT customer_quality_complaints_status_check CHECK (status IN ('OPEN', 'IN_ANALYSIS', 'RESOLVED', 'CLOSED', 'ARCHIVED')),
  ADD CONSTRAINT customer_quality_complaints_category_check CHECK (category IS NULL OR category IN ('PRODUCT_QUALITY', 'DELIVERY', 'SERVICE', 'OTHER')),
  ADD CONSTRAINT customer_quality_complaints_category_note_check CHECK ((category = 'OTHER' AND length(trim(coalesce(category_note, ''))) BETWEEN 1 AND 200) OR (category IS DISTINCT FROM 'OTHER' AND category_note IS NULL)),
  ADD CONSTRAINT customer_quality_complaints_responsibility_fk FOREIGN KEY (organization_id, responsible_department_id) REFERENCES departments(organization_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT customer_quality_complaints_owner_fk FOREIGN KEY (organization_id, owner_user_id) REFERENCES users(organization_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT customer_quality_complaints_resolved_by_fk FOREIGN KEY (resolved_by_id) REFERENCES users(id) ON DELETE RESTRICT,
  ADD CONSTRAINT customer_quality_complaints_closed_by_fk FOREIGN KEY (closed_by_id) REFERENCES users(id) ON DELETE RESTRICT;

CREATE TABLE customer_quality_complaint_events (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  complaint_id uuid NOT NULL,
  seq integer NOT NULL CHECK (seq > 0),
  event_type varchar(32) NOT NULL CHECK (event_type IN ('TRIAGED', 'REASSIGNED', 'PROGRESS_RECORDED', 'RESOLVED', 'CLOSED', 'REOPENED', 'ARCHIVED')),
  from_status varchar(32) NOT NULL,
  to_status varchar(32) NOT NULL,
  note text NOT NULL CHECK (length(trim(note)) BETWEEN 1 AND 10000),
  category varchar(32),
  responsible_department_id uuid,
  owner_user_id uuid,
  evidence_file_object_id uuid REFERENCES file_objects(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, complaint_id, seq),
  FOREIGN KEY (organization_id, complaint_id) REFERENCES customer_quality_complaints(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, responsible_department_id) REFERENCES departments(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, owner_user_id) REFERENCES users(organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX customer_quality_complaint_events_lookup_idx ON customer_quality_complaint_events (organization_id, complaint_id, seq);

CREATE FUNCTION customer_quality_complaint_events_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'customer complaint processing events are immutable';
END;
$$;
CREATE TRIGGER customer_quality_complaint_events_no_update BEFORE UPDATE OR DELETE ON customer_quality_complaint_events
  FOR EACH ROW EXECUTE FUNCTION customer_quality_complaint_events_immutable();
