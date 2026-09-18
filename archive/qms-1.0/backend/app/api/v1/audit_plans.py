"""
审核计划 API 路由
Audit Plan Routes - 审核计划管理接口
"""
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Path, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User
from app.schemas.audit_plan import (
    AuditPlanCreate,
    AuditPlanUpdate,
    AuditPlanPostponeRequest,
    AuditPlanResponse,
    AuditPlanListResponse,
    AuditPlanYearViewResponse
)
from app.services.audit_plan_service import AuditPlanService

router = APIRouter(prefix="/audit-plans", tags=["审核计划管理"])


@router.post(
    "",
    response_model=AuditPlanResponse,
    status_code=status.HTTP_201_CREATED,
    summary="创建审核计划"
)
async def create_audit_plan(
    plan_data: AuditPlanCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    创建年度审核计划
    
    - **audit_type**: 审核类型 (system_audit, process_audit, product_audit, customer_audit)
    - **audit_name**: 审核名称
    - **planned_date**: 计划审核日期
    - **auditor_id**: 主审核员ID
    - **auditee_dept**: 被审核部门
    - **notes**: 备注（可选）
    """
    audit_plan = await AuditPlanService.create_audit_plan(
        db=db,
        plan_data=plan_data,
        created_by=current_user.id
    )
    
    return audit_plan


@router.get(
    "",
    response_model=AuditPlanListResponse,
    summary="获取审核计划列表"
)
async def get_audit_plans(
    audit_type: Optional[str] = Query(None, description="审核类型筛选"),
    status: Optional[str] = Query(None, description="状态筛选"),
    auditor_id: Optional[int] = Query(None, description="审核员ID筛选"),
    auditee_dept: Optional[str] = Query(None, description="被审核部门筛选"),
    start_date: Optional[datetime] = Query(None, description="开始日期筛选"),
    end_date: Optional[datetime] = Query(None, description="结束日期筛选"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(50, ge=1, le=100, description="每页记录数"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取审核计划列表（支持筛选和分页）
    
    支持按以下条件筛选：
    - 审核类型
    - 状态
    - 审核员
    - 被审核部门
    - 日期范围
    """
    plans, total = await AuditPlanService.get_audit_plans(
        db=db,
        audit_type=audit_type,
        status=status,
        auditor_id=auditor_id,
        auditee_dept=auditee_dept,
        start_date=start_date,
        end_date=end_date,
        page=page,
        page_size=page_size
    )
    
    return AuditPlanListResponse(
        total=total,
        items=plans,
        page=page,
        page_size=page_size
    )


@router.get(
    "/year-view/{year}",
    response_model=AuditPlanYearViewResponse,
    summary="获取年度审核计划视图"
)
async def get_year_view(
    year: int = Path(..., ge=2020, le=2100, description="年份"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取年度审核计划视图
    
    返回指定年份的审核计划统计数据：
    - 总计划数
    - 按类型统计
    - 按状态统计
    - 按月份分组的计划列表
    """
    year_view = await AuditPlanService.get_year_view(db=db, year=year)
    
    return year_view


@router.get(
    "/{plan_id}",
    response_model=AuditPlanResponse,
    summary="获取审核计划详情"
)
async def get_audit_plan(
    plan_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    根据ID获取审核计划详情
    """
    audit_plan = await AuditPlanService.get_audit_plan_by_id(db=db, plan_id=plan_id)
    
    if not audit_plan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"审核计划 ID {plan_id} 不存在"
        )
    
    return audit_plan


@router.put(
    "/{plan_id}",
    response_model=AuditPlanResponse,
    summary="更新审核计划"
)
async def update_audit_plan(
    plan_id: int,
    plan_data: AuditPlanUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    更新审核计划信息
    """
    audit_plan = await AuditPlanService.update_audit_plan(
        db=db,
        plan_id=plan_id,
        plan_data=plan_data
    )
    
    if not audit_plan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"审核计划 ID {plan_id} 不存在"
        )
    
    return audit_plan


@router.post(
    "/{plan_id}/postpone",
    response_model=AuditPlanResponse,
    summary="申请延期"
)
async def request_postpone(
    plan_id: int,
    postpone_data: AuditPlanPostponeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    申请延期审核计划
    
    需要提供：
    - **new_planned_date**: 新的计划日期
    - **postpone_reason**: 延期原因
    
    注意：延期申请需要质量部长审批后才能生效
    """
    audit_plan = await AuditPlanService.request_postpone(
        db=db,
        plan_id=plan_id,
        postpone_data=postpone_data,
        user_id=current_user.id
    )
    
    if not audit_plan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"审核计划 ID {plan_id} 不存在"
        )
    
    return audit_plan


@router.post(
    "/{plan_id}/postpone/approve",
    response_model=AuditPlanResponse,
    summary="批准延期申请"
)
async def approve_postpone(
    plan_id: int,
    approved: bool = Query(..., description="是否批准"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    批准或拒绝延期申请（需质量部长权限）
    
    - **approved**: true 表示批准，false 表示拒绝
    """
    # TODO: 添加权限检查，确保只有质量部长可以批准
    # 这里需要集成权限系统，检查 current_user 是否有质量部长角色
    
    audit_plan = await AuditPlanService.approve_postpone(
        db=db,
        plan_id=plan_id,
        approver_id=current_user.id,
        approved=approved
    )
    
    if not audit_plan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"审核计划 ID {plan_id} 不存在"
        )
    
    return audit_plan


@router.get(
    "/upcoming/reminders",
    response_model=list[AuditPlanResponse],
    summary="获取即将到来的审核计划"
)
async def get_upcoming_audits(
    days_ahead: int = Query(7, ge=1, le=30, description="提前天数"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取即将到来的审核计划（用于智能提醒）
    
    - **days_ahead**: 提前天数（默认7天）
    
    返回在指定天数内即将进行的审核计划列表
    """
    upcoming_audits = await AuditPlanService.get_upcoming_audits(
        db=db,
        days_ahead=days_ahead
    )
    
    return upcoming_audits


@router.delete(
    "/{plan_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除审核计划"
)
async def delete_audit_plan(
    plan_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    删除审核计划
    """
    success = await AuditPlanService.delete_audit_plan(db=db, plan_id=plan_id)
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"审核计划 ID {plan_id} 不存在"
        )
    
    return None
