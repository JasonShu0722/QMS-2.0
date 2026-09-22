# QMS 2.0

QMS 2.0 is the only active implementation home. This independent pnpm workspace contains React 19 / Ant Design 6 Web, the NestJS 11 modular API and Worker, Prisma 7 / PostgreSQL 18, and the generated API contract. The frozen earlier release is outside every workspace and Docker build context.

## Frontend design baseline

Frontend work follows the [unified design standard](../docs/superpowers/specs/2026-09-21-qms-frontend-design-standard.md) and [reference code, migration and acceptance guide](docs/FRONTEND-DESIGN.md). The approved UI V2 prototype is a design reference; production adoption is tracked separately. Read [Web instructions](apps/web/AGENTS.md) before Web changes.

## Current local preview

The local preview entry is `http://127.0.0.1:5173`, served from `D:\WorkSpace\QMS-2.0\qms-2.0` on NTFS. **Edit this D-drive checkout for hot reload.** The independent repository preserves the original branches, tags and history at migration baseline `54621e0`; the former E-drive checkout and C-drive worktrees are rollback copies. The old API/Vite processes have been stopped. PostgreSQL on 55440 and MinIO on 19040/19041 retain their original Docker containers and volumes. User/password-hash and migration-history comparisons pass after the switch. Migration acceptance and environment limitations are recorded in [FOUNDATION](docs/FOUNDATION.md).

Windows setup, protected local configuration, launchers and logs are outside Git at `D:\WorkSpace\QMS-2.0-local`. To start the preview when ports 3000 and 5173 are free:

```powershell
. D:\WorkSpace\QMS-2.0-local\Enter-Qms.ps1
& D:\WorkSpace\QMS-2.0-local\Start-Preview.ps1
```

Use `Stop-Preview.ps1` in the same directory to stop only the recorded development processes. It preserves database and object-storage services. Do not run acceptance against the retained preview database.

## Local development

Use Node.js `22.22.x`, pnpm `11.19.x`, PostgreSQL 18, and Docker Compose. Commands below run from `qms-2.0/` unless noted otherwise.

```powershell
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

On this Windows machine, first dot-source `D:\WorkSpace\QMS-2.0-local\Enter-Qms.ps1`. It selects Node 22, Corepack PowerShell shims, the installed PowerShell 7 script shell, `D:\.pnpm-store` and `D:\WorkSpace\.playwright`. pnpm 11 uses the default isolated layout on NTFS; the first D-drive frozen installation downloaded dependencies and completed successfully. With the lockfile unchanged, use existing dependencies during iteration; frozen installation remains part of acceptance.

Some generated CMD shims on this machine cannot execute as text commands. The installed PowerShell shims and explicit Node CLI commands work. Install the browser with `node apps/web/node_modules/@playwright/test/cli.js install chromium` from this workspace after loading the local environment. Historical E-drive exFAT installation failures remain in [FOUNDATION](docs/FOUNDATION.md); they are not the D-drive environment's status.

Set `DATABASE_URL` to your local PostgreSQL URL and `NODE_ENV=development` in the shell before starting the API. Vite serves port 5173 and proxies `/api/` to the API on port 3000, so browser requests and cookies stay on the same origin. Authentication uses server sessions, HttpOnly cookies and CSRF headers; no browser token storage is used.

Governance administrators now require MFA. Configure `QMS_SECURITY_CURRENT_KEY_ID` and `QMS_SECURITY_KEYRING` outside Git before enrolling them; complete `/mfa` after password login. Email confirmation and self-service recovery require SMTP and the recovery Worker switch described in [EMAIL-RECOVERY](docs/EMAIL-RECOVERY.md). TLS, application key rotation, private object storage, and disposable backup/restore commands are documented in [DATA-PROTECTION](docs/DATA-PROTECTION.md). Current D–H scope and integration constraints are in [ACCOUNT-ADMINISTRATION](docs/ACCOUNT-ADMINISTRATION.md) and [PLATFORM-HANDOFF](docs/PLATFORM-HANDOFF.md).

Full browser acceptance uses an encrypted external MFA recovery cache (`QMS_ACCEPTANCE_MFA_CACHE_FILE`, protected by `QMS_BACKUP_KEY`) and a real isolated mail receiver (`QMS_ACCEPTANCE_MAILPIT_URL`). The supplied mail integration fixtures use SMTP 51026 and receiver HTTP 51027. Test secrets never belong in browser storage, source control or terminal output. Missing PostgreSQL, gateway, keyring or mail prerequisites fail acceptance; no SQLite or skipped browser substitute is supported.

## OpenAPI contract

The API publishes `/api/v1/openapi.json`. API DTOs and Swagger annotations are the source of truth for request bodies, response bodies, parameters and error shapes. After changing them:

```powershell
corepack pnpm contracts:generate
corepack pnpm contracts:check
```

Commit `packages/contracts/src/generated/api.ts` with the API change. `contracts:generate` builds the API, exports the same Swagger document without initializing the application or connecting to PostgreSQL, and runs `openapi-typescript`. It needs neither a running API nor database credentials. `contracts:check` regenerates to a temporary directory and compares bytes; it fails with regeneration instructions without overwriting the committed file. Generated output uses LF on every platform.

Web request clients import API types from `@qms/contracts` only. Convenience aliases and UI view types must derive from the generated types; do not repeat API DTO shapes by hand. The API does not import the contracts package, avoiding a generation dependency cycle.

## Foundation Compose

`deployment/docker-compose.foundation.yml` defines exactly `postgres`, `minio`, `api`, `worker`, and `web`. API and Worker use the same image with `dist/main.js` and `dist/worker.js` commands. Nginx serves the static Web build, proxies `/api/` unchanged, and falls back to `index.html` for SPA routes.

The direct API defaults to ignoring forwarded client IP headers. Compose explicitly sets `QMS_TRUST_PROXY_HOPS=1` for its private API behind Nginx. Nginx replaces `X-Forwarded-For` with its connection's `$remote_addr`, so client-supplied headers cannot choose the account/IP rate-limit key. Keep the API port private and route external traffic through this gateway. Only the exact value `1` enables trust; other values, including `true`, leave it disabled. Do not add a shorter route to the API or enable unlimited proxy trust.

Docker excludes dependency trees, generated Prisma sources, build/test output, environment files, uploads, logs and backups at every directory depth. The committed generated OpenAPI types and environment templates remain available to the build; Prisma is regenerated inside the Linux image.

Supply secrets through the shell or an untracked environment file. This PowerShell example creates disposable local values rather than storing credentials in the repository:

```powershell
$env:POSTGRES_PASSWORD = node -e "console.log(require('node:crypto').randomBytes(24).toString('hex'))"
$env:QMS_RATE_LIMIT_SECRET = node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
$env:MINIO_ROOT_USER = 'qms-local'
$env:MINIO_ROOT_PASSWORD = node -e "console.log(require('node:crypto').randomBytes(24).toString('hex'))"
$env:QMS_SECURITY_CURRENT_KEY_ID = 'local-development'
$developmentSecurityKey = node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
$env:QMS_SECURITY_KEYRING = @{ 'local-development' = $developmentSecurityKey } | ConvertTo-Json -Compress
$env:QMS_OBJECT_STORAGE_ACCESS_KEY = $env:MINIO_ROOT_USER
$env:QMS_OBJECT_STORAGE_SECRET_KEY = $env:MINIO_ROOT_PASSWORD
$env:NODE_ENV = 'development'
docker compose -f deployment/docker-compose.foundation.yml config --quiet
docker compose -f deployment/docker-compose.foundation.yml build api web
docker compose -f deployment/docker-compose.foundation.yml up -d postgres minio
docker compose -f deployment/docker-compose.foundation.yml run --rm --no-deps api node node_modules/prisma/build/index.js migrate deploy
docker compose -f deployment/docker-compose.foundation.yml up -d api worker web
```

The Web entry is `http://localhost:8080`; PostgreSQL and MinIO bind to loopback ports 5432 and 9000 (console 9001). Override `WEB_PORT`, `POSTGRES_PORT`, `MINIO_PORT`, and `MINIO_CONSOLE_PORT` to avoid conflicts. Generated hexadecimal database passwords are URI safe; encode reserved characters when supplying other passwords. `POSTGRES_USER` and `POSTGRES_DB` default to `qms` and `qms2`.

Compose defaults to production mode when `NODE_ENV` is unset. Production session and CSRF cookies remain `Secure`: configure HTTPS termination at the Web gateway for real deployment. An additional ingress before Nginx requires a separately reviewed real-IP configuration that trusts only that ingress's addresses; otherwise Nginx sees the ingress as the client. This foundation does not trust arbitrary upstream forwarding chains. The explicit `development` setting above is for loopback HTTP development only. Do not weaken production cookie settings to make HTTP login work.

The platform Worker polls continuously for supported workflow, task timing and attachment scanning events. `QMS_WORKER_POLL_INTERVAL_MS` defaults to 1000 (range 100–60000), and `QMS_WORKER_BATCH_SIZE` defaults to 25 (range 1–100). Use `node dist/worker.js --once` from the built API directory for one batch. Invalid configuration or a missing handler fails explicitly. SIGINT/SIGTERM stops further polling and waits for the current batch; Compose allows 60 seconds before forced termination and restarts failures. Expired leases recover interrupted work. Unknown event types remain untouched. The implemented attachment lifecycle uses fixed object versions, real content verification and ClamAV; see [attachments](docs/ATTACHMENTS.md) for scanner configuration and domain resource authorization.

To create local demo accounts, set `DATABASE_URL` to the loopback database, `NODE_ENV=development`, and distinct `QMS_SEED_INTERNAL_PASSWORD` / `QMS_SEED_SUPPLIER_PASSWORD` values of at least 16 characters, then run `corepack pnpm --filter @qms/api db:seed`. Demo seed refuses non-loopback or production targets and preserves existing passwords. No demo users are created automatically by Compose.

For disposable environments, destroy containers, networks and volumes when finished:

```powershell
docker compose -f deployment/docker-compose.foundation.yml down --volumes --remove-orphans
```

## Verification and CI

The batch 2 platform acceptance entry is `corepack pnpm acceptance:phase-2`. It validates real service prerequisites, runs the full phase 1 sequence (frozen installation, PostgreSQL migration/seed/integration, API/Web tests, builds, real Worker processes, Compose configuration, archive isolation, contracts and all browser tests), checks the test-domain Swagger contract, and validates the scanning Compose overlay. The current results are recorded in [FOUNDATION](docs/FOUNDATION.md). Supplier-specific authorization, forms and end-to-end acceptance belong to the supplier domain.

Batch 2A account governance is tracked in [account administration](docs/ACCOUNT-ADMINISTRATION.md). A provides email editing, password changes and active-session revocation at `/app/account` and `/supplier/account`. B/C provide organization-scoped user creation/editing/activation, controlled identity transfers, one-time password-reset issuance, organization role CRUD/copy/assignment, and a configurable permission matrix at `/app/admin`. Anonymous reset redemption is at `/reset-password`. All Web API types derive from the generated contract; all administrator writes require CSRF and an idempotency key. ABC acceptance and the subsequent matrix evidence are recorded in [FOUNDATION](docs/FOUNDATION.md), separately from historical E: installation and temporary-file cleanup failures.

The matrix selects a role, groups permissions by business area, module and operation, and supports search, module checkboxes, local select/clear, change counts, save and reset. Role forms reuse the grouped selector. Saving submits the original permission set as a concurrency baseline; a conflict retains the draft and offers reload. Read-only users, global roles and permissions the administrator cannot grant remain protected. Planned business modules have no assignable codes. `workbench:read` remains explicitly reserved; the existing `workflow:manage` operation covers its implemented workflow-definition endpoints. User and role writes now use nine separate operation permissions plus the two existing read permissions. The database migration expands and removes legacy manage grants without adding read grants; there is no runtime legacy fallback. See [OpenAPI](docs/OPENAPI.md) for exact codes and conditional request rules.

The D–H batch implements organization trees, configuration, MFA and email recovery, audit operations, data protection, controlled export and core interface governance. Subsequent platform work adds exclusive task claims, real attachments, the [workflow designer](docs/WORKFLOW-DESIGNER.md), and the [problem workspace, saved views, immutable reports and upgrades](docs/PROBLEM-WORKSPACE.md). Actual acceptance evidence is recorded in FOUNDATION. The user separately arranged non-production supplier development; this task does not interact with it. A supplier pilot still requires its own cross-enterprise resource adapters, complete business browser flow and production deployment validation.

`corepack pnpm acceptance:phase-1` remains the shared regression sequence used by phase 2. Configure `QMS_ACCEPTANCE_DISPOSABLE_DATABASE=true`, a disposable database, seed passwords, Compose variables and a running loopback gateway in `QMS_ACCEPTANCE_BASE_URL`. Attachment and neutral-domain browser tests additionally require their own isolated PostgreSQL databases, running gateways, external fixture files and credentials under `QMS_FILE_BROWSER_*` and `QMS_PROBLEM_BROWSER_*`. Phase 2 requires all three databases to be distinct, rejects preserved preview port 55440, and checks real MinIO, ClamAV and Mailpit prerequisites. Required configuration fails instead of skipping. Install Chromium first with `corepack pnpm --filter @qms/web exec playwright install chromium`. Keep fixture credentials and generated validation files outside Git; the neutral module is never registered in the production application.

For the continuous Worker process check, also run `corepack pnpm --filter @qms/api test:worker-process` against disposable PostgreSQL. It builds the current API before starting the actual Worker and creating events after startup. The ordinary database integration suite does not depend on pre-existing compiled files. On Windows, process cleanup is forced termination; graceful abort behavior is separately covered by runner tests. See [PLATFORM-HANDOFF](docs/PLATFORM-HANDOFF.md) for task timing semantics and the remaining authorization interfaces.

See [foundation acceptance and handoff](docs/FOUNDATION.md) for the behavior matrix, environment and actual execution results, [OpenAPI](docs/OPENAPI.md) for the contract workflow, and [security boundaries](docs/SECURITY.md) for implemented protections and remaining deployment work. A passing configuration check is not a container build or deployment result; each evidence level is recorded separately.

```powershell
corepack pnpm check:archive-isolation
corepack pnpm contracts:check
corepack pnpm test
corepack pnpm --filter @qms/api test:integration
corepack pnpm build
docker compose -f deployment/docker-compose.foundation.yml config --quiet
```

Integration requires a disposable PostgreSQL 18 database, `DATABASE_URL`, `NODE_ENV=development`, and the two seed passwords described above. It deploys migrations, seeds local identities, and verifies real persistence and constraints. Missing database configuration fails; tests never silently skip or fall back to SQLite.

The foundation workflow runs only for this workspace, the root `AGENTS.md`, or its own workflow file. It performs unit tests, integration, builds and configuration checks with disposable PostgreSQL, Mailpit, versioned MinIO and ClamAV. It creates random credentials and an external encrypted test archive, and removes temporary service containers and volumes even on failure. Browser and TLS/backup/key-rotation operational evidence is recorded separately in FOUNDATION. The workflow does not deploy a persistent preview; Compose configuration validation is separate from container image builds and deployment smoke tests.

All implementation follows the approved QMS 2.0 design and phase plan in the repository-level `docs/superpowers/` directory. Secrets, environment files, uploads, logs and database backups must remain outside Git.
