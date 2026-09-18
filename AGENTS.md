# QMS cross-version rules

- `archive/qms-1.0/` is read-only: do not build, test, deploy, install dependencies, or make fixes there.
- `qms-2.0/` is the only implementation home. Its independent workspace now contains the stage 1 foundation.
- Use `docs/superpowers/specs/` for the QMS 2.0 design and `docs/superpowers/plans/` for phase plans.
- Before future work, review the design, create or update the applicable phase plan, confirm scope and verification, then implement only in `qms-2.0/`.
- Do not copy QMS 1.0 compatibility layers into QMS 2.0.
- Never put secrets, environment files, uploads, logs, or database backups in Git.
- OpenAPI from Nest Swagger is the only frontend API contract source. Describe request/response DTOs in the API, run `contracts:generate`, and commit `qms-2.0/packages/contracts/src/generated/api.ts`. Web clients import contract types only from `@qms/contracts`; do not duplicate DTOs or edit generated types.
- Before completing foundation changes, run archive isolation, `contracts:check`, Web/API unit tests, real PostgreSQL integration tests, Web/API builds, and foundation Compose validation. Integration tests must fail when PostgreSQL configuration is missing; never substitute SQLite.
- Docker build contexts must stay inside `qms-2.0/`. API and Worker share one image with separate commands. CI uses disposable resources and destroys them on completion; no persistent preview environment.
