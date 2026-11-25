CREATE TABLE process_eight_d_workflow_configuration_revisions (
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    version INTEGER NOT NULL CHECK (version > 0),
    stages JSONB NOT NULL CHECK (jsonb_typeof(stages) = 'object'),
    workflow_version_id UUID,
    updated_by_id UUID NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (organization_id, version),
    FOREIGN KEY (organization_id, workflow_version_id) REFERENCES workflow_versions(organization_id, id) ON DELETE RESTRICT
);
