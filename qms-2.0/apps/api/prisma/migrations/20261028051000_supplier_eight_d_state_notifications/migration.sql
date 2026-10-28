-- Append-only request. Do not change applied 129. No DTO/kind change is needed.
CREATE OR REPLACE FUNCTION supplier_eight_d_notification_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM outbox_events e
    JOIN supplier_eight_d_controls c ON c.organization_id = NEW.organization_id AND c.supplier_problem_id = NEW.supplier_problem_id
    JOIN supplier_quality_problems s ON s.id = c.supplier_problem_id AND s.owner_organization_id = c.organization_id
    JOIN users u ON u.id = NEW.recipient_user_id
    WHERE e.event_key = NEW.event_key
      AND e.payload->>'organizationId' = NEW.organization_id::text
      AND e.payload->>'supplierProblemId' = NEW.supplier_problem_id::text
      AND NEW.context->>'userId' = NEW.recipient_user_id::text AND NEW.context->>'kind' = NEW.kind
      AND NEW.context->>'fingerprint' ~ '^[0-9a-f]{64}$'
      AND ((u.account_type = 'INTERNAL' AND u.organization_id = NEW.organization_id)
        OR (u.account_type = 'SUPPLIER' AND u.organization_id = s.supplier_organization_id AND s.reply_mode = 'SUPPLIER' AND s.released_to_supplier_at IS NOT NULL))
      AND (
        (e.event_type = 'SUPPLIER_EIGHT_D_REMINDER_DUE' AND e.aggregate_type = 'SupplierEightDReminder'
          AND e.aggregate_id = NEW.supplier_problem_id::text AND e.payload->>'schemaVersion' = '1'
          AND e.payload->>'problemId' = c.problem_index_id::text
          AND NEW.event_key = 'supplier-eight-d-reminder:' || NEW.supplier_problem_id::text || ':' || (NEW.context->>'fingerprint') || ':' || (NEW.context->>'slot')
          AND e.payload->>'fingerprint' = NEW.context->>'fingerprint' AND e.payload->>'slot' = NEW.context->>'slot'
          AND NEW.context->>'projection' = 'PERIODIC')
        OR
        (e.event_type = 'SUPPLIER_EIGHT_D_CHANGED' AND e.aggregate_type = 'SupplierEightD'
          AND e.aggregate_id = NEW.supplier_problem_id::text
          AND (NOT (e.payload ? 'schemaVersion') OR e.payload->>'schemaVersion' = '1')
          AND e.payload->>'problemId' = c.problem_index_id::text
          AND e.payload->>'action' IN ('ISSUE', 'RELEASE', 'SUBMIT', 'RETURN', 'ANALYSIS_COMPLETE')
          AND NEW.event_key ~ ('^supplier-eight-d:' || NEW.supplier_problem_id::text || ':' || (e.payload->>'action') || ':[0-9a-f]{64}$')
          AND NEW.context->>'projection' = 'STATE_CHANGE' AND NEW.context->>'slot' = '0'
          AND NEW.kind IN ('HANDLING_REMINDER', 'CLOSURE_REMINDER'))
        OR
        (e.event_type = 'SUPPLIER_EIGHT_D_DEADLINE_CHANGED' AND e.aggregate_type = 'SupplierEightDDeadline'
          AND e.payload->>'schemaVersion' = '1' AND e.aggregate_id = e.payload->>'requestId'
          AND e.payload->>'requestId' = NEW.context->>'requestId' AND e.payload->>'version' = NEW.context->>'requestVersion'
          AND e.payload->>'status' IN ('QUALITY_PENDING', 'MANAGER_PENDING')
          AND e.payload->>'stage' = NEW.context->>'stage'
          AND NEW.event_key = 'supplier-eight-d-deadline:' || (e.payload->>'requestId') || ':v' || (e.payload->>'version')
          AND NEW.context->>'projection' = 'STATE_CHANGE' AND NEW.context->>'slot' = '0' AND NEW.kind = 'EXTENSION_PENDING'
          AND EXISTS (SELECT 1 FROM supplier_eight_d_deadline_requests r
            WHERE r.id::text = e.payload->>'requestId' AND r.organization_id = NEW.organization_id AND r.supplier_problem_id = NEW.supplier_problem_id))
      )
  ) THEN RAISE EXCEPTION 'SUPPLIER_EIGHT_D_NOTIFICATION_SOURCE_INVALID' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
