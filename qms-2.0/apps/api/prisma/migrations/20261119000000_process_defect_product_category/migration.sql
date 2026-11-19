BEGIN;

ALTER TABLE process_defects ADD COLUMN product_category varchar(100);

UPDATE process_defects
SET product_category = project_snapshot #>> '{mapping,productCategory}'
WHERE registration_version = 1
  AND project_snapshot ->> 'componentCode' = product_code
  AND project_snapshot #>> '{mapping,status}' = 'ACTIVE'
  AND jsonb_typeof(project_snapshot #> '{mapping,productCategory}') = 'string'
  AND length(project_snapshot #>> '{mapping,productCategory}') BETWEEN 1 AND 100
  AND project_snapshot #>> '{mapping,productCategory}' = btrim(project_snapshot #>> '{mapping,productCategory}');

COMMIT;
