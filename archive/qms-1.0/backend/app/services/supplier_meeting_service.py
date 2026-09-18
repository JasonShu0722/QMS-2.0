"""
供应商会议与改进监控服务
Supplier Meeting and Improvement Monitoring Service

核心功能：
1. C/D级供应商自动立项会议任务
2. 参会人员要求通知（C级副总、D级总经理）
3. 会议记录管理
4. 资料上传和考勤录入
5. 违规处罚逻辑（未参会自动扣分）
"""
from datetime import datetime, date
from typing import Optional, List
from sqlalchemy import select, func, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.supplier_meeting import SupplierMeeting
from app.models.supplier_performance import SupplierPerformance, PerformanceGrade
from app.models.supplier import Supplier
from app.models.user import User
from app.services.notification_service import NotificationService


class SupplierMeetingService:
    """供应商会议服务"""
    
    @staticmethod
    async def auto_create_meeting_for_performance(
        db: AsyncSession,
        performance: SupplierPerformance,
        created_by: int
    ) -> Optional[SupplierMeeting]:
        """
        自动立项会议任务
        当月度绩效生成为C级或D级时，自动生成"供应商月度品质改善会议"任务
        
        Args:
            db: 数据库会话
            performance: 绩效评价记录
            created_by: 创建人ID
            
        Returns:
            创建的会议记录，如果不需要创建则返回None
        """
        # 只有C级和D级需要创建会议
        if performance.grade not in [PerformanceGrade.C, PerformanceGrade.D]:
            return None
        
        # 检查是否已经创建过会议
        stmt = select(SupplierMeeting).where(
            SupplierMeeting.performance_id == performance.id
        )
        result = await db.execute(stmt)
        existing_meeting = result.scalar_one_or_none()
        
        if existing_meeting:
            return existing_meeting
        
        # 生成会议编号
        meeting_number = await SupplierMeetingService._generate_meeting_number(
            db, performance.supplier_id, performance.year, performance.month
        )
        
        # 确定参会人员要求
        if performance.grade == PerformanceGrade.C:
            required_level = "副总级"
        else:  # D级
            required_level = "总经理"
        
        # 创建会议记录
        meeting = SupplierMeeting(
            supplier_id=performance.supplier_id,
            performance_id=performance.id,
            meeting_number=meeting_number,
            performance_grade=performance.grade,
            required_attendee_level=required_level,
            status="pending",
            created_by=created_by
        )
        
        db.add(meeting)
        await db.commit()
        await db.refresh(meeting)
        
        # 发送通知给供应商
        await SupplierMeetingService._send_meeting_notification(
            db, meeting, performance
        )
        
        return meeting
    
    @staticmethod
    async def _generate_meeting_number(
        db: AsyncSession,
        supplier_id: int,
        year: int,
        month: int
    ) -> str:
        """
        生成会议编号
        格式：MTG-{供应商ID}-{年份}{月份}-{序号}
        例如：MTG-123-202401-001
        """
        prefix = f"MTG-{supplier_id}-{year}{month:02d}"
        
        # 查询当月该供应商的会议数量
        stmt = select(func.count(SupplierMeeting.id)).where(
            and_(
                SupplierMeeting.supplier_id == supplier_id,
                SupplierMeeting.meeting_number.like(f"{prefix}%")
            )
        )
        result = await db.execute(stmt)
        count = result.scalar() or 0
        
        sequence = count + 1
        return f"{prefix}-{sequence:03d}"
    
    @staticmethod
    async def _send_meeting_notification(
        db: AsyncSession,
        meeting: SupplierMeeting,
        performance: SupplierPerformance
    ):
        """
        发送会议通知
        通知供应商需要参加品质改善会议，并说明参会人员要求
        """
        # 获取供应商信息
        stmt = select(Supplier).where(Supplier.id == meeting.supplier_id)
        result = await db.execute(stmt)
        supplier = result.scalar_one_or_none()
        
        if not supplier:
            return
        
        # 获取供应商用户（发送通知）
        stmt = select(User).where(
            and_(
                User.supplier_id == meeting.supplier_id,
                User.status == "active"
            )
        )
        result = await db.execute(stmt)
        supplier_users = result.scalars().all()
        
        if not supplier_users:
            return
        
        # 构建通知内容
        title = f"【重要】品质改善会议通知 - {performance.year}年{performance.month}月"
        content = f"""
尊敬的 {supplier.name}：

您好！根据贵司 {performance.year}年{performance.month}月的绩效评价结果（等级：{performance.grade}，得分：{performance.final_score}），
现需召开品质改善会议，具体要求如下：

1. 参会人员要求：{meeting.required_attendee_level}
2. 会议编号：{meeting.meeting_number}
3. 需提交资料：《物料品质问题改善报告》

请尽快在系统中上传改善报告，并确认参会人员信息。

如有疑问，请联系您的对接SQE。

此致
敬礼！
        """
        
        # 发送通知给所有供应商用户
        user_ids = [user.id for user in supplier_users]
        await NotificationService.send_notification(
            db=db,
            user_ids=user_ids,
            title=title,
            content=content,
            notification_type="workflow",
            link=f"/supplier/meetings/{meeting.id}"
        )
    
    @staticmethod
    async def upload_improvement_report(
        db: AsyncSession,
        meeting_id: int,
        report_path: str,
        uploaded_by: int
    ) -> SupplierMeeting:
        """
        供应商上传改善报告
        
        Args:
            db: 数据库会话
            meeting_id: 会议ID
            report_path: 报告文件路径
            uploaded_by: 上传人ID
            
        Returns:
            更新后的会议记录
        """
        stmt = select(SupplierMeeting).where(SupplierMeeting.id == meeting_id)
        result = await db.execute(stmt)
        meeting = result.scalar_one_or_none()
        
        if not meeting:
            raise ValueError(f"会议记录不存在: {meeting_id}")
        
        # 更新报告信息
        meeting.improvement_report_path = report_path
        meeting.report_uploaded_at = datetime.utcnow()
        meeting.report_uploaded_by = uploaded_by
        meeting.report_submitted = True
        meeting.updated_at = datetime.utcnow()
        
        await db.commit()
        await db.refresh(meeting)
        
        return meeting
    
    @staticmethod
    async def record_meeting_attendance(
        db: AsyncSession,
        meeting_id: int,
        meeting_date: date,
        actual_attendee_level: str,
        attendee_name: str,
        attendee_position: str,
        meeting_minutes: str,
        supplier_attended: bool,
        recorded_by: int
    ) -> SupplierMeeting:
        """
        SQE录入会议考勤和纪要
        
        Args:
            db: 数据库会话
            meeting_id: 会议ID
            meeting_date: 会议日期
            actual_attendee_level: 实际参会最高级别人员
            attendee_name: 参会人员姓名
            attendee_position: 参会人员职位
            meeting_minutes: 会议纪要
            supplier_attended: 供应商是否参会
            recorded_by: 记录人ID（SQE）
            
        Returns:
            更新后的会议记录
        """
        stmt = select(SupplierMeeting).where(SupplierMeeting.id == meeting_id)
        result = await db.execute(stmt)
        meeting = result.scalar_one_or_none()
        
        if not meeting:
            raise ValueError(f"会议记录不存在: {meeting_id}")
        
        # 更新会议信息
        meeting.meeting_date = meeting_date
        meeting.actual_attendee_level = actual_attendee_level
        meeting.attendee_name = attendee_name
        meeting.attendee_position = attendee_position
        meeting.meeting_minutes = meeting_minutes
        meeting.supplier_attended = supplier_attended
        meeting.recorded_by = recorded_by
        meeting.recorded_at = datetime.utcnow()
        meeting.status = "completed"
        meeting.updated_at = datetime.utcnow()
        
        # 检查是否需要处罚
        await SupplierMeetingService._check_and_apply_penalty(db, meeting)
        
        await db.commit()
        await db.refresh(meeting)
        
        return meeting
    
    @staticmethod
    async def _check_and_apply_penalty(
        db: AsyncSession,
        meeting: SupplierMeeting
    ):
        """
        检查并执行违规处罚
        若标记为"供应商未参会"或"未提交报告"，系统自动在下个月度的绩效评价中，
        锁定"配合度扣分"项，强制执行额外扣分
        """
        penalty_reasons = []
        
        # 检查是否未参会
        if not meeting.supplier_attended:
            penalty_reasons.append("供应商未参会")
        
        # 检查是否未提交报告
        if not meeting.report_submitted:
            penalty_reasons.append("未提交改善报告")
        
        # 如果有违规，标记处罚
        if penalty_reasons:
            meeting.penalty_applied = True
            meeting.penalty_reason = "；".join(penalty_reasons)
            
            # 注：实际的扣分逻辑在下个月度绩效计算时执行
            # 这里只是标记，供 PerformanceCalculator 使用
    
    @staticmethod
    async def get_meeting_by_id(
        db: AsyncSession,
        meeting_id: int
    ) -> Optional[SupplierMeeting]:
        """获取会议记录详情"""
        stmt = select(SupplierMeeting).where(SupplierMeeting.id == meeting_id)
        result = await db.execute(stmt)
        return result.scalar_one_or_none()
    
    @staticmethod
    async def list_meetings(
        db: AsyncSession,
        supplier_id: Optional[int] = None,
        status: Optional[str] = None,
        performance_grade: Optional[str] = None,
        year: Optional[int] = None,
        month: Optional[int] = None,
        page: int = 1,
        page_size: int = 20
    ) -> tuple[List[SupplierMeeting], int]:
        """
        查询会议列表
        
        Returns:
            (会议列表, 总数)
        """
        # 构建查询条件
        conditions = []
        
        if supplier_id:
            conditions.append(SupplierMeeting.supplier_id == supplier_id)
        
        if status:
            conditions.append(SupplierMeeting.status == status)
        
        if performance_grade:
            conditions.append(SupplierMeeting.performance_grade == performance_grade)
        
        # 如果指定了年月，需要关联绩效表查询
        if year or month:
            stmt = select(SupplierMeeting).join(
                SupplierPerformance,
                SupplierMeeting.performance_id == SupplierPerformance.id
            )
            if year:
                conditions.append(SupplierPerformance.year == year)
            if month:
                conditions.append(SupplierPerformance.month == month)
        else:
            stmt = select(SupplierMeeting)
        
        if conditions:
            stmt = stmt.where(and_(*conditions))
        
        # 查询总数
        count_stmt = select(func.count()).select_from(stmt.subquery())
        result = await db.execute(count_stmt)
        total = result.scalar() or 0
        
        # 分页查询
        stmt = stmt.order_by(SupplierMeeting.created_at.desc())
        stmt = stmt.offset((page - 1) * page_size).limit(page_size)
        
        result = await db.execute(stmt)
        meetings = result.scalars().all()
        
        return list(meetings), total
    
    @staticmethod
    async def get_meeting_statistics(
        db: AsyncSession,
        supplier_id: Optional[int] = None,
        year: Optional[int] = None
    ) -> dict:
        """
        获取会议统计数据
        
        Returns:
            统计数据字典
        """
        conditions = []
        
        if supplier_id:
            conditions.append(SupplierMeeting.supplier_id == supplier_id)
        
        if year:
            # 需要关联绩效表
            stmt = select(SupplierMeeting).join(
                SupplierPerformance,
                SupplierMeeting.performance_id == SupplierPerformance.id
            ).where(SupplierPerformance.year == year)
        else:
            stmt = select(SupplierMeeting)
        
        if conditions:
            stmt = stmt.where(and_(*conditions))
        
        result = await db.execute(stmt)
        meetings = result.scalars().all()
        
        total_meetings = len(meetings)
        
        if total_meetings == 0:
            return {
                "total_meetings": 0,
                "pending_meetings": 0,
                "completed_meetings": 0,
                "meetings_with_penalty": 0,
                "report_submission_rate": 0.0,
                "attendance_rate": 0.0
            }
        
        pending_meetings = sum(1 for m in meetings if m.status == "pending")
        completed_meetings = sum(1 for m in meetings if m.status == "completed")
        meetings_with_penalty = sum(1 for m in meetings if m.penalty_applied)
        report_submitted_count = sum(1 for m in meetings if m.report_submitted)
        attended_count = sum(1 for m in meetings if m.supplier_attended)
        
        return {
            "total_meetings": total_meetings,
            "pending_meetings": pending_meetings,
            "completed_meetings": completed_meetings,
            "meetings_with_penalty": meetings_with_penalty,
            "report_submission_rate": round(report_submitted_count / total_meetings * 100, 2),
            "attendance_rate": round(attended_count / total_meetings * 100, 2)
        }
    
    @staticmethod
    async def cancel_meeting(
        db: AsyncSession,
        meeting_id: int,
        reason: str
    ) -> SupplierMeeting:
        """
        取消会议
        
        Args:
            db: 数据库会话
            meeting_id: 会议ID
            reason: 取消原因
            
        Returns:
            更新后的会议记录
        """
        stmt = select(SupplierMeeting).where(SupplierMeeting.id == meeting_id)
        result = await db.execute(stmt)
        meeting = result.scalar_one_or_none()
        
        if not meeting:
            raise ValueError(f"会议记录不存在: {meeting_id}")
        
        meeting.status = "cancelled"
        meeting.meeting_minutes = f"会议已取消。原因：{reason}"
        meeting.updated_at = datetime.utcnow()
        
        await db.commit()
        await db.refresh(meeting)
        
        return meeting
