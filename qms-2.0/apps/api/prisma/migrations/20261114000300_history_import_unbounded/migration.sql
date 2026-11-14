ALTER TABLE integration_receipts ADD COLUMN row_count INTEGER CHECK (row_count >= 0);
CREATE UNIQUE INDEX integration_ingestion_previews_scope_identity ON integration_ingestion_previews(organization_id, id);

CREATE TABLE integration_ingestion_preview_receipts (
  preview_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  receipt_id UUID NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  PRIMARY KEY (preview_id, receipt_id),
  UNIQUE (preview_id, ordinal),
  FOREIGN KEY (organization_id, preview_id) REFERENCES integration_ingestion_previews(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, receipt_id) REFERENCES integration_receipts(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX integration_ingestion_preview_receipts_receipt ON integration_ingestion_preview_receipts(organization_id, receipt_id);

ALTER TABLE integration_ingestion_jobs ADD COLUMN next_row_index INTEGER NOT NULL DEFAULT 0 CHECK (next_row_index >= 0);
ALTER TABLE integration_ingestion_jobs ADD COLUMN expansion_complete BOOLEAN NOT NULL DEFAULT TRUE;
