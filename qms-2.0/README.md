# QMS 2.0

QMS 2.0 is the only active implementation home. This independent pnpm workspace contains React 19 / Ant Design 6 Web, the NestJS 11 modular API and Worker, Prisma 7 / PostgreSQL 18, and the generated API contract. The frozen earlier release is outside every workspace and Docker build context.

## Local development

Use Node.js `22.22.x`, pnpm `11.19.x`, PostgreSQL 18, and Docker Compose. Commands below run from `qms-2.0/` unless noted otherwise.

```powershell
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

Set `DATABASE_URL` to your local PostgreSQL URL and `NODE_ENV=development` in the shell before starting the API. Vite serves port 5173 and proxies `/api/` to the API on port 3000, so browser requests and cookies stay on the same origin. Authentication uses server sessions, HttpOnly cookies and CSRF headers; no browser token storage is used.

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
$env:NODE_ENV = 'development'
docker compose -f deployment/docker-compose.foundation.yml config --quiet
docker compose -f deployment/docker-compose.foundation.yml build api web
docker compose -f deployment/docker-compose.foundation.yml up -d postgres minio
docker compose -f deployment/docker-compose.foundation.yml run --rm --no-deps api node node_modules/prisma/build/index.js migrate deploy
docker compose -f deployment/docker-compose.foundation.yml up -d api worker web
```

The Web entry is `http://localhost:8080`; PostgreSQL and MinIO bind to loopback ports 5432 and 9000 (console 9001). Override `WEB_PORT`, `POSTGRES_PORT`, `MINIO_PORT`, and `MINIO_CONSOLE_PORT` to avoid conflicts. Generated hexadecimal database passwords are URI safe; encode reserved characters when supplying other passwords. `POSTGRES_USER` and `POSTGRES_DB` default to `qms` and `qms2`.

Compose defaults to production mode when `NODE_ENV` is unset. Production session and CSRF cookies remain `Secure`: configure HTTPS termination at the Web gateway for real deployment. An additional ingress before Nginx requires a separately reviewed real-IP configuration that trusts only that ingress's addresses; otherwise Nginx sees the ingress as the client. This foundation does not trust arbitrary upstream forwarding chains. The explicit `development` setting above is for loopback HTTP development only. Do not weaken production cookie settings to make HTTP login work.

The stage 1 Worker is a single run, not a polling daemon. With no business handler registered it claims no events and exits successfully; an exited Worker container is expected. MinIO currently supports the foundation adapter boundary; signed uploads, scanning infrastructure and business event handlers are later work.

To create local demo accounts, set `DATABASE_URL` to the loopback database, `NODE_ENV=development`, and distinct `QMS_SEED_INTERNAL_PASSWORD` / `QMS_SEED_SUPPLIER_PASSWORD` values of at least 16 characters, then run `corepack pnpm --filter @qms/api db:seed`. Demo seed refuses non-loopback or production targets and preserves existing passwords. No demo users are created automatically by Compose.

For disposable environments, destroy containers, networks and volumes when finished:

```powershell
docker compose -f deployment/docker-compose.foundation.yml down --volumes --remove-orphans
```

## Verification and CI

Batch 2 platform acceptance entry is `corepack pnpm acceptance:phase-2`; it runs full tests, contracts, archive isolation and build checks. The batch 2 handoff and evidence matrix are recorded in [PHASE-2](docs/PHASE-2.md). Batch 3 starts with the supplier-quality pilot only after platform runtime, permissions, browser evidence and disposable PostgreSQL gates are complete.

The complete reproducible acceptance entry is `corepack pnpm acceptance:phase-1`. It requires the disposable database, seed passwords, Compose variables and a running loopback gateway in `QMS_ACCEPTANCE_BASE_URL`, then runs frozen installation, database integration, unit tests, builds, Compose configuration, archive isolation, contract synchronization and real Chromium login tests. Missing prerequisites fail instead of skipping. Install Chromium first with `corepack pnpm --filter @qms/web exec playwright install chromium`.

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

The foundation workflow runs only for this workspace, the root `AGENTS.md`, or its own workflow file. It performs these checks in order, creates PostgreSQL with random credentials for integration, and removes the temporary container and volumes even on failure. It does not deploy a persistent preview. Compose validation checks configuration; it is not a container build or deployment smoke test.

All implementation follows the approved QMS 2.0 design and phase plan in the repository-level `docs/superpowers/` directory. Secrets, environment files, uploads, logs and database backups must remain outside Git.
