ALTER TABLE supplier_concession_requests DROP CONSTRAINT supplier_concession_requests_status_check;
ALTER TABLE supplier_concession_requests ADD CONSTRAINT supplier_concession_requests_status_check
  CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'RELEASED', 'WITHDRAWN'));
ALTER TABLE supplier_concession_events DROP CONSTRAINT supplier_concession_events_event_type_check;
ALTER TABLE supplier_concession_events ADD CONSTRAINT supplier_concession_events_event_type_check
  CHECK (event_type IN ('CREATED', 'SUBMITTED', 'APPROVED', 'REJECTED', 'RELEASED', 'WITHDRAWN'));
DROP INDEX supplier_concession_one_active_inspection;
CREATE UNIQUE INDEX supplier_concession_one_active_inspection
  ON supplier_concession_requests(inspection_id) WHERE status NOT IN ('REJECTED', 'WITHDRAWN');
