"""
Requirements panel API.

Provides shared online status management for the requirements dashboard.
"""
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Path, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.requirements_panel_auth import get_current_requirements_panel_user
from app.models.requirements_panel_status import RequirementsPanelStatus
from app.models.requirements_panel_user import RequirementsPanelUser
from app.schemas.requirements_panel import (
    RequirementPanelStatusItemResponse,
    RequirementPanelStatusListResponse,
    RequirementPanelStatusUpdateRequest,
    RequirementPanelUserRole,
)


router = APIRouter(prefix="/requirements-panel", tags=["Requirements Panel"])


@router.get(
    "",
    response_model=RequirementPanelStatusListResponse,
    summary="Get shared requirements panel statuses",
)
async def get_requirements_panel_statuses(
    current_user: RequirementsPanelUser = Depends(get_current_requirements_panel_user),
    db: AsyncSession = Depends(get_db),
):
    status_result = await db.execute(
        select(RequirementsPanelStatus, RequirementsPanelUser.full_name)
        .outerjoin(
            RequirementsPanelUser,
            RequirementsPanelUser.id == RequirementsPanelStatus.updated_by,
        )
        .order_by(RequirementsPanelStatus.item_id)
    )

    items: List[RequirementPanelStatusItemResponse] = [
        RequirementPanelStatusItemResponse(
            item_id=status_row.item_id,
            status=status_row.status,
            updated_at=status_row.updated_at,
            updated_by=status_row.updated_by,
            updated_by_name=full_name,
        )
        for status_row, full_name in status_result.all()
    ]

    can_update = current_user.role == RequirementPanelUserRole.ADMIN.value

    return RequirementPanelStatusListResponse(can_update=can_update, items=items)


@router.put(
    "/items/{item_id}",
    response_model=RequirementPanelStatusItemResponse,
    summary="Update one requirements panel item status",
)
async def update_requirements_panel_status(
    payload: RequirementPanelStatusUpdateRequest,
    item_id: str = Path(..., min_length=3, max_length=120),
    current_user: RequirementsPanelUser = Depends(get_current_requirements_panel_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role != RequirementPanelUserRole.ADMIN.value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="当前账号只有查看权限",
        )

    status_result = await db.execute(
        select(RequirementsPanelStatus).where(RequirementsPanelStatus.item_id == item_id)
    )
    requirement_status = status_result.scalar_one_or_none()

    if requirement_status is None:
        requirement_status = RequirementsPanelStatus(
            item_id=item_id,
            status=payload.status.value,
            updated_by=current_user.id,
        )
        db.add(requirement_status)
        await db.flush()
    else:
        requirement_status.status = payload.status.value
        requirement_status.updated_by = current_user.id
        await db.flush()

    name_result = await db.execute(
        select(RequirementsPanelUser.full_name).where(RequirementsPanelUser.id == current_user.id)
    )
    updated_by_name = name_result.scalar_one_or_none()

    return RequirementPanelStatusItemResponse(
        item_id=requirement_status.item_id,
        status=requirement_status.status,
        updated_at=requirement_status.updated_at,
        updated_by=requirement_status.updated_by,
        updated_by_name=updated_by_name,
    )
