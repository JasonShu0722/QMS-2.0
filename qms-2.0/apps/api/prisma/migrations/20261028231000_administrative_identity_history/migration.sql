CREATE TABLE user_organization_history (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id, user_id)
);
INSERT INTO user_organization_history (organization_id,user_id) SELECT organization_id,id FROM users;

CREATE FUNCTION remember_user_organization_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO user_organization_history (organization_id,user_id) VALUES (NEW.organization_id,NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER users_organization_history AFTER INSERT OR UPDATE OF organization_id ON users
  FOR EACH ROW EXECUTE FUNCTION remember_user_organization_scope();
CREATE FUNCTION preserve_user_organization_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- A genuinely unreferenced, never-deleted account may still use the pre-existing physical lifecycle.
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'ADMIN_IDENTITY_SCOPE_HISTORY_IMMUTABLE' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER user_organization_history_immutable BEFORE UPDATE OR DELETE ON user_organization_history
  FOR EACH ROW EXECUTE FUNCTION preserve_user_organization_history();

-- Historical references retain their original tenant after an explicitly authorized current-account reconfiguration.
ALTER TABLE "announcement_recipients" DROP CONSTRAINT "announcement_recipients_organization_id_user_id_fkey";
ALTER TABLE "announcement_recipients" ADD CONSTRAINT "announcement_recipients_organization_id_user_id_fkey" FOREIGN KEY (organization_id, user_id) REFERENCES user_organization_history(organization_id, user_id) ON DELETE RESTRICT;
ALTER TABLE "approval_signatures" DROP CONSTRAINT "approval_signatures_organization_id_signer_user_id_fkey";
ALTER TABLE "approval_signatures" ADD CONSTRAINT "approval_signatures_organization_id_signer_user_id_fkey" FOREIGN KEY (organization_id, signer_user_id) REFERENCES user_organization_history(organization_id, user_id) ON DELETE RESTRICT;
ALTER TABLE "closure_notifications" DROP CONSTRAINT "closure_notifications_organization_id_recipient_user_id_fkey";
ALTER TABLE "closure_notifications" ADD CONSTRAINT "closure_notifications_organization_id_recipient_user_id_fkey" FOREIGN KEY (organization_id, recipient_user_id) REFERENCES user_organization_history(organization_id, user_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "customer_complaint_analyses" DROP CONSTRAINT "customer_complaint_analyses_organization_id_assignee_user__fkey";
ALTER TABLE "customer_complaint_analyses" ADD CONSTRAINT "customer_complaint_analyses_organization_id_assignee_user__fkey" FOREIGN KEY (organization_id, assignee_user_id) REFERENCES user_organization_history(organization_id, user_id) ON DELETE RESTRICT;
ALTER TABLE "customer_complaint_analyses" DROP CONSTRAINT "customer_complaint_analyses_organization_id_updated_by_use_fkey";
ALTER TABLE "customer_complaint_analyses" ADD CONSTRAINT "customer_complaint_analyses_organization_id_updated_by_use_fkey" FOREIGN KEY (organization_id, updated_by_user_id) REFERENCES user_organization_history(organization_id, user_id) ON DELETE RESTRICT;
ALTER TABLE "customer_eight_d_notifications" DROP CONSTRAINT "customer_eight_d_notification_organization_id_recipient_us_fkey";
ALTER TABLE "customer_eight_d_notifications" ADD CONSTRAINT "customer_eight_d_notification_organization_id_recipient_us_fkey" FOREIGN KEY (organization_id, recipient_user_id) REFERENCES user_organization_history(organization_id, user_id) ON DELETE RESTRICT;
ALTER TABLE "customer_quality_complaint_events" DROP CONSTRAINT "customer_quality_complaint_ev_organization_id_owner_user_i_fkey";
ALTER TABLE "customer_quality_complaint_events" ADD CONSTRAINT "customer_quality_complaint_ev_organization_id_owner_user_i_fkey" FOREIGN KEY (organization_id, owner_user_id) REFERENCES user_organization_history(organization_id, user_id) ON DELETE RESTRICT;
ALTER TABLE "customer_quality_complaints" DROP CONSTRAINT "customer_complaint_engineer_scope_fk";
ALTER TABLE "customer_quality_complaints" ADD CONSTRAINT "customer_complaint_engineer_scope_fk" FOREIGN KEY (organization_id, quality_engineer_id) REFERENCES user_organization_history(organization_id, user_id) ON DELETE RESTRICT;
ALTER TABLE "customer_quality_complaints" DROP CONSTRAINT "customer_quality_complaints_owner_fk";
ALTER TABLE "customer_quality_complaints" ADD CONSTRAINT "customer_quality_complaints_owner_fk" FOREIGN KEY (organization_id, owner_user_id) REFERENCES user_organization_history(organization_id, user_id) ON DELETE RESTRICT;
ALTER TABLE "new_product_eight_d_notifications" DROP CONSTRAINT "new_product_eight_d_notificat_organization_id_recipient_us_fkey";
ALTER TABLE "new_product_eight_d_notifications" ADD CONSTRAINT "new_product_eight_d_notificat_organization_id_recipient_us_fkey" FOREIGN KEY (organization_id, recipient_user_id) REFERENCES user_organization_history(organization_id, user_id) ON DELETE RESTRICT;
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_organization_id_recipient_user_id_fkey";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_recipient_user_id_fkey" FOREIGN KEY (organization_id, recipient_user_id) REFERENCES user_organization_history(organization_id, user_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "problem_indexes" DROP CONSTRAINT "problem_indexes_organization_id_owner_id_fkey";
ALTER TABLE "problem_indexes" ADD CONSTRAINT "problem_indexes_organization_id_owner_id_fkey" FOREIGN KEY (organization_id, owner_id) REFERENCES user_organization_history(organization_id, user_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "process_eight_d_notifications" DROP CONSTRAINT "process_eight_d_notifications_organization_id_recipient_us_fkey";
ALTER TABLE "process_eight_d_notifications" ADD CONSTRAINT "process_eight_d_notifications_organization_id_recipient_us_fkey" FOREIGN KEY (organization_id, recipient_user_id) REFERENCES user_organization_history(organization_id, user_id) ON DELETE RESTRICT;
ALTER TABLE "supplier_copy_previews" DROP CONSTRAINT "supplier_copy_previews_organization_id_actor_user_id_fkey";
ALTER TABLE "supplier_copy_previews" ADD CONSTRAINT "supplier_copy_previews_organization_id_actor_user_id_fkey" FOREIGN KEY (organization_id, actor_user_id) REFERENCES user_organization_history(organization_id, user_id) ON DELETE RESTRICT;
ALTER TABLE "supplier_eight_d_deadline_receipts" DROP CONSTRAINT "supplier_eight_d_deadline_rec_actor_organization_id_actor__fkey";
ALTER TABLE "supplier_eight_d_deadline_receipts" ADD CONSTRAINT "supplier_eight_d_deadline_rec_actor_organization_id_actor__fkey" FOREIGN KEY (actor_organization_id, actor_user_id) REFERENCES user_organization_history(organization_id, user_id);
ALTER TABLE "supplier_eight_d_deadline_requests" DROP CONSTRAINT "supplier_eight_d_deadline_req_applicant_organization_id_ap_fkey";
ALTER TABLE "supplier_eight_d_deadline_requests" ADD CONSTRAINT "supplier_eight_d_deadline_req_applicant_organization_id_ap_fkey" FOREIGN KEY (applicant_organization_id, applicant_user_id) REFERENCES user_organization_history(organization_id, user_id);
ALTER TABLE "supplier_eight_d_deadline_requests" DROP CONSTRAINT "supplier_eight_d_deadline_req_organization_id_manager_user_fkey";
ALTER TABLE "supplier_eight_d_deadline_requests" ADD CONSTRAINT "supplier_eight_d_deadline_req_organization_id_manager_user_fkey" FOREIGN KEY (organization_id, manager_user_id) REFERENCES user_organization_history(organization_id, user_id);
ALTER TABLE "supplier_eight_d_disclosure_previews" DROP CONSTRAINT "supplier_eight_d_disclosure_p_organization_id_actor_user_i_fkey";
ALTER TABLE "supplier_eight_d_disclosure_previews" ADD CONSTRAINT "supplier_eight_d_disclosure_p_organization_id_actor_user_i_fkey" FOREIGN KEY (organization_id, actor_user_id) REFERENCES user_organization_history(organization_id, user_id) ON DELETE RESTRICT;
ALTER TABLE "supplier_eight_d_receipts" DROP CONSTRAINT "supplier_eight_d_receipts_actor_organization_id_actor_user_fkey";
ALTER TABLE "supplier_eight_d_receipts" ADD CONSTRAINT "supplier_eight_d_receipts_actor_organization_id_actor_user_fkey" FOREIGN KEY (actor_organization_id, actor_user_id) REFERENCES user_organization_history(organization_id, user_id) ON DELETE RESTRICT;
ALTER TABLE "supplier_eight_d_submission_origins" DROP CONSTRAINT "supplier_eight_d_submission_o_submitted_organization_id_su_fkey";
ALTER TABLE "supplier_eight_d_submission_origins" ADD CONSTRAINT "supplier_eight_d_submission_o_submitted_organization_id_su_fkey" FOREIGN KEY (submitted_organization_id, submitted_by) REFERENCES user_organization_history(organization_id, user_id) ON DELETE RESTRICT;
ALTER TABLE "supplier_eight_d_supplements" DROP CONSTRAINT "supplier_eight_d_supplements_organization_id_updated_by_fkey";
ALTER TABLE "supplier_eight_d_supplements" ADD CONSTRAINT "supplier_eight_d_supplements_organization_id_updated_by_fkey" FOREIGN KEY (organization_id, updated_by) REFERENCES user_organization_history(organization_id, user_id) ON DELETE RESTRICT;
ALTER TABLE "supplier_portal_notifications" DROP CONSTRAINT "supplier_portal_notifications_recipient_fkey";
ALTER TABLE "supplier_portal_notifications" ADD CONSTRAINT "supplier_portal_notifications_recipient_fkey" FOREIGN KEY (supplier_organization_id, recipient_user_id) REFERENCES user_organization_history(organization_id, user_id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "user_positions" DROP CONSTRAINT "user_positions_organization_id_user_id_fkey";
ALTER TABLE "user_positions" ADD CONSTRAINT "user_positions_organization_id_user_id_fkey" FOREIGN KEY (organization_id, user_id) REFERENCES user_organization_history(organization_id, user_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "user_signatures" DROP CONSTRAINT "user_signatures_organization_id_user_id_fkey";
ALTER TABLE "user_signatures" ADD CONSTRAINT "user_signatures_organization_id_user_id_fkey" FOREIGN KEY (organization_id, user_id) REFERENCES user_organization_history(organization_id, user_id) ON DELETE RESTRICT;
ALTER TABLE "workflow_closure_duties" DROP CONSTRAINT "workflow_closure_duties_organization_id_decided_by_fkey";
ALTER TABLE "workflow_closure_duties" ADD CONSTRAINT "workflow_closure_duties_organization_id_decided_by_fkey" FOREIGN KEY (organization_id, decided_by) REFERENCES user_organization_history(organization_id, user_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "workflow_closure_duties" DROP CONSTRAINT "workflow_closure_duties_organization_id_user_id_fkey";
ALTER TABLE "workflow_closure_duties" ADD CONSTRAINT "workflow_closure_duties_organization_id_user_id_fkey" FOREIGN KEY (organization_id, user_id) REFERENCES user_organization_history(organization_id, user_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "workflow_closure_receipts" DROP CONSTRAINT "workflow_closure_receipts_organization_id_actor_user_id_fkey";
ALTER TABLE "workflow_closure_receipts" ADD CONSTRAINT "workflow_closure_receipts_organization_id_actor_user_id_fkey" FOREIGN KEY (organization_id, actor_user_id) REFERENCES user_organization_history(organization_id, user_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE "workflow_closure_rounds" DROP CONSTRAINT "workflow_closure_creator_identity_fkey";
ALTER TABLE "workflow_closure_rounds" ADD CONSTRAINT "workflow_closure_creator_identity_fkey" FOREIGN KEY (creator_organization_id, created_by) REFERENCES user_organization_history(organization_id, user_id) ON DELETE RESTRICT;
ALTER TABLE "workflow_deadline_extension_receipts" DROP CONSTRAINT "workflow_deadline_extension_r_organization_id_actor_user_i_fkey";
ALTER TABLE "workflow_deadline_extension_receipts" ADD CONSTRAINT "workflow_deadline_extension_r_organization_id_actor_user_i_fkey" FOREIGN KEY (organization_id, actor_user_id) REFERENCES user_organization_history(organization_id, user_id) ON DELETE RESTRICT;
ALTER TABLE "workflow_deadline_extensions" DROP CONSTRAINT "workflow_deadline_extensions_organization_id_applicant_use_fkey";
ALTER TABLE "workflow_deadline_extensions" ADD CONSTRAINT "workflow_deadline_extensions_organization_id_applicant_use_fkey" FOREIGN KEY (organization_id, applicant_user_id) REFERENCES user_organization_history(organization_id, user_id) ON DELETE RESTRICT;
ALTER TABLE "workflow_tasks" DROP CONSTRAINT "workflow_tasks_organization_id_assignee_user_id_fkey";
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_organization_id_assignee_user_id_fkey" FOREIGN KEY (organization_id, assignee_user_id) REFERENCES user_organization_history(organization_id, user_id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE user_positions ADD CONSTRAINT user_positions_current_identity_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE supplier_portal_notifications ADD CONSTRAINT supplier_portal_notifications_current_identity_fkey FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION prevent_administrative_identity_revival() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'ADMIN_DELETED_IDENTITY_IMMUTABLE' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'ADMIN_IDENTITY_UUID_IMMUTABLE' USING ERRCODE = '23514';
    END IF;
    IF OLD.deleted_at IS NOT NULL AND (
      NEW.deleted_at IS DISTINCT FROM OLD.deleted_at OR
      (to_jsonb(NEW)->'organization_id') IS DISTINCT FROM (to_jsonb(OLD)->'organization_id') OR
      (to_jsonb(NEW)->'account_type') IS DISTINCT FROM (to_jsonb(OLD)->'account_type') OR
      (to_jsonb(NEW)->'type') IS DISTINCT FROM (to_jsonb(OLD)->'type') OR
      (to_jsonb(NEW)->'department_id') IS DISTINCT FROM (to_jsonb(OLD)->'department_id') OR
      (to_jsonb(NEW)->'parent_id') IS DISTINCT FROM (to_jsonb(OLD)->'parent_id')
    ) THEN
      RAISE EXCEPTION 'ADMIN_DELETED_IDENTITY_IMMUTABLE' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF (NEW.deleted_at IS NOT NULL OR NEW.configuration_required) AND NEW.status::text <> 'DISABLED' THEN
    RAISE EXCEPTION 'ADMIN_IDENTITY_NOT_CONFIGURED' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- New or reassigned facts still require current membership; unchanged historical references remain readable.
CREATE FUNCTION enforce_current_user_reference_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  scope_id uuid;
  target_user_id uuid;
  current_scope_id uuid;
BEGIN
  IF TG_OP = $q$UPDATE$q$ AND
    (to_jsonb(NEW)->TG_ARGV[0]) IS NOT DISTINCT FROM (to_jsonb(OLD)->TG_ARGV[0]) AND
    (to_jsonb(NEW)->TG_ARGV[1]) IS NOT DISTINCT FROM (to_jsonb(OLD)->TG_ARGV[1]) THEN RETURN NEW; END IF;
  scope_id := (to_jsonb(NEW)->>TG_ARGV[0])::uuid;
  target_user_id := (to_jsonb(NEW)->>TG_ARGV[1])::uuid;
  IF scope_id IS NULL OR target_user_id IS NULL THEN RETURN NEW; END IF;
  SELECT organization_id INTO current_scope_id FROM users WHERE id=target_user_id FOR SHARE;
  IF current_scope_id IS NOT NULL AND current_scope_id IS DISTINCT FROM scope_id THEN
    RAISE EXCEPTION $q$ADMIN_USER_CURRENT_SCOPE_MISMATCH$q$ USING ERRCODE=$q$23514$q$;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "admin_current_user_b697e87167f3a1c41d3e73f8" BEFORE INSERT OR UPDATE OF "organization_id","user_id" ON "announcement_recipients"
  FOR EACH ROW EXECUTE FUNCTION enforce_current_user_reference_scope($q$organization_id$q$,$q$user_id$q$);
CREATE TRIGGER "admin_current_user_0f498ebed75c9a74e64ecc37" BEFORE INSERT OR UPDATE OF "organization_id","signer_user_id" ON "approval_signatures"
  FOR EACH ROW EXECUTE FUNCTION enforce_current_user_reference_scope($q$organization_id$q$,$q$signer_user_id$q$);
CREATE TRIGGER "admin_current_user_36a6d24e86c54666a5b3f33e" BEFORE INSERT OR UPDATE OF "organization_id","recipient_user_id" ON "closure_notifications"
  FOR EACH ROW EXECUTE FUNCTION enforce_current_user_reference_scope($q$organization_id$q$,$q$recipient_user_id$q$);
CREATE TRIGGER "admin_current_user_26ada0a186146edacdf53bf6" BEFORE INSERT OR UPDATE OF "organization_id","assignee_user_id" ON "customer_complaint_analyses"
  FOR EACH ROW EXECUTE FUNCTION enforce_current_user_reference_scope($q$organization_id$q$,$q$assignee_user_id$q$);
CREATE TRIGGER "admin_current_user_cc12fbbf318515ba46d12ea1" BEFORE INSERT OR UPDATE OF "organization_id","updated_by_user_id" ON "customer_complaint_analyses"
  FOR EACH ROW EXECUTE FUNCTION enforce_current_user_reference_scope($q$organization_id$q$,$q$updated_by_user_id$q$);
CREATE TRIGGER "admin_current_user_2e78d85adf7096924e4618b1" BEFORE INSERT OR UPDATE OF "organization_id","recipient_user_id" ON "customer_eight_d_notifications"
  FOR EACH ROW EXECUTE FUNCTION enforce_current_user_reference_scope($q$organization_id$q$,$q$recipient_user_id$q$);
CREATE TRIGGER "admin_current_user_a5663a3b1c14d4c75d942153" BEFORE INSERT OR UPDATE OF "organization_id","owner_user_id" ON "customer_quality_complaint_events"
  FOR EACH ROW EXECUTE FUNCTION enforce_current_user_reference_scope($q$organization_id$q$,$q$owner_user_id$q$);
CREATE TRIGGER "admin_current_user_cc78290ca8ed05745912b91d" BEFORE INSERT OR UPDATE OF "organization_id","quality_engineer_id" ON "customer_quality_complaints"
  FOR EACH ROW EXECUTE FUNCTION enforce_current_user_reference_scope($q$organization_id$q$,$q$quality_engineer_id$q$);
CREATE TRIGGER "admin_current_user_a2635b692450d0aab4f2d883" BEFORE INSERT OR UPDATE OF "organization_id","owner_user_id" ON "customer_quality_complaints"
  FOR EACH ROW EXECUTE FUNCTION enforce_current_user_reference_scope($q$organization_id$q$,$q$owner_user_id$q$);
CREATE TRIGGER "admin_current_user_dac7916a1fb53a600079432d" BEFORE INSERT OR UPDATE OF "organization_id","recipient_user_id" ON "new_product_eight_d_notifications"
  FOR EACH ROW EXECUTE FUNCTION enforce_current_user_reference_scope($q$organization_id$q$,$q$recipient_user_id$q$);
CREATE TRIGGER "admin_current_user_596e0c670aa675814be544b3" BEFORE INSERT OR UPDATE OF "organization_id","recipient_user_id" ON "notifications"
  FOR EACH ROW EXECUTE FUNCTION enforce_current_user_reference_scope($q$organization_id$q$,$q$recipient_user_id$q$);
CREATE TRIGGER "admin_current_user_051ac7ff595f42b9a750c8fa" BEFORE INSERT OR UPDATE OF "organization_id","owner_id" ON "problem_indexes"
  FOR EACH ROW EXECUTE FUNCTION enforce_current_user_reference_scope($q$organization_id$q$,$q$owner_id$q$);
CREATE TRIGGER "admin_current_user_797c2fd3086353d33ff9aa1e" BEFORE INSERT OR UPDATE OF "organization_id","recipient_user_id" ON "process_eight_d_notifications"
  FOR EACH ROW EXECUTE FUNCTION enforce_current_user_reference_scope($q$organization_id$q$,$q$recipient_user_id$q$);
CREATE TRIGGER "admin_current_user_73080bea0217883878ede5cd" BEFORE INSERT OR UPDATE OF "organization_id","actor_user_id" ON "supplier_copy_previews"
  FOR EACH ROW EXECUTE FUNCTION enforce_current_user_reference_scope($q$organization_id$q$,$q$actor_user_id$q$);
CREATE TRIGGER "admin_current_user_0fcbcdff95e5fcec95407984" BEFORE INSERT OR UPDATE OF "actor_organization_id","actor_user_id" ON "supplier_eight_d_deadline_receipts"
  FOR EACH ROW EXECUTE FUNCTION enforce_current_user_reference_scope($q$actor_organization_id$q$,$q$actor_user_id$q$);
CREATE TRIGGER "admin_current_user_c42477c98da0882dc0348066" BEFORE INSERT OR UPDATE OF "applicant_organization_id","applicant_user_id" ON "supplier_eight_d_deadline_requests"
  FOR EACH ROW EXECUTE FUNCTION enforce_current_user_reference_scope($q$applicant_organization_id$q$,$q$applicant_user_id$q$);
CREATE TRIGGER "admin_current_user_db7bda14dddeca5826102a95" BEFORE INSERT OR UPDATE OF "organization_id","manager_user_id" ON "supplier_eight_d_deadline_requests"
  FOR EACH ROW EXECUTE FUNCTION enforce_current_user_reference_scope($q$organization_id$q$,$q$manager_user_id$q$);
CREATE TRIGGER "admin_current_user_088266d85035549a780ed4de" BEFORE INSERT OR UPDATE OF "organization_id","actor_user_id" ON "supplier_eight_d_disclosure_previews"
  FOR EACH ROW EXECUTE FUNCTION enforce_current_user_reference_scope($q$organization_id$q$,$q$actor_user_id$q$);
CREATE TRIGGER "admin_current_user_787e2bbfe2f5a3d565ed8ba7" BEFORE INSERT OR UPDATE OF "actor_organization_id","actor_user_id" ON "supplier_eight_d_receipts"
  FOR EACH ROW EXECUTE FUNCTION enforce_current_user_reference_scope($q$actor_organization_id$q$,$q$actor_user_id$q$);
CREATE TRIGGER "admin_current_user_2ed59b38f0468a4ad7b4232b" BEFORE INSERT OR UPDATE OF "submitted_organization_id","submitted_by" ON "supplier_eight_d_submission_origins"
  FOR EACH ROW EXECUTE FUNCTION enforce_current_user_reference_scope($q$submitted_organization_id$q$,$q$submitted_by$q$);
CREATE TRIGGER "admin_current_user_29b3a7ade7080250ee4ce322" BEFORE INSERT OR UPDATE OF "organization_id","updated_by" ON "supplier_eight_d_supplements"
  FOR EACH ROW EXECUTE FUNCTION enforce_current_user_reference_scope($q$organization_id$q$,$q$updated_by$q$);
CREATE TRIGGER "admin_current_user_6d22841f8bb3b405bd3dc369" BEFORE INSERT OR UPDATE OF "supplier_organization_id","recipient_user_id" ON "supplier_portal_notifications"
  FOR EACH ROW EXECUTE FUNCTION enforce_current_user_reference_scope($q$supplier_organization_id$q$,$q$recipient_user_id$q$);
CREATE TRIGGER "admin_current_user_2c5c3da0596f8fdeb79f6bb7" BEFORE INSERT OR UPDATE OF "organization_id","user_id" ON "user_positions"
  FOR EACH ROW EXECUTE FUNCTION enforce_current_user_reference_scope($q$organization_id$q$,$q$user_id$q$);
CREATE TRIGGER "admin_current_user_b4100c146f5bac001676d473" BEFORE INSERT OR UPDATE OF "organization_id","user_id" ON "user_signatures"
  FOR EACH ROW EXECUTE FUNCTION enforce_current_user_reference_scope($q$organization_id$q$,$q$user_id$q$);
CREATE TRIGGER "admin_current_user_01ae18b484899ab54076b205" BEFORE INSERT OR UPDATE OF "organization_id","decided_by" ON "workflow_closure_duties"
  FOR EACH ROW EXECUTE FUNCTION enforce_current_user_reference_scope($q$organization_id$q$,$q$decided_by$q$);
CREATE TRIGGER "admin_current_user_660ed8f418ecb2aa7a715c40" BEFORE INSERT OR UPDATE OF "organization_id","user_id" ON "workflow_closure_duties"
  FOR EACH ROW EXECUTE FUNCTION enforce_current_user_reference_scope($q$organization_id$q$,$q$user_id$q$);
CREATE TRIGGER "admin_current_user_9de48de98dd97b597a7edbfe" BEFORE INSERT OR UPDATE OF "organization_id","actor_user_id" ON "workflow_closure_receipts"
  FOR EACH ROW EXECUTE FUNCTION enforce_current_user_reference_scope($q$organization_id$q$,$q$actor_user_id$q$);
CREATE TRIGGER "admin_current_user_7e1e1314b7e590e8b4de4a5e" BEFORE INSERT OR UPDATE OF "creator_organization_id","created_by" ON "workflow_closure_rounds"
  FOR EACH ROW EXECUTE FUNCTION enforce_current_user_reference_scope($q$creator_organization_id$q$,$q$created_by$q$);
CREATE TRIGGER "admin_current_user_52a79b7087d2d8bfdc029d47" BEFORE INSERT OR UPDATE OF "organization_id","actor_user_id" ON "workflow_deadline_extension_receipts"
  FOR EACH ROW EXECUTE FUNCTION enforce_current_user_reference_scope($q$organization_id$q$,$q$actor_user_id$q$);
CREATE TRIGGER "admin_current_user_f3d29588bb7f886d891eb97b" BEFORE INSERT OR UPDATE OF "organization_id","applicant_user_id" ON "workflow_deadline_extensions"
  FOR EACH ROW EXECUTE FUNCTION enforce_current_user_reference_scope($q$organization_id$q$,$q$applicant_user_id$q$);
CREATE TRIGGER "admin_current_user_581c2e53c5dce0380e050148" BEFORE INSERT OR UPDATE OF "organization_id","assignee_user_id" ON "workflow_tasks"
  FOR EACH ROW EXECUTE FUNCTION enforce_current_user_reference_scope($q$organization_id$q$,$q$assignee_user_id$q$);

CREATE FUNCTION preserve_ordinary_user_transfer_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id THEN RETURN NEW; END IF;
  IF current_setting($q$qms.administrative_reconfiguration$q$,true)=$q$approved$q$
    AND OLD.configuration_required AND OLD.deleted_at IS NULL AND NOT NEW.configuration_required THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM "announcement_recipients" WHERE "organization_id"=OLD.organization_id AND "user_id"=OLD.id)
    OR EXISTS (SELECT 1 FROM "approval_signatures" WHERE "organization_id"=OLD.organization_id AND "signer_user_id"=OLD.id)
    OR EXISTS (SELECT 1 FROM "closure_notifications" WHERE "organization_id"=OLD.organization_id AND "recipient_user_id"=OLD.id)
    OR EXISTS (SELECT 1 FROM "customer_complaint_analyses" WHERE "organization_id"=OLD.organization_id AND "assignee_user_id"=OLD.id)
    OR EXISTS (SELECT 1 FROM "customer_complaint_analyses" WHERE "organization_id"=OLD.organization_id AND "updated_by_user_id"=OLD.id)
    OR EXISTS (SELECT 1 FROM "customer_eight_d_notifications" WHERE "organization_id"=OLD.organization_id AND "recipient_user_id"=OLD.id)
    OR EXISTS (SELECT 1 FROM "customer_quality_complaint_events" WHERE "organization_id"=OLD.organization_id AND "owner_user_id"=OLD.id)
    OR EXISTS (SELECT 1 FROM "customer_quality_complaints" WHERE "organization_id"=OLD.organization_id AND "quality_engineer_id"=OLD.id)
    OR EXISTS (SELECT 1 FROM "customer_quality_complaints" WHERE "organization_id"=OLD.organization_id AND "owner_user_id"=OLD.id)
    OR EXISTS (SELECT 1 FROM "new_product_eight_d_notifications" WHERE "organization_id"=OLD.organization_id AND "recipient_user_id"=OLD.id)
    OR EXISTS (SELECT 1 FROM "notifications" WHERE "organization_id"=OLD.organization_id AND "recipient_user_id"=OLD.id)
    OR EXISTS (SELECT 1 FROM "problem_indexes" WHERE "organization_id"=OLD.organization_id AND "owner_id"=OLD.id)
    OR EXISTS (SELECT 1 FROM "process_eight_d_notifications" WHERE "organization_id"=OLD.organization_id AND "recipient_user_id"=OLD.id)
    OR EXISTS (SELECT 1 FROM "supplier_copy_previews" WHERE "organization_id"=OLD.organization_id AND "actor_user_id"=OLD.id)
    OR EXISTS (SELECT 1 FROM "supplier_eight_d_deadline_receipts" WHERE "actor_organization_id"=OLD.organization_id AND "actor_user_id"=OLD.id)
    OR EXISTS (SELECT 1 FROM "supplier_eight_d_deadline_requests" WHERE "applicant_organization_id"=OLD.organization_id AND "applicant_user_id"=OLD.id)
    OR EXISTS (SELECT 1 FROM "supplier_eight_d_deadline_requests" WHERE "organization_id"=OLD.organization_id AND "manager_user_id"=OLD.id)
    OR EXISTS (SELECT 1 FROM "supplier_eight_d_disclosure_previews" WHERE "organization_id"=OLD.organization_id AND "actor_user_id"=OLD.id)
    OR EXISTS (SELECT 1 FROM "supplier_eight_d_receipts" WHERE "actor_organization_id"=OLD.organization_id AND "actor_user_id"=OLD.id)
    OR EXISTS (SELECT 1 FROM "supplier_eight_d_submission_origins" WHERE "submitted_organization_id"=OLD.organization_id AND "submitted_by"=OLD.id)
    OR EXISTS (SELECT 1 FROM "supplier_eight_d_supplements" WHERE "organization_id"=OLD.organization_id AND "updated_by"=OLD.id)
    OR EXISTS (SELECT 1 FROM "supplier_portal_notifications" WHERE "supplier_organization_id"=OLD.organization_id AND "recipient_user_id"=OLD.id)
    OR EXISTS (SELECT 1 FROM "user_positions" WHERE "organization_id"=OLD.organization_id AND "user_id"=OLD.id)
    OR EXISTS (SELECT 1 FROM "user_signatures" WHERE "organization_id"=OLD.organization_id AND "user_id"=OLD.id)
    OR EXISTS (SELECT 1 FROM "workflow_closure_duties" WHERE "organization_id"=OLD.organization_id AND "decided_by"=OLD.id)
    OR EXISTS (SELECT 1 FROM "workflow_closure_duties" WHERE "organization_id"=OLD.organization_id AND "user_id"=OLD.id)
    OR EXISTS (SELECT 1 FROM "workflow_closure_receipts" WHERE "organization_id"=OLD.organization_id AND "actor_user_id"=OLD.id)
    OR EXISTS (SELECT 1 FROM "workflow_closure_rounds" WHERE "creator_organization_id"=OLD.organization_id AND "created_by"=OLD.id)
    OR EXISTS (SELECT 1 FROM "workflow_deadline_extension_receipts" WHERE "organization_id"=OLD.organization_id AND "actor_user_id"=OLD.id)
    OR EXISTS (SELECT 1 FROM "workflow_deadline_extensions" WHERE "organization_id"=OLD.organization_id AND "applicant_user_id"=OLD.id)
    OR EXISTS (SELECT 1 FROM "workflow_tasks" WHERE "organization_id"=OLD.organization_id AND "assignee_user_id"=OLD.id) THEN
    RAISE EXCEPTION $q$ADMIN_USER_ORGANIZATION_IN_USE$q$ USING ERRCODE=$q$23503$q$;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER users_ordinary_transfer_policy BEFORE UPDATE OF organization_id ON users
  FOR EACH ROW EXECUTE FUNCTION preserve_ordinary_user_transfer_policy();
