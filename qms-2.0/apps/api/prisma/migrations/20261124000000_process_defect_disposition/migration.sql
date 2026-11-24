BEGIN;

CREATE TYPE "ProcessDefectDispositionPlan" AS ENUM ('REWORK', 'SCRAP', 'CONCESSION');

ALTER TABLE "process_defects"
  ADD COLUMN "disposition_plan" "ProcessDefectDispositionPlan",
  ADD COLUMN "disposition_progress" TEXT,
  ADD COLUMN "disposition_completed_at" TIMESTAMPTZ(3);

CREATE TABLE "process_defect_disposition_history" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "defect_id" UUID NOT NULL,
  "disposition_plan" "ProcessDefectDispositionPlan",
  "disposition_progress" TEXT,
  "disposition_completed_at" TIMESTAMPTZ(3),
  "actor_user_id" UUID NOT NULL,
  "defect_version" INTEGER NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "process_defect_disposition_history_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "process_defect_disposition_history_version_key" UNIQUE ("organization_id", "defect_id", "defect_version"),
  CONSTRAINT "process_defect_disposition_history_defect_fkey" FOREIGN KEY ("organization_id", "defect_id")
    REFERENCES "process_defects" ("organization_id", "id") ON DELETE CASCADE
);

DO $$
DECLARE legacy_constraint TEXT;
BEGIN
  SELECT conname INTO STRICT legacy_constraint
  FROM pg_constraint
  WHERE conrelid = 'process_defect_material_verifications'::regclass
    AND contype = 'u'
    AND pg_get_constraintdef(oid) = 'UNIQUE (organization_id, defect_id, defect_version)';

  EXECUTE format('ALTER TABLE process_defect_material_verifications DROP CONSTRAINT %I', legacy_constraint);
END $$;

ALTER TABLE "process_defect_material_verifications"
  ADD CONSTRAINT "process_defect_material_verifications_item_version_key"
    UNIQUE ("organization_id", "defect_id", "defect_version", "material_item_id");

COMMIT;
