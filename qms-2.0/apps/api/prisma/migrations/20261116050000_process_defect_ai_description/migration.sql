ALTER TABLE process_defects
  ADD COLUMN description_direct text,
  ADD COLUMN description_input jsonb,
  ADD COLUMN description_ai text,
  ADD COLUMN description_ai_status varchar(16) NOT NULL DEFAULT 'DISABLED',
  ADD COLUMN description_source varchar(16) NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN description_input_version integer NOT NULL DEFAULT 0 CHECK (description_input_version >= 0),
  ADD COLUMN description_task_id uuid,
  ADD CONSTRAINT process_defects_description_source_check CHECK (description_source IN ('DIRECT','AI','MANUAL')),
  ADD CONSTRAINT process_defects_description_ai_status_check CHECK (description_ai_status IN ('DISABLED','PENDING','PROCESSING','RETRY','FAILED','APPLIED','SUGGESTED','STALE'));

UPDATE process_defects SET description_direct=description,description_source='DIRECT' WHERE source_kind='IMS';

CREATE TABLE integration_ai_description_tasks (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  defect_id uuid NOT NULL,
  rule_id uuid NOT NULL,
  rule_version integer NOT NULL CHECK(rule_version>0),
  connection_id uuid NOT NULL,
  connection_version integer NOT NULL CHECK(connection_version>0),
  input_digest varchar(64) NOT NULL,
  input_fields jsonb NOT NULL,
  prompt text NOT NULL CHECK(length(prompt) BETWEEN 1 AND 4000),
  model varchar(120) NOT NULL,
  output_configuration jsonb NOT NULL,
  actor_snapshot jsonb NOT NULL,
  expected_description text NOT NULL,
  input_revision integer NOT NULL CHECK(input_revision>=0),
  status varchar(16) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PROCESSING','RETRY','FAILED','APPLIED','SUGGESTED','STALE')),
  result text,
  error_code varchar(64),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
  next_attempt_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  claim_token uuid,
  claimed_at timestamptz(3),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(organization_id,defect_id) REFERENCES process_defects(organization_id,id) ON DELETE CASCADE,
  UNIQUE(organization_id,defect_id,rule_id,rule_version,connection_version,input_digest)
);
CREATE INDEX integration_ai_description_tasks_due ON integration_ai_description_tasks(next_attempt_at,id) WHERE status IN ('PENDING','RETRY','PROCESSING');
CREATE INDEX integration_ai_description_tasks_defect ON integration_ai_description_tasks(organization_id,defect_id,created_at DESC,id);
