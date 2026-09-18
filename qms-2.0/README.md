# QMS 2.0

QMS 2.0 is the only active implementation home after the QMS 1.0 baseline was frozen. The workspace contains only the `apps/*` and `packages/*` projects listed in `pnpm-workspace.yaml`; the frozen QMS 1.0 archive is outside this implementation boundary and is never a workspace or Docker dependency.

## Local development

Requirements are Node.js `22.22.x` and pnpm `11.19.x`.

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Useful checks from this directory:

```powershell
pnpm test
pnpm build
pnpm lint
pnpm contracts:check
pnpm check:archive-isolation
```

This phase creates the workspace and executable application entry points only. Business modules, migrations, compatibility layers, secrets, uploads, logs, and database backups do not belong in this scaffold. Future changes must follow the QMS 2.0 design and its approved phase plan in the repository-level `docs/superpowers/` directory.
