CREATE TABLE process_ledger_workflow_configuration_revisions (
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    version INTEGER NOT NULL CHECK (version > 0),
    boards JSONB NOT NULL CHECK (jsonb_typeof(boards) = 'object'),
    updated_by_id UUID NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (organization_id, version)
);
