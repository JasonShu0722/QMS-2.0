CREATE TABLE process_shipment_reports (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  report_number varchar(100) NOT NULL CHECK (length(trim(report_number)) > 0),
  status varchar(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ARCHIVED')),
  period_start timestamptz(3) NOT NULL,
  period_end timestamptz(3) NOT NULL,
  product_code varchar(100),
  batch_count integer NOT NULL CHECK (batch_count > 0),
  total_quantity integer NOT NULL CHECK (total_quantity > 0),
  good_quantity integer NOT NULL CHECK (good_quantity >= 0),
  first_pass_quantity integer NOT NULL CHECK (first_pass_quantity >= 0),
  defect_quantity integer NOT NULL CHECK (defect_quantity >= 0),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at timestamptz(3),
  CHECK (period_end > period_start),
  CHECK (first_pass_quantity <= good_quantity AND good_quantity <= total_quantity),
  UNIQUE (organization_id, report_number),
  UNIQUE (organization_id, id)
);

CREATE INDEX process_shipment_reports_list_idx ON process_shipment_reports(organization_id, archived_at, created_at DESC);
CREATE INDEX process_shipment_reports_period_idx ON process_shipment_reports(organization_id, period_start, period_end, product_code);

CREATE FUNCTION prevent_process_shipment_snapshot_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.snapshot IS DISTINCT FROM OLD.snapshot THEN
    RAISE EXCEPTION 'Process shipment report snapshots are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER process_shipment_reports_snapshot_immutable BEFORE UPDATE ON process_shipment_reports
FOR EACH ROW EXECUTE FUNCTION prevent_process_shipment_snapshot_change();
