CREATE TABLE ai_prompt_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  configuration jsonb NOT NULL CHECK (jsonb_typeof(configuration)='object'),
  enabled boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  availability_version integer NOT NULL DEFAULT 1 CHECK (availability_version>0),
  published_version integer CHECK (published_version>0),
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (id,organization_id)
);
CREATE INDEX ai_prompt_applications_organization_list ON ai_prompt_applications(organization_id,(configuration->>'name'),id);

CREATE TABLE ai_prompt_application_revisions (
  application_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  published_version integer NOT NULL CHECK (published_version>0),
  configuration jsonb NOT NULL CHECK (jsonb_typeof(configuration)='object'),
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(application_id,published_version),
  FOREIGN KEY(application_id,organization_id) REFERENCES ai_prompt_applications(id,organization_id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX ai_prompt_application_revisions_organization ON ai_prompt_application_revisions(organization_id,application_id,published_version);

ALTER TABLE integration_ai_description_tasks ADD COLUMN application_id uuid, ADD COLUMN application_version integer;
ALTER TABLE integration_ai_description_tasks ADD CONSTRAINT integration_ai_description_task_application
  CHECK ((application_id IS NULL AND application_version IS NULL) OR (application_id IS NOT NULL AND application_version>0));

DO $$
DECLARE
  rule_record record;
  application_id uuid;
  application_configuration jsonb;
BEGIN
  FOR rule_record IN SELECT id,organization_id,configuration FROM integration_ingestion_rules WHERE configuration ? 'aiDescription' AND jsonb_typeof(configuration->'aiDescription')='object' ORDER BY id LOOP
    application_id := gen_random_uuid();
    application_configuration := jsonb_build_object(
      'name',rule_record.configuration->>'name','domain','PROCESS_QUALITY','scene','PROCESS_DEFECT_DESCRIPTION','enabled',true,
      'variables',(SELECT jsonb_agg(jsonb_build_object('variable',field->>'variable','label',coalesce(field->>'label','')) ORDER BY ordinal)
        FROM jsonb_array_elements(rule_record.configuration->'aiDescription'->'inputFields') WITH ORDINALITY AS fields(field,ordinal)),
      'connectionId',rule_record.configuration->'aiDescription'->'connectionId',
      'model',rule_record.configuration->'aiDescription'->'model',
      'prompt',rule_record.configuration->'aiDescription'->'prompt',
      'output',rule_record.configuration->'aiDescription'->'output','fallback','DIRECT');
    INSERT INTO ai_prompt_applications(id,organization_id,configuration,enabled,published_version)
      VALUES(application_id,rule_record.organization_id,application_configuration,true,1);
    INSERT INTO ai_prompt_application_revisions(application_id,organization_id,published_version,configuration)
      VALUES(application_id,rule_record.organization_id,1,application_configuration);
    UPDATE integration_ingestion_rules SET configuration=configuration || jsonb_build_object('aiApplication',jsonb_build_object(
      'applicationId',application_id,'publishedVersion',1,'inputFields',configuration->'aiDescription'->'inputFields'))
      WHERE id=rule_record.id AND organization_id=rule_record.organization_id;
  END LOOP;
END $$;

CREATE FUNCTION protect_ai_prompt_application_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Published AI application revisions are immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER ai_prompt_application_revision_immutable BEFORE UPDATE OR DELETE ON ai_prompt_application_revisions
FOR EACH ROW EXECUTE FUNCTION protect_ai_prompt_application_revision();
