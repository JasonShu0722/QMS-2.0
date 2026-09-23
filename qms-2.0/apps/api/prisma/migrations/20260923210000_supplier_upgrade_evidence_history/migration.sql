ALTER TABLE supplier_evidence_references ADD COLUMN id UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE supplier_evidence_references DROP CONSTRAINT supplier_evidence_references_pkey;
ALTER TABLE supplier_evidence_references ADD CONSTRAINT supplier_evidence_references_pkey PRIMARY KEY (id);
CREATE UNIQUE INDEX supplier_evidence_references_problem_id_revision_id_file_id_key
  ON supplier_evidence_references(problem_id, revision_id, file_id);
CREATE UNIQUE INDEX supplier_evidence_references_unversioned_file_key
  ON supplier_evidence_references(problem_id, file_id) WHERE revision_id IS NULL;
