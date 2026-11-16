CREATE INDEX integration_ingestion_items_received_row_target
ON integration_ingestion_items(organization_id, receipt_id, row_index, target_id)
WHERE target_id IS NOT NULL;
