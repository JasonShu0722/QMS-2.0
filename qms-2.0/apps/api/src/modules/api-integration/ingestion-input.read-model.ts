import { Prisma } from '../../generated/prisma/client.js';

export const ingestionInputProtected = Prisma.sql`(
  EXISTS(SELECT 1 FROM integration_ingestion_preview_receipts snapshot JOIN integration_ingestion_previews preview ON preview.id=snapshot.preview_id
    WHERE snapshot.organization_id=r.organization_id AND snapshot.receipt_id=r.id AND preview.expires_at>clock_timestamp())
  OR EXISTS(SELECT 1 FROM integration_ingestion_previews preview WHERE preview.organization_id=r.organization_id AND preview.expires_at>clock_timestamp()
    AND preview.selections @> jsonb_build_array(jsonb_build_object('receiptId',r.id::text)))
  OR EXISTS(SELECT 1 FROM integration_ingestion_jobs j WHERE j.organization_id=r.organization_id AND j.receipt_id=r.id
    AND ((NOT j.expansion_complete AND j.status IN ('PENDING','PAUSED','BLOCKED'))
      OR EXISTS(SELECT 1 FROM integration_ingestion_items i WHERE i.job_id=j.id AND i.status IN ('PENDING','AWAITING_CONFIRMATION','PROCESSING_FAILED'))))
  OR EXISTS(SELECT 1 FROM integration_ingestion_jobs parent JOIN integration_ingestion_preview_receipts snapshot ON snapshot.preview_id=parent.planning_preview_id AND snapshot.organization_id=parent.organization_id
    WHERE parent.organization_id=r.organization_id AND parent.parent_job_id IS NULL AND parent.status IN ('PENDING','PAUSED','BLOCKED') AND snapshot.receipt_id=r.id)
)`;
