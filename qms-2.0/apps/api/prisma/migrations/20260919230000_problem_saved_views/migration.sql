CREATE TABLE problem_saved_views (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name VARCHAR(100) NOT NULL CHECK (length(btrim(name)) > 0),
  configuration JSONB NOT NULL CHECK (jsonb_typeof(configuration) = 'object'),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX problem_saved_views_personal_order_idx ON problem_saved_views(owner_user_id, organization_id, updated_at, id);
CREATE INDEX problem_saved_views_organization_id_idx ON problem_saved_views(organization_id);
