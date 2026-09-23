CREATE TABLE supplier_portal_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key varchar(200) NOT NULL,
  supplier_organization_id uuid NOT NULL,
  recipient_user_id uuid NOT NULL,
  owner_organization_id uuid NOT NULL,
  workflow_task_id uuid NOT NULL,
  supplier_problem_id uuid NOT NULL,
  kind varchar(32) NOT NULL,
  rule_version integer,
  subject varchar(255),
  body text NOT NULL,
  read_at timestamptz(3),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT supplier_portal_notifications_recipient_fkey
    FOREIGN KEY (supplier_organization_id, recipient_user_id) REFERENCES users(organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT supplier_portal_notifications_task_fkey
    FOREIGN KEY (owner_organization_id, workflow_task_id) REFERENCES workflow_tasks(organization_id, id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT supplier_portal_notifications_problem_fkey
    FOREIGN KEY (supplier_problem_id) REFERENCES supplier_quality_problems(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT supplier_portal_notifications_kind_check CHECK (kind IN ('TASK_ASSIGNED', 'TASK_REMINDER')),
  CONSTRAINT supplier_portal_notifications_version_check CHECK (version > 0)
);

CREATE UNIQUE INDEX supplier_portal_notifications_event_recipient_key
  ON supplier_portal_notifications(event_key, recipient_user_id);
CREATE INDEX supplier_portal_notifications_recipient_created_idx
  ON supplier_portal_notifications(supplier_organization_id, recipient_user_id, created_at DESC);
CREATE INDEX supplier_portal_notifications_task_idx
  ON supplier_portal_notifications(owner_organization_id, workflow_task_id);
CREATE INDEX supplier_portal_notifications_problem_idx
  ON supplier_portal_notifications(supplier_problem_id);
