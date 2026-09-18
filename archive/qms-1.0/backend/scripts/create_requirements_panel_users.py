"""
Create dedicated accounts for the online requirements panel.

These accounts are intentionally isolated from the main QMS user system.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select

from app.core.auth_strategy import LocalAuthStrategy
from app.core.database import AsyncSessionLocal
from app.models.requirements_panel_user import RequirementsPanelUser


PANEL_USERS = [
    {
        "username": os.getenv("REQ_PANEL_ADMIN_USERNAME", "requirements_admin"),
        "password": os.getenv("REQ_PANEL_ADMIN_PASSWORD", "ReqPanelAdmin@2026"),
        "full_name": os.getenv("REQ_PANEL_ADMIN_FULL_NAME", "需求面板管理员"),
        "role": "admin",
    },
    {
        "username": os.getenv("REQ_PANEL_VIEWER_USERNAME", "requirements_viewer"),
        "password": os.getenv("REQ_PANEL_VIEWER_PASSWORD", "ReqPanelViewer@2026"),
        "full_name": os.getenv("REQ_PANEL_VIEWER_FULL_NAME", "需求面板查阅账号"),
        "role": "viewer",
    },
]


async def ensure_panel_users() -> None:
    auth_strategy = LocalAuthStrategy()

    async with AsyncSessionLocal() as session:
        try:
            for config in PANEL_USERS:
                result = await session.execute(
                    select(RequirementsPanelUser).where(
                        RequirementsPanelUser.username == config["username"]
                    )
                )
                user = result.scalar_one_or_none()

                if user is None:
                    user = RequirementsPanelUser(
                        username=config["username"],
                        password_hash=auth_strategy.hash_password(config["password"]),
                        full_name=config["full_name"],
                        role=config["role"],
                        is_active=True,
                    )
                    session.add(user)
                    await session.flush()
                    print(f"Created panel account: {config['username']}")
                else:
                    user.password_hash = auth_strategy.hash_password(config["password"])
                    user.full_name = config["full_name"]
                    user.role = config["role"]
                    user.is_active = True
                    print(f"Updated panel account: {config['username']}")

                print(f"  Username: {config['username']}")
                print(f"  Password: {config['password']}")
                print(f"  Role: {config['role']}")

            await session.commit()
            print("\nRequirements panel accounts are ready.")
            print("Panel URL: /requirements-panel")
        except Exception:
            await session.rollback()
            raise


if __name__ == "__main__":
    print("=" * 60)
    print("  QMS - Initialize requirements panel accounts")
    print("=" * 60)
    print()
    asyncio.run(ensure_panel_users())
