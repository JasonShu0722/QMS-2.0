"""
Platform administrator bootstrap helpers.
"""
from __future__ import annotations

from fastapi import Depends, HTTPException, status

from app.core.config import settings
from app.core.dependencies import get_current_active_user
from app.models.user import User


def _normalize_usernames(raw_value: str) -> set[str]:
    return {item.strip().lower() for item in raw_value.split(",") if item.strip()}


def get_platform_admin_usernames() -> set[str]:
    usernames = _normalize_usernames(settings.PLATFORM_ADMIN_USERNAMES)
    usernames.add(settings.REQ_PANEL_ADMIN_USERNAME)
    return usernames


def is_platform_admin(user: User) -> bool:
    return user.username.strip().lower() in get_platform_admin_usernames()


async def get_current_platform_admin(
    current_user: User = Depends(get_current_active_user),
) -> User:
    if not is_platform_admin(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅平台管理员可访问此接口",
        )

    return current_user
