"""
供应商会议管理 API
Supplier Meeting Management API

实现功能：
1. POST /api/v1/supplier-meetings - 创建会议记录
2. GET /api/v1/supplier-meetings - 获取会议列表
3. GET /api/v1/supplier-meetings/{id} - 获取会议详情
4. PUT /api/v1/supplier-meetings/{id} - 更新会议记录
5. POST /api/v1/supplier-meetings/{id}/upload-report - 供应商上传改善报告
6. POST /api/v1/supplier-meetings/{id}/record-attendance - SQE录入考勤和纪要
7. GET /api/v1/supplier-meetings/statistics - 获取会议统计
8. POST /api/v1/supplier-meetings/{id}/cancel - 取消会议
"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User
from app.schemas.supplier_meeting import (
    SupplierMeetingCreate,
    SupplierMeetingUpdate,
    SupplierMeetingResponse,
    SupplierMeetingListResponse,
    SupplierMeetingReportUpload,
    SupplierMeetingStatistics
)
from app.services.supplier_meeting_service import SupplierMeetingService
from datetime import date


router = APIRouter(prefix="/supplier-meetings", tags=["supplier-meetings"])


@router.post(
    "",
    response_model=SupplierMeetingResponse,
    status_code=status.HTTP_201_CREATED,
    summary="创建供应商会议记录",
    description="SQE手动创建供应商会议记录（通常由系统自动创建）"
)
async def create_supplier_meeting(
    meeting_data: SupplierMeetingCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    创建供应商会议记录
    
    - **supplier_id**: 供应商ID
    - **performance_id**: 关联的绩效评价ID
    - **performance_grade**: 触发会议的绩效等级（C或D）
    """
    # 验证绩效等级
    if meeting_data.performance_grade not in ["C", "D"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="只有C级和D级绩效需要创建会议"
        )
    
    # 获取绩效记录
    from app.models.supplier_performance import SupplierPerformance
    from sqlalchemy import select
    
    stmt = select(SupplierPerformance).where(
        SupplierPerformance.id == meeting_data.performance_id
    )
    result = await db.execute(stmt)
    performance = result.scalar_one_or_none()
    
    if not performance:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"绩效记录不存在: {meeting_data.performance_id}"
        )
    
    # 创建会议
    meeting = await SupplierMeetingService.auto_create_meeting_for_performance(
        db=db,
        performance=performance,
        created_by=current_user.id
    )
    
    if not meeting:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="该绩效等级不需要创建会议或会议已存在"
        )
    
    return meeting


@router.get(
    "",
    response_model=SupplierMeetingListResponse,
    summary="获取供应商会议列表",
    description="查询供应商会议列表，支持多条件筛选和分页"
)
async def list_supplier_meetings(
    supplier_id: Optional[int] = Query(None, description="供应商ID"),
    status: Optional[str] = Query(None, description="状态：pending/completed/cancelled"),
    performance_grade: Optional[str] = Query(None, description="绩效等级：C/D"),
    year: Optional[int] = Query(None, description="年份"),
    month: Optional[int] = Query(None, description="月份"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页记录数"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取供应商会议列表
    
    支持筛选条件：
    - supplier_id: 供应商ID
    - status: 状态
    - performance_grade: 绩效等级
    - year: 年份
    - month: 月份
    """
    # 如果是供应商用户，只能查看自己的会议
    if current_user.user_type == "supplier":
        supplier_id = current_user.supplier_id
    
    meetings, total = await SupplierMeetingService.list_meetings(
        db=db,
        supplier_id=supplier_id,
        status=status,
        performance_grade=performance_grade,
        year=year,
        month=month,
        page=page,
        page_size=page_size
    )
    
    return {
        "total": total,
        "items": meetings,
        "page": page,
        "page_size": page_size
    }


@router.get(
    "/{meeting_id}",
    response_model=SupplierMeetingResponse,
    summary="获取会议详情",
    description="根据会议ID获取详细信息"
)
async def get_supplier_meeting(
    meeting_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取会议详情"""
    meeting = await SupplierMeetingService.get_meeting_by_id(db, meeting_id)
    
    if not meeting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"会议记录不存在: {meeting_id}"
        )
    
    # 权限检查：供应商只能查看自己的会议
    if current_user.user_type == "supplier" and meeting.supplier_id != current_user.supplier_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="无权访问该会议记录"
        )
    
    return meeting


@router.put(
    "/{meeting_id}",
    response_model=SupplierMeetingResponse,
    summary="更新会议记录",
    description="更新会议基本信息"
)
async def update_supplier_meeting(
    meeting_id: int,
    meeting_data: SupplierMeetingUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """更新会议记录"""
    meeting = await SupplierMeetingService.get_meeting_by_id(db, meeting_id)
    
    if not meeting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"会议记录不存在: {meeting_id}"
        )
    
    # 权限检查
    if current_user.user_type == "supplier" and meeting.supplier_id != current_user.supplier_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="无权修改该会议记录"
        )
    
    # 更新字段
    update_data = meeting_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(meeting, field, value)
    
    await db.commit()
    await db.refresh(meeting)
    
    return meeting


@router.post(
    "/{meeting_id}/upload-report",
    response_model=SupplierMeetingResponse,
    summary="供应商上传改善报告",
    description="供应商上传《物料品质问题改善报告》"
)
async def upload_improvement_report(
    meeting_id: int,
    report_data: SupplierMeetingReportUpload,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    供应商上传改善报告
    
    - **improvement_report_path**: 报告文件路径
    """
    meeting = await SupplierMeetingService.get_meeting_by_id(db, meeting_id)
    
    if not meeting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"会议记录不存在: {meeting_id}"
        )
    
    # 权限检查：只有对应的供应商可以上传
    if current_user.user_type != "supplier" or meeting.supplier_id != current_user.supplier_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只有对应的供应商可以上传改善报告"
        )
    
    # 上传报告
    updated_meeting = await SupplierMeetingService.upload_improvement_report(
        db=db,
        meeting_id=meeting_id,
        report_path=report_data.improvement_report_path,
        uploaded_by=current_user.id
    )
    
    return updated_meeting


@router.post(
    "/{meeting_id}/record-attendance",
    response_model=SupplierMeetingResponse,
    summary="SQE录入考勤和纪要",
    description="SQE录入会议考勤信息和会议纪要"
)
async def record_meeting_attendance(
    meeting_id: int,
    meeting_date: date = Query(..., description="会议日期"),
    actual_attendee_level: str = Query(..., description="实际参会最高级别人员"),
    attendee_name: str = Query(..., description="参会人员姓名"),
    attendee_position: str = Query(..., description="参会人员职位"),
    meeting_minutes: str = Query(..., description="会议纪要"),
    supplier_attended: bool = Query(True, description="供应商是否参会"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    SQE录入考勤和纪要
    
    - **meeting_date**: 会议日期
    - **actual_attendee_level**: 实际参会最高级别人员
    - **attendee_name**: 参会人员姓名
    - **attendee_position**: 参会人员职位
    - **meeting_minutes**: 会议纪要
    - **supplier_attended**: 供应商是否参会
    """
    meeting = await SupplierMeetingService.get_meeting_by_id(db, meeting_id)
    
    if not meeting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"会议记录不存在: {meeting_id}"
        )
    
    # 权限检查：只有内部员工（SQE）可以录入
    if current_user.user_type != "internal":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只有内部员工可以录入考勤和纪要"
        )
    
    # 录入考勤
    updated_meeting = await SupplierMeetingService.record_meeting_attendance(
        db=db,
        meeting_id=meeting_id,
        meeting_date=meeting_date,
        actual_attendee_level=actual_attendee_level,
        attendee_name=attendee_name,
        attendee_position=attendee_position,
        meeting_minutes=meeting_minutes,
        supplier_attended=supplier_attended,
        recorded_by=current_user.id
    )
    
    return updated_meeting


@router.get(
    "/statistics",
    response_model=SupplierMeetingStatistics,
    summary="获取会议统计",
    description="获取供应商会议的统计数据"
)
async def get_meeting_statistics(
    supplier_id: Optional[int] = Query(None, description="供应商ID"),
    year: Optional[int] = Query(None, description="年份"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取会议统计
    
    - **supplier_id**: 供应商ID（可选）
    - **year**: 年份（可选）
    """
    # 如果是供应商用户，只能查看自己的统计
    if current_user.user_type == "supplier":
        supplier_id = current_user.supplier_id
    
    statistics = await SupplierMeetingService.get_meeting_statistics(
        db=db,
        supplier_id=supplier_id,
        year=year
    )
    
    return statistics


@router.post(
    "/{meeting_id}/cancel",
    response_model=SupplierMeetingResponse,
    summary="取消会议",
    description="取消已安排的会议"
)
async def cancel_meeting(
    meeting_id: int,
    reason: str = Query(..., description="取消原因"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    取消会议
    
    - **reason**: 取消原因
    """
    meeting = await SupplierMeetingService.get_meeting_by_id(db, meeting_id)
    
    if not meeting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"会议记录不存在: {meeting_id}"
        )
    
    # 权限检查：只有内部员工可以取消会议
    if current_user.user_type != "internal":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只有内部员工可以取消会议"
        )
    
    # 取消会议
    updated_meeting = await SupplierMeetingService.cancel_meeting(
        db=db,
        meeting_id=meeting_id,
        reason=reason
    )
    
    return updated_meeting
