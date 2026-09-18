"""
客户审核服务
Customer Audit Service - 客户来厂审核台账管理和问题闭环跟踪
"""
from datetime import datetime
from typing import Optional, List, Tuple
from sqlalchemy import select, func, or_, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.problem_management import get_problem_category_definition
from app.models.audit import CustomerAudit, AuditNC
from app.models.problem_report import ProblemReportStatus
from app.schemas.problem_management import ProblemReportCreate, ProblemReportSourceCreate
from app.services.problem_management_service import ProblemManagementService
from app.schemas.customer_audit import (
    CustomerAuditCreate,
    CustomerAuditIssueTaskResponse,
    CustomerAuditUpdate,
    CustomerAuditQuery,
    CustomerAuditIssueTaskCreate
)


class CustomerAuditService:
    CUSTOMER_AUDIT_PROBLEM_CATEGORY_KEY = "AQ3"
    """客户审核服务类"""
    
    @staticmethod
    async def create_customer_audit(
        db: AsyncSession,
        audit_data: CustomerAuditCreate,
        created_by: int
    ) -> CustomerAudit:
        """
        创建客户审核台账
        
        Args:
            db: 数据库会话
            audit_data: 客户审核数据
            created_by: 创建人ID
            
        Returns:
            CustomerAudit: 创建的客户审核记录
        """
        # 创建客户审核记录
        customer_audit = CustomerAudit(
            customer_name=audit_data.customer_name,
            audit_type=audit_data.audit_type,
            audit_date=audit_data.audit_date,
            final_result=audit_data.final_result,
            score=audit_data.score,
            external_issue_list_path=audit_data.external_issue_list_path,
            internal_contact=audit_data.internal_contact,
            audit_report_path=audit_data.audit_report_path,
            summary=audit_data.summary,
            status="completed",  # 默认状态为已完成
            created_by=created_by,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        
        db.add(customer_audit)
        await db.commit()
        await db.refresh(customer_audit)
        
        return customer_audit
    
    @staticmethod
    async def get_customer_audit_by_id(
        db: AsyncSession,
        audit_id: int
    ) -> Optional[CustomerAudit]:
        """
        根据ID获取客户审核记录
        
        Args:
            db: 数据库会话
            audit_id: 客户审核ID
            
        Returns:
            Optional[CustomerAudit]: 客户审核记录，不存在则返回None
        """
        result = await db.execute(
            select(CustomerAudit).where(CustomerAudit.id == audit_id)
        )
        return result.scalar_one_or_none()
    
    @staticmethod
    async def update_customer_audit(
        db: AsyncSession,
        audit_id: int,
        audit_data: CustomerAuditUpdate
    ) -> Optional[CustomerAudit]:
        """
        更新客户审核台账
        
        Args:
            db: 数据库会话
            audit_id: 客户审核ID
            audit_data: 更新数据
            
        Returns:
            Optional[CustomerAudit]: 更新后的客户审核记录
        """
        customer_audit = await CustomerAuditService.get_customer_audit_by_id(db, audit_id)
        if not customer_audit:
            return None
        
        # 更新字段
        update_data = audit_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(customer_audit, field, value)
        
        customer_audit.updated_at = datetime.utcnow()
        
        await db.commit()
        await db.refresh(customer_audit)
        
        return customer_audit
    
    @staticmethod
    async def query_customer_audits(
        db: AsyncSession,
        query_params: CustomerAuditQuery
    ) -> Tuple[List[CustomerAudit], int]:
        """
        查询客户审核列表
        
        Args:
            db: 数据库会话
            query_params: 查询参数
            
        Returns:
            Tuple[List[CustomerAudit], int]: (客户审核列表, 总记录数)
        """
        # 构建查询条件
        conditions = []
        
        if query_params.customer_name:
            conditions.append(
                CustomerAudit.customer_name.ilike(f"%{query_params.customer_name}%")
            )
        
        if query_params.audit_type:
            conditions.append(CustomerAudit.audit_type == query_params.audit_type)
        
        if query_params.final_result:
            conditions.append(CustomerAudit.final_result == query_params.final_result)
        
        if query_params.status:
            conditions.append(CustomerAudit.status == query_params.status)
        
        if query_params.start_date:
            conditions.append(CustomerAudit.audit_date >= query_params.start_date)
        
        if query_params.end_date:
            conditions.append(CustomerAudit.audit_date <= query_params.end_date)
        
        # 构建基础查询
        base_query = select(CustomerAudit)
        if conditions:
            base_query = base_query.where(and_(*conditions))
        
        # 获取总数
        count_query = select(func.count()).select_from(CustomerAudit)
        if conditions:
            count_query = count_query.where(and_(*conditions))
        
        total_result = await db.execute(count_query)
        total = total_result.scalar()
        
        # 分页查询
        offset = (query_params.page - 1) * query_params.page_size
        query = base_query.order_by(CustomerAudit.audit_date.desc()).offset(offset).limit(query_params.page_size)
        
        result = await db.execute(query)
        audits = result.scalars().all()
        
        return list(audits), total
    
    @staticmethod
    async def create_issue_task_from_customer_audit(
        db: AsyncSession,
        task_data: CustomerAuditIssueTaskCreate,
        created_by: int
    ) -> AuditNC:
        """
        从客户问题清单创建内部闭环任务
        
        依据客户指摘问题清单，在系统内部创建对应的NC任务条目，
        确保不遗漏任何一个客户提出的整改项。
        
        Args:
            db: 数据库会话
            task_data: 任务数据
            created_by: 创建人ID
            
        Returns:
            AuditNC: 创建的NC任务记录
        """
        # 验证客户审核记录是否存在
        customer_audit = await CustomerAuditService.get_customer_audit_by_id(
            db, task_data.customer_audit_id
        )
        if not customer_audit:
            raise ValueError(f"客户审核记录不存在: {task_data.customer_audit_id}")
        
        # 创建NC任务（复用AuditNC模型，但audit_id设置为负数表示来自客户审核）
        # 注：这里使用负数ID作为标识，实际项目中可能需要单独的表或字段来区分
        nc_task = AuditNC(
            audit_id=-task_data.customer_audit_id,  # 负数表示来自客户审核
            nc_item=f"客户审核问题-{customer_audit.customer_name}",
            nc_description=task_data.issue_description,
            responsible_dept=task_data.responsible_dept,
            assigned_to=task_data.assigned_to,
            deadline=task_data.deadline,
            verification_status="assigned" if task_data.assigned_to else "open",
            created_by=created_by,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        
        db.add(nc_task)
        await db.flush()

        category = get_problem_category_definition(CustomerAuditService.CUSTOMER_AUDIT_PROBLEM_CATEGORY_KEY)
        report = await ProblemManagementService.create_problem_report(
            db=db,
            report_data=ProblemReportCreate(
                module_key="audit_management",
                problem_category_key=category.key,
                title=task_data.issue_description,
                description=task_data.issue_description,
                risk_level=task_data.priority,
                response_mode=task_data.response_mode,
                responsible_dept=task_data.responsible_dept,
                assigned_to=task_data.assigned_to,
                due_at=task_data.deadline,
                sources=[
                    ProblemReportSourceCreate(
                        source_type="audit_nc",
                        source_id=nc_task.id,
                        source_parent_id=task_data.customer_audit_id,
                        source_number=f"NC-{nc_task.id}",
                        is_primary=True,
                    )
                ],
            ),
            created_by=created_by,
            status=ProblemReportStatus.ASSIGNED if task_data.assigned_to else ProblemReportStatus.OPEN,
            commit=False,
        )
        
        # 更新客户审核状态为"问题待关闭"
        if customer_audit.status == "completed":
            customer_audit.status = "issue_open"
            customer_audit.updated_at = datetime.utcnow()
        
        await db.commit()
        await db.refresh(nc_task)
        nc_task.problem_report = report
        
        return nc_task

    @staticmethod
    def build_issue_task_response(
        task: AuditNC,
        *,
        customer_audit_id: int,
        priority: str | None = None,
    ) -> CustomerAuditIssueTaskResponse:
        """Build the customer-audit issue-task response from the shared AuditNC model."""

        category = get_problem_category_definition(
            CustomerAuditService.CUSTOMER_AUDIT_PROBLEM_CATEGORY_KEY
        )
        report = getattr(task, "problem_report", None)
        return CustomerAuditIssueTaskResponse(
            id=task.id,
            customer_audit_id=customer_audit_id,
            issue_description=task.nc_description,
            responsible_dept=task.responsible_dept,
            assigned_to=task.assigned_to,
            deadline=task.deadline,
            priority=priority,
            status=task.verification_status,
            root_cause=task.root_cause,
            corrective_action=task.corrective_action,
            corrective_evidence=task.corrective_evidence,
            verified_by=task.verified_by,
            verified_at=task.verified_at,
            verification_comment=task.verification_comment,
            closed_at=task.closed_at,
            created_at=task.created_at,
            updated_at=task.updated_at,
            created_by=task.created_by,
            problem_category_key=category.key,
            problem_category_label=category.label,
            problem_report_id=report.id if report else None,
            problem_number=report.problem_number if report else None,
            eight_d_number=report.eight_d_number if report else None,
            response_mode=report.response_mode if report else None,
        )
    
    @staticmethod
    async def get_customer_audit_issue_tasks(
        db: AsyncSession,
        customer_audit_id: int
    ) -> List[AuditNC]:
        """
        获取客户审核关联的所有问题任务
        
        Args:
            db: 数据库会话
            customer_audit_id: 客户审核ID
            
        Returns:
            List[AuditNC]: 问题任务列表
        """
        result = await db.execute(
            select(AuditNC)
            .where(AuditNC.audit_id == -customer_audit_id)
            .order_by(AuditNC.created_at.desc())
        )
        return list(result.scalars().all())
    
    @staticmethod
    async def check_all_issues_closed(
        db: AsyncSession,
        customer_audit_id: int
    ) -> bool:
        """
        检查客户审核的所有问题是否已关闭
        
        Args:
            db: 数据库会话
            customer_audit_id: 客户审核ID
            
        Returns:
            bool: 是否所有问题已关闭
        """
        result = await db.execute(
            select(func.count())
            .select_from(AuditNC)
            .where(
                and_(
                    AuditNC.audit_id == -customer_audit_id,
                    AuditNC.verification_status != "closed"
                )
            )
        )
        open_count = result.scalar()
        return open_count == 0
    
    @staticmethod
    async def auto_update_customer_audit_status(
        db: AsyncSession,
        customer_audit_id: int
    ) -> Optional[CustomerAudit]:
        """
        自动更新客户审核状态
        
        当所有问题任务都关闭后，自动将客户审核状态更新为"问题已关闭"
        
        Args:
            db: 数据库会话
            customer_audit_id: 客户审核ID
            
        Returns:
            Optional[CustomerAudit]: 更新后的客户审核记录
        """
        customer_audit = await CustomerAuditService.get_customer_audit_by_id(
            db, customer_audit_id
        )
        if not customer_audit:
            return None
        
        # 检查是否所有问题已关闭
        all_closed = await CustomerAuditService.check_all_issues_closed(
            db, customer_audit_id
        )
        
        if all_closed and customer_audit.status == "issue_open":
            customer_audit.status = "issue_closed"
            customer_audit.updated_at = datetime.utcnow()
            await db.commit()
            await db.refresh(customer_audit)
        
        return customer_audit
