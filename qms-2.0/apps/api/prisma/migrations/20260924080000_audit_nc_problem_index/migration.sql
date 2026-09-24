ALTER TABLE audit_ncs
  ADD COLUMN problem_index_id uuid;

CREATE INDEX audit_ncs_problem_index_id_idx
  ON audit_ncs (organization_id, problem_index_id);
