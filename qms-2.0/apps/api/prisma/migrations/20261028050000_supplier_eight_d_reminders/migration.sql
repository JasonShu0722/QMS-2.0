CREATE TABLE supplier_eight_d_reminder_slots (
  event_key text PRIMARY KEY CHECK (length(event_key) <= 256),
  organization_id uuid NOT NULL,
  supplier_problem_id uuid NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id, supplier_problem_id)
    REFERENCES supplier_eight_d_controls(organization_id, supplier_problem_id) ON DELETE RESTRICT
);

CREATE TABLE supplier_eight_d_notifications (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  supplier_problem_id uuid NOT NULL,
  recipient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  event_key text NOT NULL REFERENCES outbox_events(event_key) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('HANDLING_REMINDER', 'CLOSURE_REMINDER', 'EXTENSION_PENDING')),
  subject varchar(200) NOT NULL,
  body varchar(2000) NOT NULL,
  context jsonb NOT NULL CHECK (jsonb_typeof(context) = 'object' AND octet_length(context::text) <= 8192),
  delivered_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (event_key, recipient_user_id),
  FOREIGN KEY (organization_id, supplier_problem_id)
    REFERENCES supplier_eight_d_controls(organization_id, supplier_problem_id) ON DELETE RESTRICT
);
CREATE INDEX supplier_eight_d_notifications_inbox
  ON supplier_eight_d_notifications(organization_id, supplier_problem_id, recipient_user_id, delivered_at DESC, id DESC);

CREATE FUNCTION supplier_eight_d_notification_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM outbox_events e
    JOIN supplier_eight_d_controls c ON c.organization_id = NEW.organization_id AND c.supplier_problem_id = NEW.supplier_problem_id
    JOIN supplier_quality_problems s ON s.id = c.supplier_problem_id AND s.owner_organization_id = c.organization_id
    JOIN users u ON u.id = NEW.recipient_user_id
    WHERE e.event_key = NEW.event_key AND e.event_type = 'SUPPLIER_EIGHT_D_REMINDER_DUE'
      AND e.aggregate_type = 'SupplierEightDReminder' AND e.aggregate_id = NEW.supplier_problem_id::text
      AND e.payload->>'schemaVersion' = '1' AND e.payload->>'organizationId' = NEW.organization_id::text
      AND e.payload->>'supplierProblemId' = NEW.supplier_problem_id::text AND e.payload->>'problemId' = c.problem_index_id::text
      AND NEW.event_key = 'supplier-eight-d-reminder:' || NEW.supplier_problem_id::text || ':' || (NEW.context->>'fingerprint') || ':' || (NEW.context->>'slot')
      AND e.payload->>'fingerprint' = NEW.context->>'fingerprint' AND e.payload->>'slot' = NEW.context->>'slot'
      AND NEW.context->>'userId' = NEW.recipient_user_id::text AND NEW.context->>'kind' = NEW.kind
      AND ((u.account_type = 'INTERNAL' AND u.organization_id = NEW.organization_id)
        OR (u.account_type = 'SUPPLIER' AND u.organization_id = s.supplier_organization_id AND s.reply_mode = 'SUPPLIER' AND s.released_to_supplier_at IS NOT NULL))
  ) THEN RAISE EXCEPTION 'SUPPLIER_EIGHT_D_NOTIFICATION_SOURCE_INVALID' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER supplier_eight_d_notification_source_guard BEFORE INSERT OR UPDATE ON supplier_eight_d_notifications
  FOR EACH ROW EXECUTE FUNCTION supplier_eight_d_notification_source_guard();
CREATE TRIGGER supplier_eight_d_notification_immutable BEFORE UPDATE OR DELETE ON supplier_eight_d_notifications
  FOR EACH ROW EXECUTE FUNCTION supplier_eight_d_reject_history_mutation();
