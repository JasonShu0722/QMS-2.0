ALTER TABLE supplier_workflow_bindings
  ADD CONSTRAINT supplier_workflow_bindings_id_version_key UNIQUE (id, version);

ALTER TABLE supplier_quality_problems
  ADD COLUMN workflow_binding_id uuid,
  ADD COLUMN workflow_binding_version integer;

ALTER TABLE supplier_quality_problems
  ADD CONSTRAINT supplier_quality_problems_binding_pair_check
    CHECK ((workflow_binding_id IS NULL AND workflow_binding_version IS NULL)
      OR (workflow_binding_id IS NOT NULL AND workflow_binding_version IS NOT NULL AND workflow_binding_version > 0)),
  ADD CONSTRAINT supplier_quality_problems_binding_fkey
    FOREIGN KEY (workflow_binding_id, workflow_binding_version)
    REFERENCES supplier_workflow_bindings(id, version) ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX supplier_quality_problems_workflow_binding_idx
  ON supplier_quality_problems(workflow_binding_id, workflow_binding_version);
