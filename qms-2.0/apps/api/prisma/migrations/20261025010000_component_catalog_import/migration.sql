ALTER TABLE component_project_mappings
  ADD COLUMN component_name VARCHAR(200)
    CHECK (component_name IS NULL OR (component_name = btrim(component_name) AND length(component_name) > 0)),
  ALTER COLUMN project_record_id DROP NOT NULL,
  ALTER COLUMN product_category DROP NOT NULL;

ALTER TABLE component_project_mappings
  DROP CONSTRAINT component_project_mappings_product_category_check,
  ADD CONSTRAINT component_project_mappings_product_category_check
    CHECK (product_category IS NULL OR (product_category = btrim(product_category) AND length(product_category) > 0));
