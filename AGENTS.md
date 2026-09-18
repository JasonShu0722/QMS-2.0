# QMS cross-version rules

- `archive/qms-1.0/` is read-only: do not build, test, deploy, install dependencies, or make fixes there.
- `qms-2.0/` is the only implementation home. Stage 0 contains no business code.
- Use `docs/superpowers/specs/` for the QMS 2.0 design and `docs/superpowers/plans/` for phase plans.
- Before future work, review the design, create or update the applicable phase plan, confirm scope and verification, then implement only in `qms-2.0/`.
- Do not copy QMS 1.0 compatibility layers into QMS 2.0.
- Never put secrets, environment files, uploads, logs, or database backups in Git.
