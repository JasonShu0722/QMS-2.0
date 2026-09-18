# QMS 1.0 archive manifest

## Archive identity

- Archive date: 2026-09-18 (Asia/Shanghai)
- Original source branch: `main`
- Original source commit: `44f19a0a1c138057752bedce502880c9e25b828b`
- Source subject: `docs: approve QMS 2.0 redesign`
- Execution branch: `codex/qms-1-archive`
- Planned snapshot tag: `qms-1.0-archive-20260918`

## Status and boundary

This archive is a read-only development snapshot, not a QMS 1.0 delivery claim. Development, fixes, dependency installs, builds, container starts, and deployments are explicitly prohibited under `archive/qms-1.0/`.

All new work belongs only in `qms-2.0/` after a phase plan has been prepared and approved.

The QMS 1.0 product, domain, numbering, workflow, navigation, and dual-track direction are superseded by the QMS 2.0 design. The uncommitted feature-flag, problem-management, deployment, and migration set is snapshot-only and is not a delivery claim. QMS 1.0 regression was not rerun. The Docker daemon was unavailable during preflight, and no down operation was executed.

## Freeze evidence

The following freeze evidence is retained by name and relative link; it contains no copied log bodies in this manifest:

- [FREEZE_PREFLIGHT.md](FREEZE_PREFLIGHT.md)
- [WORKTREE_STATUS_AT_FREEZE.txt](WORKTREE_STATUS_AT_FREEZE.txt)
- [TRACKED_DIFF_AT_FREEZE.txt](TRACKED_DIFF_AT_FREEZE.txt)
- [TRACKED_DIFF_AT_FREEZE.patch](TRACKED_DIFF_AT_FREEZE.patch)
- [UNTRACKED_FILES_AT_FREEZE.txt](UNTRACKED_FILES_AT_FREEZE.txt)

All 15 tracked changes plus the migration were captured. The untracked later plan file is intentional active QMS 2.0 governance.

## Exclusions

- Local `.env` files were not read or moved.
- Uploads, Docker volumes and database data, dependencies, caches, logs, output, `q2_report_materials`, and other ignored runtime artefacts are excluded.
- The tracked `.env.production` file was moved opaque and unread.

## Verification

- Archive integrity: **PASS** — required snapshot paths, root isolation, QMS 2.0 placeholder contents, freeze-status coverage, and migration SHA-256 verified.
- Active build/CI/deploy isolation: **PASS** — active root contains no QMS 1.0 backend, frontend, deployment, documentation, Compose, or workflow paths.
- Historical Compose parse: **PASS** — `docker compose -f archive/qms-1.0/docker-compose.yml config --no-interpolate` completed without starting services.
