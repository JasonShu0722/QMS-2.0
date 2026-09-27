CREATE TABLE supplier_audit_checklist_items (
  id uuid PRIMARY KEY,
  owner_organization_id uuid NOT NULL,
  record_id uuid NOT NULL,
  code varchar(64) NOT NULL CHECK (length(trim(code)) > 0),
  title varchar(300) NOT NULL CHECK (length(trim(title)) > 0),
  result varchar(24) NOT NULL CHECK (result IN ('PASS', 'MINOR_NC', 'MAJOR_NC', 'NA')),
  note varchar(2000),
  position integer NOT NULL CHECK (position >= 0),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (owner_organization_id, record_id, code),
  UNIQUE (owner_organization_id, record_id, position),
  UNIQUE (owner_organization_id, id),
  FOREIGN KEY (record_id, owner_organization_id)
    REFERENCES supplier_audit_records(id, owner_organization_id) ON DELETE CASCADE
);

CREATE INDEX supplier_audit_checklist_items_record_idx
  ON supplier_audit_checklist_items(owner_organization_id, record_id, position);

CREATE TABLE supplier_audit_checklist_evidence (
  id uuid PRIMARY KEY,
  owner_organization_id uuid NOT NULL,
  checklist_item_id uuid NOT NULL,
  file_id uuid NOT NULL REFERENCES file_objects(id),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (file_id),
  FOREIGN KEY (checklist_item_id, owner_organization_id)
    REFERENCES supplier_audit_checklist_items(id, owner_organization_id) ON DELETE CASCADE
);

CREATE INDEX supplier_audit_checklist_evidence_item_idx
  ON supplier_audit_checklist_evidence(owner_organization_id, checklist_item_id);

ALTER TABLE supplier_audit_record_events
  DROP CONSTRAINT supplier_audit_record_events_event_type_check;
ALTER TABLE supplier_audit_record_events
  ADD CONSTRAINT supplier_audit_record_events_event_type_check
  CHECK (event_type IN ('CREATED', 'CHECKLIST_UPDATED', 'SUBMITTED', 'CLOSED'));
