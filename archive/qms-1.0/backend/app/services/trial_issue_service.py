"""
Trial Issue Service
试产问题跟进服务
实现2.8.4试产问题跟进
"""
from datetime import datetime
from typing import Optional, List, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func
from sqlalchemy.orm import selectinload

from app.models.trial_issue import TrialIssue, IssueStatus, IssueType
from app.models.trial_production import TrialProduction
from app.models.problem_report import ProblemReportStatus
from app.core.problem_management import get_problem_category_by_trial_issue_type
from app.schemas.problem_management import ProblemReportCreate, ProblemReportSourceCreate
from app.services.problem_management_service import ProblemManagementService
from app.schemas.trial_issue import (
    TrialIssueCreate,
    TrialIssueUpdate,
    TrialIssueAssign,
    TrialIssueSolution,
    TrialIssueVerification,
    TrialIssueEscalate,
    LegacyIssueApproval,
    TrialIssueStatistics
)


class TrialIssueService:
    """
    试产问题跟进服务类
    
    功能：
    - 录入试产问题
    - 问题清单管理（指派责任人、上传对策、关闭）
    - 升级为8D报告
    - 遗留问题管理（SOP节点未关闭问题需特批）
    - 带病量产特批流程（签署风险告知书）
    """
    
    @staticmethod
    async def create_trial_issue(
        db: AsyncSession,
        issue_data: TrialIssueCreate,
        current_user_id: int
    ) -> TrialIssue:
        """
        创建试产问题
        
        Args:
            db: 数据库会话
            issue_data: 问题数据
            current_user_id: 当前用户ID
            
        Returns:
            TrialIssue: 创建的试产问题
            
        Raises:
            ValueError: 试产记录不存在
        """
        # 验证试产记录是否存在
        trial_query = select(TrialProduction).where(
            TrialProduction.id == issue_data.trial_id
        )
        trial_result = await db.execute(trial_query)
        trial = trial_result.scalar_one_or_none()
        
        if not trial:
            raise ValueError(f"试产记录不存在: trial_id={issue_data.trial_id}")
        
        # 生成问题编号
        issue_number = await TrialIssueService._generate_issue_number(db)
        
        # 创建试产问题
        trial_issue = TrialIssue(
            trial_id=issue_data.trial_id,
            issue_number=issue_number,
            issue_description=issue_data.issue_description,
            issue_type=issue_data.issue_type,
            assigned_to=issue_data.assigned_to,
            assigned_dept=issue_data.assigned_dept,
            deadline=issue_data.deadline,
            status=IssueStatus.OPEN,
            is_escalated_to_8d=False,
            is_legacy_issue=False,
            created_by=current_user_id
        )
        
        db.add(trial_issue)
        await db.commit()
        await db.refresh(trial_issue)
        
        print(f"✅ 创建试产问题成功: ID={trial_issue.id}, 编号={trial_issue.issue_number}")
        
        return trial_issue
    
    @staticmethod
    async def _generate_issue_number(db: AsyncSession) -> str:
        """
        生成问题编号
        
        格式：TI-YYYY-NNNN
        例如：TI-2026-0001
        
        Args:
            db: 数据库会话
            
        Returns:
            str: 问题编号
        """
        current_year = datetime.utcnow().year
        prefix = f"TI-{current_year}-"
        
        # 查询当年最大编号
        query = select(func.max(TrialIssue.issue_number)).where(
            TrialIssue.issue_number.like(f"{prefix}%")
        )
        result = await db.execute(query)
        max_number = result.scalar_one_or_none()
        
        if max_number:
            # 提取序号并加1
            seq = int(max_number.split("-")[-1]) + 1
        else:
            seq = 1
        
        return f"{prefix}{seq:04d}"
    
    @staticmethod
    async def get_trial_issue_by_id(
        db: AsyncSession,
        issue_id: int
    ) -> Optional[TrialIssue]:
        """
        根据ID获取试产问题
        
        Args:
            db: 数据库会话
            issue_id: 问题ID
            
        Returns:
            Optional[TrialIssue]: 试产问题或None
        """
        query = select(TrialIssue).where(TrialIssue.id == issue_id)
        result = await db.execute(query)
        return result.scalar_one_or_none()
    
    @staticmethod
    async def update_trial_issue(
        db: AsyncSession,
        issue_id: int,
        issue_data: TrialIssueUpdate,
        current_user_id: int
    ) -> TrialIssue:
        """
        更新试产问题
        
        Args:
            db: 数据库会话
            issue_id: 问题ID
            issue_data: 更新数据
            current_user_id: 当前用户ID
            
        Returns:
            TrialIssue: 更新后的试产问题
            
        Raises:
            ValueError: 问题不存在
        """
        issue = await TrialIssueService.get_trial_issue_by_id(db, issue_id)
        
        if not issue:
            raise ValueError(f"试产问题不存在: issue_id={issue_id}")
        
        # 更新字段
        if issue_data.issue_description is not None:
            issue.issue_description = issue_data.issue_description
        
        if issue_data.issue_type is not None:
            issue.issue_type = issue_data.issue_type
        
        if issue_data.assigned_to is not None:
            issue.assigned_to = issue_data.assigned_to
        
        if issue_data.assigned_dept is not None:
            issue.assigned_dept = issue_data.assigned_dept
        
        if issue_data.root_cause is not None:
            issue.root_cause = issue_data.root_cause
        
        if issue_data.solution is not None:
            issue.solution = issue_data.solution
        
        if issue_data.verification_method is not None:
            issue.verification_method = issue_data.verification_method
        
        if issue_data.verification_result is not None:
            issue.verification_result = issue_data.verification_result
        
        if issue_data.status is not None:
            issue.status = issue_data.status
            
            # 根据状态更新时间戳
            if issue_data.status == IssueStatus.RESOLVED:
                issue.resolved_at = datetime.utcnow()
            elif issue_data.status == IssueStatus.CLOSED:
                issue.closed_at = datetime.utcnow()
        
        if issue_data.deadline is not None:
            issue.deadline = issue_data.deadline
        
        issue.updated_at = datetime.utcnow()
        
        await db.commit()
        await db.refresh(issue)
        
        print(f"✅ 更新试产问题成功: ID={issue.id}")
        
        return issue
    
    @staticmethod
    async def assign_issue(
        db: AsyncSession,
        issue_id: int,
        assign_data: TrialIssueAssign,
        current_user_id: int
    ) -> TrialIssue:
        """
        指派试产问题
        
        Args:
            db: 数据库会话
            issue_id: 问题ID
            assign_data: 指派数据
            current_user_id: 当前用户ID
            
        Returns:
            TrialIssue: 更新后的试产问题
            
        Raises:
            ValueError: 问题不存在
        """
        issue = await TrialIssueService.get_trial_issue_by_id(db, issue_id)
        
        if not issue:
            raise ValueError(f"试产问题不存在: issue_id={issue_id}")
        
        # 更新指派信息
        issue.assigned_to = assign_data.assigned_to
        issue.assigned_dept = assign_data.assigned_dept
        issue.deadline = assign_data.deadline
        issue.status = IssueStatus.IN_PROGRESS
        issue.updated_at = datetime.utcnow()
        
        await db.commit()
        await db.refresh(issue)
        
        print(f"✅ 指派试产问题成功: ID={issue.id}, 责任人={assign_data.assigned_to}")
        
        # TODO: 发送通知给责任人
        
        return issue
    
    @staticmethod
    async def submit_solution(
        db: AsyncSession,
        issue_id: int,
        solution_data: TrialIssueSolution,
        current_user_id: int
    ) -> TrialIssue:
        """
        提交解决方案
        
        Args:
            db: 数据库会话
            issue_id: 问题ID
            solution_data: 解决方案数据
            current_user_id: 当前用户ID
            
        Returns:
            TrialIssue: 更新后的试产问题
            
        Raises:
            ValueError: 问题不存在或状态不允许
        """
        issue = await TrialIssueService.get_trial_issue_by_id(db, issue_id)
        
        if not issue:
            raise ValueError(f"试产问题不存在: issue_id={issue_id}")
        
        if issue.status not in [IssueStatus.OPEN, IssueStatus.IN_PROGRESS]:
            raise ValueError(f"问题状态不允许提交解决方案: status={issue.status}")
        
        # 更新解决方案
        issue.root_cause = solution_data.root_cause
        issue.solution = solution_data.solution
        issue.verification_method = solution_data.verification_method
        issue.status = IssueStatus.IN_PROGRESS
        issue.updated_at = datetime.utcnow()
        
        await db.commit()
        await db.refresh(issue)
        
        print(f"✅ 提交解决方案成功: ID={issue.id}")
        
        # TODO: 发送通知给创建人/验证人
        
        return issue
    
    @staticmethod
    async def verify_solution(
        db: AsyncSession,
        issue_id: int,
        verification_data: TrialIssueVerification,
        current_user_id: int
    ) -> TrialIssue:
        """
        验证解决方案
        
        Args:
            db: 数据库会话
            issue_id: 问题ID
            verification_data: 验证数据
            current_user_id: 当前用户ID
            
        Returns:
            TrialIssue: 更新后的试产问题
            
        Raises:
            ValueError: 问题不存在或状态不允许
        """
        issue = await TrialIssueService.get_trial_issue_by_id(db, issue_id)
        
        if not issue:
            raise ValueError(f"试产问题不存在: issue_id={issue_id}")
        
        if issue.status != IssueStatus.IN_PROGRESS:
            raise ValueError(f"问题状态不允许验证: status={issue.status}")
        
        if not issue.solution:
            raise ValueError("问题尚未提交解决方案，无法验证")
        
        # 更新验证信息
        issue.verification_result = verification_data.verification_result
        issue.verified_by = current_user_id
        issue.verified_at = datetime.utcnow()
        
        # 根据验证结果更新状态
        if verification_data.verification_result == "passed":
            issue.status = IssueStatus.RESOLVED
            issue.resolved_at = datetime.utcnow()
        else:
            # 验证失败，保持处理中状态，需要重新提交对策
            issue.status = IssueStatus.IN_PROGRESS
        
        issue.updated_at = datetime.utcnow()
        
        await db.commit()
        await db.refresh(issue)
        
        print(f"✅ 验证解决方案成功: ID={issue.id}, 结果={verification_data.verification_result}")
        
        # TODO: 发送通知给责任人
        
        return issue
    
    @staticmethod
    async def close_issue(
        db: AsyncSession,
        issue_id: int,
        current_user_id: int
    ) -> TrialIssue:
        """
        关闭问题
        
        Args:
            db: 数据库会话
            issue_id: 问题ID
            current_user_id: 当前用户ID
            
        Returns:
            TrialIssue: 更新后的试产问题
            
        Raises:
            ValueError: 问题不存在或状态不允许
        """
        issue = await TrialIssueService.get_trial_issue_by_id(db, issue_id)
        
        if not issue:
            raise ValueError(f"试产问题不存在: issue_id={issue_id}")
        
        if issue.status != IssueStatus.RESOLVED:
            raise ValueError(f"只有已解决的问题才能关闭: status={issue.status}")
        
        # 关闭问题
        issue.status = IssueStatus.CLOSED
        issue.closed_at = datetime.utcnow()
        issue.updated_at = datetime.utcnow()
        
        await db.commit()
        await db.refresh(issue)
        
        print(f"✅ 关闭问题成功: ID={issue.id}")
        
        return issue
    
    @staticmethod
    async def escalate_to_8d(
        db: AsyncSession,
        issue_id: int,
        escalate_data: TrialIssueEscalate,
        current_user_id: int
    ) -> TrialIssue:
        """
        升级为8D报告
        
        复杂问题可一键升级为8D报告流程进行深度分析
        
        Args:
            db: 数据库会话
            issue_id: 问题ID
            escalate_data: 升级数据
            current_user_id: 当前用户ID
            
        Returns:
            TrialIssue: 更新后的试产问题
            
        Raises:
            ValueError: 问题不存在或已升级
        """
        issue = await TrialIssueService.get_trial_issue_by_id(db, issue_id)
        
        if not issue:
            raise ValueError(f"试产问题不存在: issue_id={issue_id}")
        
        if issue.is_escalated_to_8d:
            raise ValueError(f"问题已升级为8D报告: eight_d_id={issue.eight_d_id}")
        
        category = get_problem_category_by_trial_issue_type(
            issue.issue_type.value if hasattr(issue.issue_type, "value") else str(issue.issue_type)
        )
        report = await ProblemManagementService.create_problem_report(
            db=db,
            report_data=ProblemReportCreate(
                module_key="new_product_quality",
                problem_category_key=category.key,
                title=issue.issue_description,
                description=escalate_data.escalation_reason,
                risk_level="high",
                response_mode="eight_d",
                responsible_dept=issue.assigned_dept,
                assigned_to=issue.assigned_to,
                due_at=issue.deadline,
                sources=[
                    ProblemReportSourceCreate(
                        source_type="trial_issue",
                        source_id=issue.id,
                        source_number=issue.issue_number,
                        is_primary=True,
                    )
                ],
            ),
            created_by=current_user_id,
            status=ProblemReportStatus.RESPONDING,
            commit=False,
        )
        eight_d_id = report.id
        
        # 更新升级信息
        issue.is_escalated_to_8d = True
        issue.eight_d_id = eight_d_id
        issue.problem_report_id = report.id
        issue.escalated_at = datetime.utcnow()
        issue.escalation_reason = escalate_data.escalation_reason
        issue.status = IssueStatus.ESCALATED
        issue.updated_at = datetime.utcnow()
        
        await db.commit()
        await db.refresh(issue)
        issue.problem_number = report.problem_number
        issue.eight_d_number = report.eight_d_number
        issue.risk_level = ProblemManagementService._enum_value(report.risk_level)
        issue.response_mode = report.response_mode
        
        print(f"✅ 升级为8D报告成功: issue_id={issue.id}, 8d_id={eight_d_id}")
        
        # TODO: 发送通知给相关人员
        
        return issue
    
    @staticmethod
    async def mark_as_legacy(
        db: AsyncSession,
        issue_id: int,
        current_user_id: int
    ) -> TrialIssue:
        """
        标记为遗留问题
        
        SOP节点未关闭的问题需标记为遗留问题，需特批才能量产
        
        Args:
            db: 数据库会话
            issue_id: 问题ID
            current_user_id: 当前用户ID
            
        Returns:
            TrialIssue: 更新后的试产问题
            
        Raises:
            ValueError: 问题不存在
        """
        issue = await TrialIssueService.get_trial_issue_by_id(db, issue_id)
        
        if not issue:
            raise ValueError(f"试产问题不存在: issue_id={issue_id}")
        
        # 标记为遗留问题
        issue.is_legacy_issue = True
        issue.legacy_approval_status = "pending"
        issue.updated_at = datetime.utcnow()
        
        await db.commit()
        await db.refresh(issue)
        
        print(f"✅ 标记为遗留问题成功: ID={issue.id}")
        
        # TODO: 发送通知给审批人
        
        return issue
    
    @staticmethod
    async def approve_legacy_issue(
        db: AsyncSession,
        issue_id: int,
        approval_data: LegacyIssueApproval,
        current_user_id: int
    ) -> TrialIssue:
        """
        带病量产特批
        
        对遗留问题进行特批，允许带病量产
        需签署风险告知书
        
        Args:
            db: 数据库会话
            issue_id: 问题ID
            approval_data: 审批数据
            current_user_id: 当前用户ID
            
        Returns:
            TrialIssue: 更新后的试产问题
            
        Raises:
            ValueError: 问题不存在或不是遗留问题
        """
        issue = await TrialIssueService.get_trial_issue_by_id(db, issue_id)
        
        if not issue:
            raise ValueError(f"试产问题不存在: issue_id={issue_id}")
        
        if not issue.is_legacy_issue:
            raise ValueError("只有遗留问题才能进行带病量产特批")
        
        # 更新审批信息
        issue.legacy_approval_status = approval_data.approval_status
        issue.legacy_approval_by = current_user_id
        issue.legacy_approval_at = datetime.utcnow()
        issue.updated_at = datetime.utcnow()
        
        # TODO: 如果批准，生成风险告知书
        if approval_data.approval_status == "approved":
            # risk_doc_path = await generate_risk_acknowledgement(issue)
            # issue.risk_acknowledgement_path = risk_doc_path
            pass
        
        await db.commit()
        await db.refresh(issue)
        
        print(f"✅ 带病量产特批完成: ID={issue.id}, 状态={approval_data.approval_status}")
        
        # TODO: 发送通知给相关人员
        
        return issue
    
    @staticmethod
    async def list_trial_issues(
        db: AsyncSession,
        trial_id: Optional[int] = None,
        status: Optional[IssueStatus] = None,
        issue_type: Optional[IssueType] = None,
        assigned_to: Optional[int] = None,
        is_legacy: Optional[bool] = None,
        skip: int = 0,
        limit: int = 50
    ) -> List[TrialIssue]:
        """
        查询试产问题列表
        
        Args:
            db: 数据库会话
            trial_id: 试产记录ID（可选）
            status: 问题状态（可选）
            issue_type: 问题类型（可选）
            assigned_to: 责任人ID（可选）
            is_legacy: 是否遗留问题（可选）
            skip: 跳过记录数
            limit: 返回记录数限制
            
        Returns:
            List[TrialIssue]: 试产问题列表
        """
        query = select(TrialIssue)
        
        # 添加筛选条件
        if trial_id:
            query = query.where(TrialIssue.trial_id == trial_id)
        
        if status:
            query = query.where(TrialIssue.status == status)
        
        if issue_type:
            query = query.where(TrialIssue.issue_type == issue_type)
        
        if assigned_to:
            query = query.where(TrialIssue.assigned_to == assigned_to)
        
        if is_legacy is not None:
            query = query.where(TrialIssue.is_legacy_issue == is_legacy)
        
        # 按创建时间倒序排列
        query = query.order_by(TrialIssue.created_at.desc()).offset(skip).limit(limit)
        
        result = await db.execute(query)
        return result.scalars().all()
    
    @staticmethod
    async def get_issue_statistics(
        db: AsyncSession,
        trial_id: Optional[int] = None
    ) -> TrialIssueStatistics:
        """
        获取试产问题统计
        
        Args:
            db: 数据库会话
            trial_id: 试产记录ID（可选）
            
        Returns:
            TrialIssueStatistics: 问题统计数据
        """
        # 基础查询
        base_query = select(TrialIssue)
        if trial_id:
            base_query = base_query.where(TrialIssue.trial_id == trial_id)
        
        # 总数
        total_query = select(func.count(TrialIssue.id))
        if trial_id:
            total_query = total_query.where(TrialIssue.trial_id == trial_id)
        total_result = await db.execute(total_query)
        total_issues = total_result.scalar_one()
        
        # 按状态统计
        status_counts = {}
        for status in IssueStatus:
            status_query = select(func.count(TrialIssue.id)).where(
                TrialIssue.status == status
            )
            if trial_id:
                status_query = status_query.where(TrialIssue.trial_id == trial_id)
            status_result = await db.execute(status_query)
            status_counts[status.value] = status_result.scalar_one()
        
        # 遗留问题数
        legacy_query = select(func.count(TrialIssue.id)).where(
            TrialIssue.is_legacy_issue == True
        )
        if trial_id:
            legacy_query = legacy_query.where(TrialIssue.trial_id == trial_id)
        legacy_result = await db.execute(legacy_query)
        legacy_issues = legacy_result.scalar_one()
        
        # 按类型统计
        issues_by_type = {}
        for issue_type in IssueType:
            type_query = select(func.count(TrialIssue.id)).where(
                TrialIssue.issue_type == issue_type
            )
            if trial_id:
                type_query = type_query.where(TrialIssue.trial_id == trial_id)
            type_result = await db.execute(type_query)
            issues_by_type[issue_type.value] = type_result.scalar_one()
        
        return TrialIssueStatistics(
            total_issues=total_issues,
            open_issues=status_counts.get("open", 0),
            in_progress_issues=status_counts.get("in_progress", 0),
            resolved_issues=status_counts.get("resolved", 0),
            closed_issues=status_counts.get("closed", 0),
            escalated_issues=status_counts.get("escalated", 0),
            legacy_issues=legacy_issues,
            issues_by_type=issues_by_type
        )


# 创建全局服务实例
trial_issue_service = TrialIssueService()
