"""
Independent authentication API for the requirements panel page.
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.requirements_panel_auth import (
    create_requirements_panel_access_token,
    get_current_requirements_panel_user,
    local_auth,
)
from app.models.requirements_panel_user import RequirementsPanelUser
from app.schemas.requirements_panel import (
    RequirementPanelLoginRequest,
    RequirementPanelLoginResponse,
    RequirementPanelUserResponse,
)


router = APIRouter(
    prefix="/requirements-panel-auth",
    tags=["Requirements Panel Auth"],
)


@router.post(
    "/login",
    response_model=RequirementPanelLoginResponse,
    summary="Login with requirements panel account",
)
async def login_requirements_panel(
    payload: RequirementPanelLoginRequest,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(RequirementsPanelUser).where(
            RequirementsPanelUser.username == payload.username
        )
    )
    user = result.scalar_one_or_none()

    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="账号或密码错误",
        )

    if not local_auth.verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="账号或密码错误",
        )

    user.last_login_at = datetime.utcnow()
    await db.flush()

    return RequirementPanelLoginResponse(
        access_token=create_requirements_panel_access_token(user),
        token_type="bearer",
        user=RequirementPanelUserResponse.model_validate(user),
    )


@router.get(
    "/me",
    response_model=RequirementPanelUserResponse,
    summary="Get current requirements panel account",
)
async def get_current_requirements_panel_account(
    current_user: RequirementsPanelUser = Depends(get_current_requirements_panel_user),
):
    return RequirementPanelUserResponse.model_validate(current_user)
