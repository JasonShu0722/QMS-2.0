ALTER TABLE workflow_tasks
  ADD COLUMN claimed_by_user_id UUID,
  ADD COLUMN claimed_at TIMESTAMPTZ(3),
  ADD CONSTRAINT workflow_tasks_claimed_by_user_id_fkey FOREIGN KEY (claimed_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  ADD CONSTRAINT workflow_tasks_claim_pair_check CHECK ((claimed_by_user_id IS NULL) = (claimed_at IS NULL));
CREATE INDEX workflow_tasks_claimed_by_user_id_idx ON workflow_tasks(claimed_by_user_id);
INSERT INTO permissions (id, code, name) VALUES
  (gen_random_uuid(), 'task:read', '查看授权任务'),
  (gen_random_uuid(), 'task:claim', '领取和释放任务'),
  (gen_random_uuid(), 'notification:read', '查看和标记通知')
ON CONFLICT (code) DO NOTHING;
