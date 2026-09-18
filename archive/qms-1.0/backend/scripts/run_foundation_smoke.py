from __future__ import annotations

import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TEST_ROOT = ROOT / "test"
SMOKE_TESTS = [
    "test_foundation_milestone_api.py",
    "test_feature_flags.py",
    "test_admin_users_api.py",
    "test_profile_api.py",
    "test_login.py",
    "test_admin_permissions_api.py",
]


def main() -> int:
    command = [sys.executable, "-m", "pytest", *[str(TEST_ROOT / name) for name in SMOKE_TESTS]]
    return subprocess.run(command, cwd=ROOT, check=False).returncode


if __name__ == "__main__":
    raise SystemExit(main())
