"""
制程质量问题单服务层
ProcessIssue Service - 业务逻辑处理
"""
from datetime import datetime, date, timedelta
from typing import Optional, List, Tuple
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_
from sqlalchemy.orm import selectinload
import json

from ..models.process_issue import ProcessIssue, ProcessIssueStatus
from ..models.process_defect import ProcessDefect, ResponsibilityCategory
from app.core.problem_management import get_problem_category_by_process_context
from app.models.problem_report import ProblemReportStatus
from app.schemas.problem_management import ProblemReportCreate, ProblemReportSourceCreate
from app.services.problem_management_service import ProblemManagementService
from ..schemas.process_issue import (
    ProcessIssueCreate,
    ProcessIssueResponse,
    ProcessIssueVerification,
    ProcessIssueClose,
    ProcessIssueFilter
)


class ProcessIssueService:
    """制程质量问题单服务类"""
    
    @staticmethod
    async def generate_issue_number(db: AsyncSession) -> str:
        """
        生成问题单编号
        格式：PQI-YYYYMMDD-XXXX
        
        Args:
            db: 数据库会话
            
        Returns:
            问题单编号
        """
        today = datetime.now().strftime("%Y%m%d")
        prefix = f"PQI-{today}-"
        
        # 查询今天已有的最大序号
        stmt = select(func.max(ProcessIssue.issue_number)).where(
            ProcessIssue.issue_number.like(f"{prefix}%")
        )
        result = await db.execute(stmt)
        max_number = result.scalar_one_or_none()
        
        if max_number:
            # 提取序号并加1
            sequence = int(max_number.split("-")[-1]) + 1
        else:
            sequence = 1
        
        return f"{prefix}{sequence:04d}"
    
    @staticmethod
    async def create_issue(
        db: AsyncSession,
        issue_data: ProcessIssueCreate,
        created_by: int
    ) -> ProcessIssue:
        """
        创建制程问题单
        
        Args:
            db: 数据库会话
            issue_data: 问题单数据
            created_by: 创建人ID
            
        Returns:
            创建的问题单对象
        """
        # 生成问题单编号
        issue_number = await ProcessIssueService.generate_issue_number(db)
        
        # 处理关联的不良品记录ID
        related_defect_ids_str = None
        if issue_data.related_defect_ids:
            related_defect_ids_str = ",".join(map(str, issue_data.related_defect_ids))
        
        # 创建问题单
        new_issue = ProcessIssue(
            issue_number=issue_number,
            issue_description=issue_data.issue_description,
            responsibility_category=issue_data.responsibility_category,
            assigned_to=issue_data.assigned_to,
            related_defect_ids=related_defect_ids_str,
            status=ProcessIssueStatus.OPEN,
            created_by=created_by
        )
        
        db.add(new_issue)
        await db.flush()

        defects: list[ProcessDefect] = []
        if issue_data.related_defect_ids:
            defect_result = await db.execute(
                select(ProcessDefect).where(ProcessDefect.id.in_(issue_data.related_defect_ids))
            )
            defects = list(defect_result.scalars().all())

        process_context = [issue_number, issue_data.issue_description]
        for defect in defects:
            process_context.extend([defect.process_id, defect.line_id, defect.defect_type])
        category = get_problem_category_by_process_context(*process_context)
        report = await ProblemManagementService.create_problem_report(
            db=db,
            report_data=ProblemReportCreate(
                module_key="process_quality",
                problem_category_key=category.key,
                title=issue_data.issue_description,
                description=issue_data.issue_description,
                risk_level="medium",
                response_mode="brief",
                responsible_dept=(
                    issue_data.responsibility_category.value
                    if hasattr(issue_data.responsibility_category, "value")
                    else str(issue_data.responsibility_category)
                ),
                assigned_to=issue_data.assigned_to,
                sources=[
                    ProblemReportSourceCreate(
                        source_type="process_issue",
                        source_id=new_issue.id,
                        source_number=new_issue.issue_number,
                        is_primary=True,
                    ),
                    *[
                        ProblemReportSourceCreate(
                            source_type="process_defect",
                            source_id=defect.id,
                            source_number=defect.defect_number,
                            is_primary=False,
                        )
                        for defect in defects
                    ],
                ],
            ),
            created_by=created_by,
            status=ProblemReportStatus.OPEN,
            commit=False,
        )
        new_issue.problem_report_id = report.id

        await db.commit()
        await db.refresh(new_issue)
        
        return new_issue
    
    @staticmethod
    async def get_issue_by_id(
        db: AsyncSession,
        issue_id: int
    ) -> Optional[ProcessIssue]:
        """
        根据ID获取问题单
        
        Args:
            db: 数据库会话
            issue_id: 问题单ID
            
        Returns:
            问题单对象或None
        """
        stmt = select(ProcessIssue).where(ProcessIssue.id == issue_id)
        result = await db.execute(stmt)
        return result.scalar_one_or_none()
    
    @staticmethod
    async def submit_response(
        db: AsyncSession,
        issue_id: int,
        response_data: ProcessIssueResponse,
        user_id: int
    ) -> ProcessIssue:
        """
        责任板块提交分析和对策
        
        Args:
            db: 数据库会话
            issue_id: 问题单ID
            response_data: 响应数据
            user_id: 当前用户ID
            
        Returns:
            更新后的问题单对象
            
        Raises:
            ValueError: 问题单不存在或状态不允许操作
        """
        issue = await ProcessIssueService.get_issue_by_id(db, issue_id)
        
        if not issue:
            raise ValueError(f"问题单 ID {issue_id} 不存在")
        
        # 验证权限：只有被指派的人才能填写
        if issue.assigned_to != user_id:
            raise ValueError("您没有权限填写此问题单")
        
        # 验证状态：只有OPEN或IN_ANALYSIS状态才能填写
        if issue.status not in [ProcessIssueStatus.OPEN, ProcessIssueStatus.IN_ANALYSIS]:
            raise ValueError(f"问题单状态为 {issue.status}，不允许填写分析和对策")
        
        # 更新问题单
        issue.root_cause = response_data.root_cause
        issue.containment_action = response_data.containment_action
        issue.corrective_action = response_data.corrective_action
        issue.verification_period = response_data.verification_period
        
        # 计算验证期
        issue.verification_start_date = datetime.now().date()
        issue.verification_end_date = issue.verification_start_date + timedelta(
            days=response_data.verification_period
        )
        
        # 处理证据附件
        if response_data.evidence_files:
            issue.evidence_files = json.dumps(response_data.evidence_files, ensure_ascii=False)
        
        # 更新状态为验证中
        issue.status = ProcessIssueStatus.IN_VERIFICATION
        issue.updated_at = datetime.utcnow()
        
        await db.commit()
        await db.refresh(issue)
        
        return issue
    
    @staticmethod
    async def verify_issue(
        db: AsyncSession,
        issue_id: int,
        verification_data: ProcessIssueVerification,
        verified_by: int
    ) -> ProcessIssue:
        """
        PQE 验证对策有效性
        
        Args:
            db: 数据库会话
            issue_id: 问题单ID
            verification_data: 验证数据
            verified_by: 验证人ID
            
        Returns:
            更新后的问题单对象
            
        Raises:
            ValueError: 问题单不存在或状态不允许操作
        """
        issue = await ProcessIssueService.get_issue_by_id(db, issue_id)
        
        if not issue:
            raise ValueError(f"问题单 ID {issue_id} 不存在")
        
        # 验证状态：只有IN_VERIFICATION状态才能验证
        if issue.status != ProcessIssueStatus.IN_VERIFICATION:
            raise ValueError(f"问题单状态为 {issue.status}，不允许验证")
        
        # 检查是否在验证期内
        if datetime.now().date() < issue.verification_end_date:
            raise ValueError(
                f"验证期尚未结束（结束日期：{issue.verification_end_date}），"
                f"请等待验证期结束后再进行验证"
            )
        
        # 记录验证人
        issue.verified_by = verified_by
        
        if verification_data.verification_result:
            # 验证通过，可以关闭
            # 注意：这里不直接关闭，需要调用close_issue方法
            # 这里只是标记验证通过，状态保持IN_VERIFICATION
            # 实际关闭由close_issue方法完成
            pass
        else:
            # 验证不通过，退回到分析中状态
            issue.status = ProcessIssueStatus.IN_ANALYSIS
            # 清空验证期，需要重新填写对策
            issue.verification_start_date = None
            issue.verification_end_date = None
        
        issue.updated_at = datetime.utcnow()
        
        await db.commit()
        await db.refresh(issue)
        
        return issue
    
    @staticmethod
    async def close_issue(
        db: AsyncSession,
        issue_id: int,
        close_data: ProcessIssueClose,
        closed_by: int
    ) -> ProcessIssue:
        """
        关闭问题单
        
        Args:
            db: 数据库会话
            issue_id: 问题单ID
            close_data: 关闭数据
            closed_by: 关闭人ID
            
        Returns:
            更新后的问题单对象
            
        Raises:
            ValueError: 问题单不存在或状态不允许操作
        """
        issue = await ProcessIssueService.get_issue_by_id(db, issue_id)
        
        if not issue:
            raise ValueError(f"问题单 ID {issue_id} 不存在")
        
        # 验证状态：只有IN_VERIFICATION状态且已验证通过才能关闭
        if issue.status != ProcessIssueStatus.IN_VERIFICATION:
            raise ValueError(f"问题单状态为 {issue.status}，不允许关闭")
        
        if not issue.verified_by:
            raise ValueError("问题单尚未验证，不允许关闭")
        
        # 关闭问题单
        issue.status = ProcessIssueStatus.CLOSED
        issue.closed_by = closed_by
        issue.closed_at = datetime.utcnow()
        issue.updated_at = datetime.utcnow()
        
        await db.commit()
        await db.refresh(issue)
        
        return issue
    
    @staticmethod
    async def query_issues(
        db: AsyncSession,
        filters: ProcessIssueFilter
    ) -> Tuple[List[ProcessIssue], int]:
        """
        查询问题单列表
        
        Args:
            db: 数据库会话
            filters: 查询过滤器
            
        Returns:
            (问题单列表, 总记录数)
        """
        # 构建查询条件
        conditions = []
        
        if filters.status:
            conditions.append(ProcessIssue.status == filters.status)
        
        if filters.responsibility_category:
            conditions.append(
                ProcessIssue.responsibility_category == filters.responsibility_category
            )
        
        if filters.assigned_to:
            conditions.append(ProcessIssue.assigned_to == filters.assigned_to)
        
        if filters.created_by:
            conditions.append(ProcessIssue.created_by == filters.created_by)
        
        if filters.start_date:
            conditions.append(
                func.date(ProcessIssue.created_at) >= filters.start_date
            )
        
        if filters.end_date:
            conditions.append(
                func.date(ProcessIssue.created_at) <= filters.end_date
            )
        
        # 逾期筛选
        if filters.is_overdue is not None:
            if filters.is_overdue:
                # 查询逾期的：状态不是已关闭/已取消，且验证结束日期小于今天
                conditions.append(
                    and_(
                        ProcessIssue.status.notin_([
                            ProcessIssueStatus.CLOSED,
                            ProcessIssueStatus.CANCELLED
                        ]),
                        ProcessIssue.verification_end_date < datetime.now().date()
                    )
                )
            else:
                # 查询未逾期的
                conditions.append(
                    or_(
                        ProcessIssue.status.in_([
                            ProcessIssueStatus.CLOSED,
                            ProcessIssueStatus.CANCELLED
                        ]),
                        ProcessIssue.verification_end_date >= datetime.now().date(),
                        ProcessIssue.verification_end_date.is_(None)
                    )
                )
        
        # 查询总数
        count_stmt = select(func.count(ProcessIssue.id)).where(and_(*conditions))
        count_result = await db.execute(count_stmt)
        total = count_result.scalar_one()
        
        # 查询列表（分页）
        offset = (filters.page - 1) * filters.page_size
        stmt = (
            select(ProcessIssue)
            .where(and_(*conditions))
            .order_by(ProcessIssue.created_at.desc())
            .offset(offset)
            .limit(filters.page_size)
        )
        
        result = await db.execute(stmt)
        issues = result.scalars().all()
        
        return list(issues), total
    
    @staticmethod
    async def get_user_pending_issues(
        db: AsyncSession,
        user_id: int
    ) -> List[ProcessIssue]:
        """
        获取用户待处理的问题单
        
        Args:
            db: 数据库会话
            user_id: 用户ID
            
        Returns:
            待处理问题单列表
        """
        stmt = (
            select(ProcessIssue)
            .where(
                and_(
                    ProcessIssue.assigned_to == user_id,
                    ProcessIssue.status.in_([
                        ProcessIssueStatus.OPEN,
                        ProcessIssueStatus.IN_ANALYSIS,
                        ProcessIssueStatus.IN_VERIFICATION
                    ])
                )
            )
            .order_by(ProcessIssue.verification_end_date.asc().nullsfirst())
        )
        
        result = await db.execute(stmt)
        return list(result.scalars().all())
