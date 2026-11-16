BEGIN;

DO $$
DECLARE identity_constraint text;
BEGIN
  SELECT constraint_row.conname INTO identity_constraint
  FROM pg_constraint constraint_row
  WHERE constraint_row.conrelid = 'integration_ai_description_tasks'::regclass AND constraint_row.contype = 'u'
    AND (SELECT array_agg(attribute_row.attname::text ORDER BY key_column.ordinality)
      FROM unnest(constraint_row.conkey) WITH ORDINALITY AS key_column(attribute_number, ordinality)
      JOIN pg_attribute attribute_row ON attribute_row.attrelid = constraint_row.conrelid AND attribute_row.attnum = key_column.attribute_number)
      = ARRAY['organization_id','defect_id','rule_id','rule_version','connection_version','input_digest'];
  IF identity_constraint IS NULL THEN
    RAISE EXCEPTION 'AI_DESCRIPTION_INPUT_IDENTITY_CONSTRAINT_MISSING';
  END IF;
  EXECUTE format('ALTER TABLE integration_ai_description_tasks DROP CONSTRAINT %I', identity_constraint);
END;
$$;

ALTER TABLE integration_ai_description_tasks
  ADD CONSTRAINT integration_ai_description_revision_key
  UNIQUE(organization_id,defect_id,rule_id,rule_version,connection_version,input_digest,input_revision);

COMMIT;
