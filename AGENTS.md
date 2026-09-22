# QMS cross-version rules

- The active QMS 2.0 checkout is `D:\WorkSpace\QMS-2.0`; run implementation commands from its `qms-2.0/` subdirectory. The former E: checkout and C: worktrees are retained for rollback and are not active development locations.
- This checkout uses sparse checkout. QMS 1.0 remains in Git history and the original read-only archive; do not expand or execute it for QMS 2.0 development.
- Local Windows setup is in `D:\WorkSpace\QMS-2.0-local\Enter-Qms.ps1`; preview credentials and validation logs remain outside Git. Use disposable databases for acceptance, never the preserved local-preview database on port 55440.

- `archive/qms-1.0/` is read-only: do not build, test, deploy, install dependencies, or make fixes there.
- `qms-2.0/` is the only implementation home. Its independent workspace now contains the stage 1 foundation.
- Use `docs/superpowers/specs/` for the QMS 2.0 design and `docs/superpowers/plans/` for phase plans.
- Before future work, review the design, create or update the applicable phase plan, confirm scope and verification, then implement only in `qms-2.0/`.
- Frontend work must follow `docs/superpowers/specs/2026-09-21-qms-frontend-design-standard.md` and `qms-2.0/docs/FRONTEND-DESIGN.md`. Read `qms-2.0/apps/web/AGENTS.md` before Web changes. UI V2 is the approved design reference, not evidence that the production UI has been migrated; do not import prototype code or global prototype CSS into production pages.
- Do not copy QMS 1.0 compatibility layers into QMS 2.0.
- Never put secrets, environment files, uploads, logs, or database backups in Git.
- OpenAPI from Nest Swagger is the only frontend API contract source. Describe request/response DTOs in the API, run `contracts:generate`, and commit `qms-2.0/packages/contracts/src/generated/api.ts`. Web clients import contract types only from `@qms/contracts`; do not duplicate DTOs or edit generated types.
- Before completing foundation changes, run archive isolation, `contracts:check`, Web/API unit tests, real PostgreSQL integration tests, Web/API builds, and foundation Compose validation. Integration tests must fail when PostgreSQL configuration is missing; never substitute SQLite.
- Docker build contexts must stay inside `qms-2.0/`. API and Worker share one image with separate commands. CI uses disposable resources and destroys them on completion; no persistent preview environment.
- Run `pnpm acceptance:phase-1` from `qms-2.0/` against disposable PostgreSQL and a running local gateway for the complete executable acceptance sequence. Required configuration and browser dependencies must fail when missing; never substitute skipped or mocked tests for real login evidence. Record actual PASS/FAIL, commands, environment and limitations in `qms-2.0/docs/FOUNDATION.md`.
- Foundation attachment adapters and the single-run Worker are service boundaries, not delivered upload/scanning or notification business features. Keep stage 2 numbering, problem index, workflow designer/runtime, brief/8D and supplier-quality business fields out of foundation work; follow the documented handoff before starting that batch.
