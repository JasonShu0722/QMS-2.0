ALTER TABLE "process_defects"
  ADD COLUMN "factory_code" VARCHAR(16),
  ADD CONSTRAINT "process_defects_factory_code_check"
  CHECK ("factory_code" IN ('FACTORY_1', 'FACTORY_2'));
