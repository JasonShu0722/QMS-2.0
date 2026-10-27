-- Creation provenance remains a tombstone even when audit/receipt history is unavailable.
ALTER TABLE organization_initializations
  DROP CONSTRAINT organization_initializations_organization_id_fkey;

CREATE INDEX organization_initializations_creation_key_idx ON organization_initializations
  (creator_user_id, (original_organization->>'parentId'), (original_organization->>'creationKey'));
