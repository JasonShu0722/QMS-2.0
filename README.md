# QMS repository

This repository preserves the QMS 1.0 archive and establishes the QMS 2.0 redesign workspace.

The active Windows checkout is `D:\WorkSpace\QMS-2.0`, with application commands run from `D:\WorkSpace\QMS-2.0\qms-2.0`. Open `QMS.code-workspace` in this directory. Git history, branches and tags are preserved; sparse checkout keeps the earlier release and redundant tool assets outside the active working tree.

- [D-drive migration plan](docs/superpowers/plans/2026-09-19-qms-2.0-drive-migration.md)

- [QMS 2.0 design](docs/superpowers/specs/2026-09-18-qms-2.0-redesign-design.md)
- [QMS 2.0 implementation and local development](qms-2.0/README.md)
- [Account administration scope and handoff](qms-2.0/docs/ACCOUNT-ADMINISTRATION.md)
- [Phase 0 archive plan](docs/superpowers/plans/2026-09-18-qms-2.0-phase-0-archive.md)
- QMS 1.0 archive manifest remains in Git: `git show HEAD:archive/qms-1.0/ARCHIVE_MANIFEST.md` (the archive is outside this sparse working tree).

`archive/qms-1.0/` is a read-only development snapshot. It is not buildable or deployable from this repository location. `qms-2.0/` is the only active implementation workspace; its foundation, platform work and ABC account administration have separate acceptance records and remaining delivery gates.
