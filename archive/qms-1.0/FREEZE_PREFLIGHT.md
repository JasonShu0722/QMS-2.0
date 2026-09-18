# Freeze preflight

- Current branch: `codex/qms-1-archive`
- HEAD SHA: `44f19a0a1c138057752bedce502880c9e25b828b`
- Latest commit: `2026-09-18T13:45:03+08:00` — `docs: approve QMS 2.0 redesign`
- `git status --porcelain=v1 -uall` total count: 20
- Count timing: captured after the three initial evidence files and before `FREEZE_PREFLIGHT.md` was added; 15 tracked legacy modifications, 1 untracked migration, 1 untracked plan, and 3 evidence files.

## Ignore-rule check

- `.env`: `.gitignore:2:.env`
- `uploads`: no matching ignore rule reported
- `backend-dev-8000.log`: `.gitignore:61:*.log`
- `frontend-dev.log`: `.gitignore:61:*.log`
- `q2_report_materials`: no matching ignore rule reported

## Docker preflight

- `docker compose ps`: unavailable (Docker Desktop Linux daemon pipe)
- `docker compose down`: not run because ps failed

## Untracked migration SHA-256

backend/alembic/versions/2026_06_08_0900-c9d0e1f2a3b4_align_preview_workbench_flags.py C9699F18CC00A8A0277235A3C239705F5805BC79BC23C6BDED21DB84B6BF8D24
