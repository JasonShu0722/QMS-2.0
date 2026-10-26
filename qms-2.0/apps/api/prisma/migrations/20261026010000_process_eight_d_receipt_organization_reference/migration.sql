ALTER TABLE process_eight_d_receipts
  ADD CONSTRAINT process_eight_d_receipts_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;
