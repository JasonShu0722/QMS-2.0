CREATE TABLE ai_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  name varchar(120) NOT NULL CHECK (length(btrim(name)) > 0),
  base_url varchar(500) NOT NULL,
  models text[] NOT NULL CHECK (cardinality(models) BETWEEN 1 AND 30 AND array_position(models,NULL) IS NULL),
  default_model varchar(120) NOT NULL CHECK (default_model = ANY(models)),
  enabled boolean NOT NULL DEFAULT false,
  secret_ciphertext text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  CHECK (NOT enabled OR secret_ciphertext IS NOT NULL)
);

CREATE INDEX ai_connections_organization_list ON ai_connections(organization_id,name,id);
