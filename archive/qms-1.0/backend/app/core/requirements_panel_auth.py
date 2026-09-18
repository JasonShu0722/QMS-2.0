"""
Authentication helpers for the independent requirements panel accounts.
"""
from datetime import datetime, timedelta

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_strategy import LocalAuthStrategy
from app.core.config import settings
from app.core.database import get_db
from app.models.requirements_panel_user import RequirementsPanelUser


PANEL_TOKEN_SCOPE = "requirements_panel"
panel_security = HTTPBearer()
optional_panel_security = HTTPBearer(auto_error=False)
local_auth = LocalAuthStrategy()


def create_requirements_panel_access_token(user: RequirementsPanelUser) -> str:
    expire = datetime.utcnow() + timedelta(hours=settings.ACCESS_TOKEN_EXPIRE_HOURS)
    payload = {
        "sub": str(user.id),
        "scope": PANEL_TOKEN_SCOPE,
        "role": user.role,
        "username": user.username,
        "exp": expire,
        "iat": datetime.utcnow(),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def verify_requirements_panel_token(token: str) -> dict:
    payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    if payload.get("scope") != PANEL_TOKEN_SCOPE:
        raise JWTError("Invalid requirements panel token scope")
    return payload


async def get_current_requirements_panel_user(
    credentials: HTTPAuthorizationCredentials = Depends(panel_security),
    db: AsyncSession = Depends(get_db),
) -> RequirementsPanelUser:
    try:
        payload = verify_requirements_panel_token(credentials.credentials)
        user_id = int(payload.get("sub"))
    except (JWTError, ValueError, TypeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid requirements panel credentials: {exc}",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    result = await db.execute(
        select(RequirementsPanelUser).where(RequirementsPanelUser.id == user_id)
    )
    user = result.scalar_one_or_none()

    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Requirements panel account is unavailable",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return user


async def get_optional_requirements_panel_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(optional_panel_security),
    db: AsyncSession = Depends(get_db),
) -> RequirementsPanelUser | None:
    if credentials is None:
        return None

    try:
        payload = verify_requirements_panel_token(credentials.credentials)
        user_id = int(payload.get("sub"))
    except (JWTError, ValueError, TypeError):
        return None

    result = await db.execute(
        select(RequirementsPanelUser).where(RequirementsPanelUser.id == user_id)
    )
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        return None
    return user
