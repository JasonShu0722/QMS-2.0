"""
Customer complaint API endpoints.
"""
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User
from app.schemas.customer_complaint import (
    CustomerComplaintBatchCreate,
    CustomerComplaintBatchCreateResponse,
    CustomerComplaintCreate,
    CustomerComplaintCustomerOption,
    CustomerComplaintInternalUserOption,
    CustomerComplaintListResponse,
    CustomerComplaintResponse,
    IMSTracebackRequest,
    IMSTracebackResponse,
    PhysicalAnalysisRecordRequest,
    PhysicalDispositionRecordRequest,
    PreliminaryAnalysisRequest,
)
from app.services.customer_complaint_service import CustomerComplaintService


router = APIRouter(prefix="/customer-complaints", tags=["客户质量管理"])


@router.get(
    "/customers",
    response_model=list[CustomerComplaintCustomerOption],
    summary="获取客诉可选客户列表",
)
async def list_customer_options(
    keyword: Optional[str] = Query(None, description="按客户代码或名称搜索"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await CustomerComplaintService.list_customer_options(db=db, keyword=keyword)


@router.get(
    "/internal-users",
    response_model=list[CustomerComplaintInternalUserOption],
    summary="获取客诉解析责任人列表",
)
async def list_internal_user_options(
    keyword: Optional[str] = Query(None, description="按用户名、姓名或部门搜索"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await CustomerComplaintService.list_internal_user_options(db=db, keyword=keyword)


@router.post(
    "",
    response_model=CustomerComplaintResponse,
    status_code=status.HTTP_201_CREATED,
    summary="创建客诉单",
)
async def create_complaint(
    complaint_data: CustomerComplaintCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        return await CustomerComplaintService.create_complaint(
            db=db,
            complaint_data=complaint_data,
            created_by_id=current_user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"创建客诉单失败: {exc}",
        ) from exc


@router.post(
    "/batch",
    response_model=CustomerComplaintBatchCreateResponse,
    status_code=status.HTTP_201_CREATED,
    summary="批量创建客诉单",
)
async def batch_create_complaints(
    batch_data: CustomerComplaintBatchCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        complaints = await CustomerComplaintService.create_complaints(
            db=db,
            complaint_items=batch_data.items,
            created_by_id=current_user.id,
        )
        return CustomerComplaintBatchCreateResponse(total=len(complaints), items=complaints)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"批量创建客诉单失败: {exc}",
        ) from exc


@router.get(
    "",
    response_model=CustomerComplaintListResponse,
    summary="获取客诉单列表",
)
async def list_complaints(
    complaint_type: Optional[str] = Query(None, description="客诉类型：0km / after_sales"),
    status_filter: Optional[str] = Query(None, alias="status", description="客诉状态"),
    customer_id: Optional[int] = Query(None, description="客户主数据 ID"),
    customer_code: Optional[str] = Query(None, description="客户代码"),
    severity_level: Optional[str] = Query(None, description="严重度等级"),
    cqe_id: Optional[int] = Query(None, description="负责 CQE 的用户 ID"),
    responsible_dept: Optional[str] = Query(None, description="责任部门"),
    start_date: Optional[date] = Query(None, description="开始日期"),
    end_date: Optional[date] = Query(None, description="结束日期"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(50, ge=1, le=100, description="每页数量"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        complaints, total = await CustomerComplaintService.list_complaints(
            db=db,
            complaint_type=complaint_type,
            status=status_filter,
            customer_id=customer_id,
            customer_code=customer_code,
            severity_level=severity_level,
            cqe_id=cqe_id,
            responsible_dept=responsible_dept,
            start_date=start_date,
            end_date=end_date,
            page=page,
            page_size=page_size,
        )
        return CustomerComplaintListResponse(total=total, items=complaints, page=page, page_size=page_size)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"查询客诉单列表失败: {exc}",
        ) from exc


@router.get(
    "/{complaint_id}",
    response_model=CustomerComplaintResponse,
    summary="获取客诉单详情",
)
async def get_complaint(
    complaint_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    complaint = await CustomerComplaintService.get_complaint_by_id(db=db, complaint_id=complaint_id)
    if not complaint:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"客诉单不存在: ID={complaint_id}")
    return complaint


@router.post(
    "/{complaint_id}/physical-disposition",
    response_model=CustomerComplaintResponse,
    summary="更新实物处理备案",
)
async def record_physical_disposition(
    complaint_id: int,
    disposition_data: PhysicalDispositionRecordRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        return await CustomerComplaintService.record_physical_disposition(
            db=db,
            complaint_id=complaint_id,
            disposition_data=disposition_data,
            updated_by_id=current_user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"更新实物处理备案失败: {exc}",
        ) from exc


@router.post(
    "/{complaint_id}/physical-analysis",
    response_model=CustomerComplaintResponse,
    summary="更新实物解析任务",
)
async def record_physical_analysis(
    complaint_id: int,
    analysis_data: PhysicalAnalysisRecordRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        return await CustomerComplaintService.record_physical_analysis(
            db=db,
            complaint_id=complaint_id,
            analysis_data=analysis_data,
            updated_by_id=current_user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"更新实物解析任务失败: {exc}",
        ) from exc


@router.post(
    "/{complaint_id}/preliminary-analysis",
    response_model=CustomerComplaintResponse,
    summary="提交一次因分析",
)
async def submit_preliminary_analysis(
    complaint_id: int,
    analysis_data: PreliminaryAnalysisRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        return await CustomerComplaintService.submit_preliminary_analysis(
            db=db,
            complaint_id=complaint_id,
            analysis_data=analysis_data,
            cqe_id=current_user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"提交一次因分析失败: {exc}",
        ) from exc


@router.post(
    "/traceback/ims",
    response_model=IMSTracebackResponse,
    summary="IMS 自动追溯",
)
async def traceback_ims(
    traceback_request: IMSTracebackRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        return await CustomerComplaintService.auto_traceback_ims(
            db=db,
            work_order=traceback_request.work_order,
            batch_number=traceback_request.batch_number,
            material_code=traceback_request.material_code,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"IMS 追溯失败: {exc}",
        ) from exc
