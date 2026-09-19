ALTER TABLE "problem_indexes"
  DROP CONSTRAINT "problem_indexes_organization_id_owner_id_fkey",
  ADD CONSTRAINT "problem_indexes_organization_id_owner_id_fkey"
    FOREIGN KEY ("organization_id", "owner_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "workflow_tasks"
  DROP CONSTRAINT "workflow_tasks_organization_id_assignee_user_id_fkey",
  ADD CONSTRAINT "workflow_tasks_organization_id_assignee_user_id_fkey"
    FOREIGN KEY ("organization_id", "assignee_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "notifications"
  DROP CONSTRAINT "notifications_organization_id_recipient_user_id_fkey",
  ADD CONSTRAINT "notifications_organization_id_recipient_user_id_fkey"
    FOREIGN KEY ("organization_id", "recipient_user_id") REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
