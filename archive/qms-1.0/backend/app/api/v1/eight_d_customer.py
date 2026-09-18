"""Customer 8D report API endpoints."""

from datetime import date, datetime, time
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User
from app.schemas.eight_d_customer import (
    D4D7Request,
    D8Request,
    EightDBatchInitRequest,
    EightDCustomerListResponse,
    EightDCustomerResponse,
    EightDPrimaryComplaintSwitchRequest,
    EightDReviewRequest,
    EightDScopeAppendRequest,
    SLAStatus,
)
from app.services.eight_d_customer_service import EightDCustomerService

router = APIRouter(prefix="/customer-complaints", tags=["8D Customer Reports"])


@router.get("/8d/reports", response_model=EightDCustomerListResponse)
async def list_customer_8d_reports(
    report_number: Optional[str] = None,
    complaint_type: Optional[str] = None,
    customer_id: Optional[int] = None,
    product_type: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    response_mode: Optional[str] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ = current_user
    try:
        reports, total = await EightDCustomerService.list_follow_up_reports(
            db=db,
            report_number=report_number,
            complaint_type=complaint_type,
            customer_id=customer_id,
            product_type=product_type,
            status=status_filter,
            response_mode=response_mode,
            start_date=datetime.combine(start_date, time.min) if start_date else None,
            end_date=datetime.combine(end_date, time.max) if end_date else None,
            page=page,
            page_size=page_size,
        )
        return EightDCustomerListResponse(
            total=total,
            items=reports,
            page=page,
            page_size=page_size,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"查询客户 8D 清单失败: {exc}",
        ) from exc


@router.post("/8d/init", response_model=EightDCustomerResponse)
async def init_aggregate_8d_report(
    request: EightDBatchInitRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Initialize one 8D report from one or more complaint ledger records."""

    try:
        return await EightDCustomerService.init_report_batch(
            db=db,
            complaint_ids=request.complaint_ids,
            primary_complaint_id=request.primary_complaint_id,
            user_id=current_user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"发起聚合 8D 报告失败: {exc}",
        ) from exc


@router.post("/{complaint_id}/8d/init", response_model=EightDCustomerResponse)
async def init_8d_report(
    complaint_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Initialize one 8D report from a single complaint ledger record."""

    try:
        return await EightDCustomerService.init_report(
            db=db,
            complaint_id=complaint_id,
            user_id=current_user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"发起 8D 报告失败: {exc}",
        ) from exc


@router.post("/{complaint_id}/8d/complaints", response_model=EightDCustomerResponse)
async def append_related_complaints(
    complaint_id: int,
    request: EightDScopeAppendRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Append one or more complaint ledger records into an existing customer 8D scope."""

    try:
        return await EightDCustomerService.append_related_complaints(
            db=db,
            complaint_id=complaint_id,
            complaint_ids=request.complaint_ids,
            user_id=current_user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"追加 8D 关联客诉失败: {exc}",
        ) from exc


@router.delete("/{complaint_id}/8d/complaints/{linked_complaint_id}", response_model=EightDCustomerResponse)
async def remove_related_complaint(
    complaint_id: int,
    linked_complaint_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Remove one non-primary complaint from an existing customer 8D scope."""

    try:
        return await EightDCustomerService.remove_related_complaint(
            db=db,
            complaint_id=complaint_id,
            linked_complaint_id=linked_complaint_id,
            user_id=current_user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"移除 8D 关联客诉失败: {exc}",
        ) from exc


@router.post("/{complaint_id}/8d/primary-complaint", response_model=EightDCustomerResponse)
async def switch_primary_complaint(
    complaint_id: int,
    request: EightDPrimaryComplaintSwitchRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Switch the primary complaint anchor within an existing customer 8D scope."""

    try:
        return await EightDCustomerService.switch_primary_complaint(
            db=db,
            complaint_id=complaint_id,
            primary_complaint_id=request.primary_complaint_id,
            user_id=current_user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"切换 8D 主客诉失败: {exc}",
        ) from exc


@router.post("/{complaint_id}/8d/d4-d7", response_model=EightDCustomerResponse)
async def submit_d4_d7(
    complaint_id: int,
    data: D4D7Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Submit D4-D7 content for a customer 8D report."""

    try:
        return await EightDCustomerService.submit_d4_d7(
            db=db,
            complaint_id=complaint_id,
            data=data,
            user_id=current_user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"提交 D4-D7 失败: {exc}",
        ) from exc


@router.post("/{complaint_id}/8d/d8", response_model=EightDCustomerResponse)
async def submit_d8(
    complaint_id: int,
    data: D8Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Submit D8 content for a customer 8D report."""

    try:
        return await EightDCustomerService.submit_d8(
            db=db,
            complaint_id=complaint_id,
            data=data,
            user_id=current_user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"提交 D8 失败: {exc}",
        ) from exc


@router.post("/{complaint_id}/8d/review", response_model=EightDCustomerResponse)
async def review_8d_report(
    complaint_id: int,
    review_data: EightDReviewRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Review a customer 8D report."""

    try:
        return await EightDCustomerService.review_8d(
            db=db,
            complaint_id=complaint_id,
            review_data=review_data,
            reviewer_id=current_user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"审核 8D 报告失败: {exc}",
        ) from exc


@router.post("/{complaint_id}/8d/archive", response_model=EightDCustomerResponse)
async def archive_8d_report(
    complaint_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Archive a customer 8D report."""

    try:
        return await EightDCustomerService.archive_8d(
            db=db,
            complaint_id=complaint_id,
            user_id=current_user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"归档 8D 报告失败: {exc}",
        ) from exc


@router.get("/{complaint_id}/8d/sla", response_model=SLAStatus)
async def get_sla_status(
    complaint_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get SLA status for a customer 8D report."""

    try:
        return await EightDCustomerService.calculate_sla_status(db, complaint_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"获取 SLA 状态失败: {exc}",
        ) from exc


@router.get("/8d/overdue", response_model=List[SLAStatus])
async def get_overdue_reports(
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get overdue customer 8D reports."""

    try:
        return await EightDCustomerService.get_overdue_reports(
            db=db,
            skip=skip,
            limit=limit,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"获取超期报告失败: {exc}",
        ) from exc


@router.get("/{complaint_id}/8d", response_model=EightDCustomerResponse)
async def get_8d_report(
    complaint_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a customer 8D report by any linked complaint id."""

    try:
        eight_d = await EightDCustomerService.get_by_complaint_id(db, complaint_id)
        if not eight_d:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"客诉单 {complaint_id} 的 8D 报告不存在")
        return eight_d
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"获取 8D 报告失败: {exc}",
        ) from exc
