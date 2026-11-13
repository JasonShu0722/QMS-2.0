ALTER TABLE integration_ingestion_items
  ADD COLUMN error_field VARCHAR(200),
  ADD COLUMN duplicate_of_item_id UUID REFERENCES integration_ingestion_items(id) ON DELETE SET NULL,
  ADD COLUMN source_received_at TIMESTAMPTZ(3);

UPDATE integration_ingestion_items item SET source_received_at=receipt.received_at
FROM integration_receipts receipt
WHERE receipt.organization_id=item.organization_id AND receipt.id=item.receipt_id;

CREATE INDEX integration_ingestion_pending_difference
ON integration_ingestion_items(organization_id,target_id,target_version)
WHERE status='AWAITING_CONFIRMATION';
