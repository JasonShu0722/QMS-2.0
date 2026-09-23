CREATE TABLE supplier_verifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  problem_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  verifier_id uuid NOT NULL,
  content_version integer NOT NULL,
  accepted boolean NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT supplier_verifications_pkey PRIMARY KEY (id),
  CONSTRAINT supplier_verifications_problem_fkey
    FOREIGN KEY (problem_id) REFERENCES supplier_quality_problems(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT supplier_verifications_revision_fkey
    FOREIGN KEY (revision_id, problem_id) REFERENCES supplier_response_revisions(id, problem_id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX supplier_verifications_problem_revision_created_idx
  ON supplier_verifications(problem_id, revision_id, created_at);

CREATE INDEX supplier_verifications_problem_created_idx
  ON supplier_verifications(problem_id, created_at);
