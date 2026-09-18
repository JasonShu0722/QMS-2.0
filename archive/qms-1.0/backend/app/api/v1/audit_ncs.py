"""
Audit NC API routes.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.core.exceptions import NotFoundException, PermissionDeniedException, ValidationException
from app.models.user import User
from app.schemas.audit_nc import (
    AuditNCAssign,
    AuditNCClose,
    AuditNCDetail,
    AuditNCListResponse,
    AuditNCQuery,
    AuditNCResponse,
    AuditNCVerify,
)
from app.services.audit_nc_service import AuditNCService

router = APIRouter(prefix="/audit-nc", tags=["审核不符合项管理"])


@router.post("/{nc_id}/assign", response_model=AuditNCDetail, summary="指派 NC")
async def assign_nc(
    nc_id: int,
    data: AuditNCAssign,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        nc = await AuditNCService.assign_nc(db, nc_id, data, current_user.id)
        return await AuditNCService.get_nc_detail(db, nc.id)
    except NotFoundException as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except ValidationException as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))


@router.post("/{nc_id}/response", response_model=AuditNCDetail, summary="提交 NC 对策")
async def submit_nc_response(
    nc_id: int,
    data: AuditNCResponse,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        nc = await AuditNCService.submit_response(db, nc_id, data, current_user.id)
        return await AuditNCService.get_nc_detail(db, nc.id)
    except NotFoundException as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except ValidationException as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except PermissionDeniedException as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))


@router.post("/{nc_id}/verify", response_model=AuditNCDetail, summary="验证 NC")
async def verify_nc(
    nc_id: int,
    data: AuditNCVerify,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        nc = await AuditNCService.verify_nc(db, nc_id, data, current_user.id)
        return await AuditNCService.get_nc_detail(db, nc.id)
    except NotFoundException as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except ValidationException as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except PermissionDeniedException as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))


@router.post("/{nc_id}/close", response_model=AuditNCDetail, summary="关闭 NC")
async def close_nc(
    nc_id: int,
    data: AuditNCClose,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        nc = await AuditNCService.close_nc(db, nc_id, data, current_user.id)
        return await AuditNCService.get_nc_detail(db, nc.id)
    except NotFoundException as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except ValidationException as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except PermissionDeniedException as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))


@router.get("/{nc_id}", response_model=AuditNCDetail, summary="获取 NC 详情")
async def get_nc_detail(
    nc_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    nc_detail = await AuditNCService.get_nc_detail(db, nc_id)
    if not nc_detail:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"NC记录 ID {nc_id} 不存在")
    return nc_detail


@router.get("", response_model=AuditNCListResponse, summary="获取 NC 列表")
async def list_ncs(
    audit_id: int | None = Query(None, description="审核执行记录 ID"),
    assigned_to: int | None = Query(None, description="指派给的用户 ID"),
    responsible_dept: str | None = Query(None, description="责任部门"),
    problem_category_key: str | None = Query(None, description="问题分类"),
    verification_status: str | None = Query(None, description="验证状态"),
    is_overdue: bool | None = Query(None, description="是否逾期"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页记录数"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query_params = AuditNCQuery(
        audit_id=audit_id,
        assigned_to=assigned_to,
        responsible_dept=responsible_dept,
        problem_category_key=problem_category_key,
        verification_status=verification_status,
        is_overdue=is_overdue,
        page=page,
        page_size=page_size,
    )

    ncs, total = await AuditNCService.list_ncs(db, query_params)
    total_pages = (total + page_size - 1) // page_size

    return AuditNCListResponse(
        items=ncs,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )
