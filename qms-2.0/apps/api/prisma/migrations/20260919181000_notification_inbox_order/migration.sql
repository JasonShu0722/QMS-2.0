CREATE INDEX notifications_organization_id_recipient_user_id_status_created_at_id_idx
  ON notifications (organization_id, recipient_user_id, status, created_at, id);
