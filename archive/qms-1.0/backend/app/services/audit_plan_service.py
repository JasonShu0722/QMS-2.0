"""
审核计划服务
Audit Plan Service - 审核计划的业务逻辑处理
"""
from datetime import datetime, timedelta
from typing import Optional
from sqlalchemy import select, func, extract
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditPlan
from app.schemas.audit_plan import (
    AuditPlanCreate,
    AuditPlanUpdate,
    AuditPlanPostponeRequest,
    AuditPlanYearViewResponse
)


class AuditPlanService:
    """审核计划服务类"""
    
    @staticmethod
    async def create_audit_plan(
        db: AsyncSession,
        plan_data: AuditPlanCreate,
        created_by: int
    ) -> AuditPlan:
        """
        创建审核计划
        
        Args:
            db: 数据库会话
            plan_data: 审核计划数据
            created_by: 创建人ID
            
        Returns:
            创建的审核计划对象
        """
        audit_plan = AuditPlan(
            audit_type=plan_data.audit_type,
            audit_name=plan_data.audit_name,
            planned_date=plan_data.planned_date,
            auditor_id=plan_data.auditor_id,
            auditee_dept=plan_data.auditee_dept,
            notes=plan_data.notes,
            status="planned",
            created_by=created_by
        )
        
        db.add(audit_plan)
        await db.commit()
        await db.refresh(audit_plan)
        
        return audit_plan
    
    @staticmethod
    async def get_audit_plan_by_id(
        db: AsyncSession,
        plan_id: int
    ) -> Optional[AuditPlan]:
        """
        根据ID获取审核计划
        
        Args:
            db: 数据库会话
            plan_id: 审核计划ID
            
        Returns:
            审核计划对象或None
        """
        result = await db.execute(
            select(AuditPlan).where(AuditPlan.id == plan_id)
        )
        return result.scalar_one_or_none()
    
    @staticmethod
    async def get_audit_plans(
        db: AsyncSession,
        audit_type: Optional[str] = None,
        status: Optional[str] = None,
        auditor_id: Optional[int] = None,
        auditee_dept: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        page: int = 1,
        page_size: int = 50
    ) -> tuple[list[AuditPlan], int]:
        """
        获取审核计划列表（支持筛选和分页）
        
        Args:
            db: 数据库会话
            audit_type: 审核类型筛选
            status: 状态筛选
            auditor_id: 审核员ID筛选
            auditee_dept: 被审核部门筛选
            start_date: 开始日期筛选
            end_date: 结束日期筛选
            page: 页码
            page_size: 每页记录数
            
        Returns:
            (审核计划列表, 总记录数)
        """
        # 构建查询
        query = select(AuditPlan)
        
        # 应用筛选条件
        if audit_type:
            query = query.where(AuditPlan.audit_type == audit_type)
        if status:
            query = query.where(AuditPlan.status == status)
        if auditor_id:
            query = query.where(AuditPlan.auditor_id == auditor_id)
        if auditee_dept:
            query = query.where(AuditPlan.auditee_dept.ilike(f"%{auditee_dept}%"))
        if start_date:
            query = query.where(AuditPlan.planned_date >= start_date)
        if end_date:
            query = query.where(AuditPlan.planned_date <= end_date)
        
        # 获取总记录数
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await db.execute(count_query)
        total = total_result.scalar_one()
        
        # 应用分页和排序
        query = query.order_by(AuditPlan.planned_date.asc())
        query = query.offset((page - 1) * page_size).limit(page_size)
        
        # 执行查询
        result = await db.execute(query)
        plans = result.scalars().all()
        
        return list(plans), total
    
    @staticmethod
    async def get_year_view(
        db: AsyncSession,
        year: int
    ) -> AuditPlanYearViewResponse:
        """
        获取年度审核计划视图
        
        Args:
            db: 数据库会话
            year: 年份
            
        Returns:
            年度审核计划视图数据
        """
        # 查询该年度的所有审核计划
        start_date = datetime(year, 1, 1)
        end_date = datetime(year, 12, 31, 23, 59, 59)
        
        result = await db.execute(
            select(AuditPlan)
            .where(
                AuditPlan.planned_date >= start_date,
                AuditPlan.planned_date <= end_date
            )
            .order_by(AuditPlan.planned_date.asc())
        )
        plans = result.scalars().all()
        
        # 统计数据
        total_plans = len(plans)
        
        # 按类型统计
        by_type: dict[str, int] = {}
        for plan in plans:
            by_type[plan.audit_type] = by_type.get(plan.audit_type, 0) + 1
        
        # 按状态统计
        by_status: dict[str, int] = {}
        for plan in plans:
            by_status[plan.status] = by_status.get(plan.status, 0) + 1
        
        # 按月份分组
        by_month: dict[str, list] = {}
        for month in range(1, 13):
            month_key = f"{year}-{month:02d}"
            by_month[month_key] = []
        
        for plan in plans:
            month_key = f"{plan.planned_date.year}-{plan.planned_date.month:02d}"
            if month_key in by_month:
                by_month[month_key].append(plan)
        
        return AuditPlanYearViewResponse(
            year=year,
            total_plans=total_plans,
            by_type=by_type,
            by_status=by_status,
            by_month=by_month
        )
    
    @staticmethod
    async def update_audit_plan(
        db: AsyncSession,
        plan_id: int,
        plan_data: AuditPlanUpdate
    ) -> Optional[AuditPlan]:
        """
        更新审核计划
        
        Args:
            db: 数据库会话
            plan_id: 审核计划ID
            plan_data: 更新数据
            
        Returns:
            更新后的审核计划对象或None
        """
        audit_plan = await AuditPlanService.get_audit_plan_by_id(db, plan_id)
        if not audit_plan:
            return None
        
        # 更新字段
        update_data = plan_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(audit_plan, field, value)
        
        audit_plan.updated_at = datetime.utcnow()
        
        await db.commit()
        await db.refresh(audit_plan)
        
        return audit_plan
    
    @staticmethod
    async def request_postpone(
        db: AsyncSession,
        plan_id: int,
        postpone_data: AuditPlanPostponeRequest,
        user_id: int
    ) -> Optional[AuditPlan]:
        """
        申请延期
        
        Args:
            db: 数据库会话
            plan_id: 审核计划ID
            postpone_data: 延期申请数据
            user_id: 申请人ID
            
        Returns:
            更新后的审核计划对象或None
        """
        audit_plan = await AuditPlanService.get_audit_plan_by_id(db, plan_id)
        if not audit_plan:
            return None
        
        # 更新延期信息
        audit_plan.planned_date = postpone_data.new_planned_date
        audit_plan.postpone_reason = postpone_data.postpone_reason
        audit_plan.status = "postponed"
        audit_plan.updated_at = datetime.utcnow()
        
        # 注意：延期批准逻辑需要质量部长审批，这里先设置为待批准状态
        # 实际批准操作由 approve_postpone 方法处理
        
        await db.commit()
        await db.refresh(audit_plan)
        
        return audit_plan
    
    @staticmethod
    async def approve_postpone(
        db: AsyncSession,
        plan_id: int,
        approver_id: int,
        approved: bool
    ) -> Optional[AuditPlan]:
        """
        批准或拒绝延期申请
        
        Args:
            db: 数据库会话
            plan_id: 审核计划ID
            approver_id: 批准人ID（质量部长）
            approved: 是否批准
            
        Returns:
            更新后的审核计划对象或None
        """
        audit_plan = await AuditPlanService.get_audit_plan_by_id(db, plan_id)
        if not audit_plan:
            return None
        
        if approved:
            audit_plan.postpone_approved_by = approver_id
            audit_plan.postpone_approved_at = datetime.utcnow()
            audit_plan.status = "planned"  # 批准后恢复为计划状态
        else:
            # 拒绝延期，恢复原状态
            audit_plan.status = "planned"
            audit_plan.postpone_reason = None
        
        audit_plan.updated_at = datetime.utcnow()
        
        await db.commit()
        await db.refresh(audit_plan)
        
        return audit_plan
    
    @staticmethod
    async def get_upcoming_audits(
        db: AsyncSession,
        days_ahead: int = 7
    ) -> list[AuditPlan]:
        """
        获取即将到来的审核计划（用于智能提醒）
        
        Args:
            db: 数据库会话
            days_ahead: 提前天数
            
        Returns:
            即将到来的审核计划列表
        """
        now = datetime.utcnow()
        future_date = now + timedelta(days=days_ahead)
        
        result = await db.execute(
            select(AuditPlan)
            .where(
                AuditPlan.status == "planned",
                AuditPlan.planned_date >= now,
                AuditPlan.planned_date <= future_date
            )
            .order_by(AuditPlan.planned_date.asc())
        )
        
        return list(result.scalars().all())
    
    @staticmethod
    async def delete_audit_plan(
        db: AsyncSession,
        plan_id: int
    ) -> bool:
        """
        删除审核计划
        
        Args:
            db: 数据库会话
            plan_id: 审核计划ID
            
        Returns:
            是否删除成功
        """
        audit_plan = await AuditPlanService.get_audit_plan_by_id(db, plan_id)
        if not audit_plan:
            return False
        
        await db.delete(audit_plan)
        await db.commit()
        
        return True
