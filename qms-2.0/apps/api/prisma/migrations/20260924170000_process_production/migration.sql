CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE process_production_batches (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  batch_code varchar(100) NOT NULL CHECK (length(trim(batch_code)) > 0),
  work_order_code varchar(100) NOT NULL CHECK (length(trim(work_order_code)) > 0),
  operation_code varchar(100) NOT NULL CHECK (length(trim(operation_code)) > 0),
  product_code varchar(100) NOT NULL CHECK (length(trim(product_code)) > 0),
  line_code varchar(100),
  period_start timestamptz(3) NOT NULL,
  period_end timestamptz(3) NOT NULL,
  total_quantity integer NOT NULL CHECK (total_quantity > 0),
  good_quantity integer NOT NULL CHECK (good_quantity >= 0),
  first_pass_quantity integer NOT NULL CHECK (first_pass_quantity >= 0),
  source_kind varchar(32) NOT NULL DEFAULT 'MANUAL' CHECK (source_kind = 'MANUAL'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (period_end > period_start),
  CHECK (first_pass_quantity <= good_quantity AND good_quantity <= total_quantity),
  UNIQUE (organization_id, id),
  EXCLUDE USING gist (organization_id WITH =, batch_code WITH =, work_order_code WITH =, operation_code WITH =, tstzrange(period_start, period_end, '[)') WITH &&)
);
CREATE INDEX process_production_batches_summary_idx ON process_production_batches(organization_id, period_start, period_end, product_code);

CREATE TABLE process_production_revisions (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  production_batch_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  total_quantity integer NOT NULL CHECK (total_quantity > 0),
  good_quantity integer NOT NULL CHECK (good_quantity >= 0),
  first_pass_quantity integer NOT NULL CHECK (first_pass_quantity >= 0),
  reason varchar(2000) NOT NULL CHECK (length(trim(reason)) > 0),
  recorded_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recorded_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id, production_batch_id) REFERENCES process_production_batches(organization_id, id) ON DELETE RESTRICT,
  CHECK (first_pass_quantity <= good_quantity AND good_quantity <= total_quantity),
  UNIQUE (organization_id, production_batch_id, version)
);

CREATE FUNCTION prevent_process_production_revision_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Process production revisions are immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER process_production_revisions_immutable BEFORE UPDATE OR DELETE ON process_production_revisions
FOR EACH ROW EXECUTE FUNCTION prevent_process_production_revision_change();
