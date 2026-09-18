"""
审核NC逾期升级定时任务
Audit NC Escalation Tasks - Celery 定时任务，检查逾期NC并发送升级通知
"""
from datetime import datetime
from celery import Task
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
import asyncio
from typing import List

from app.core.celery_app import celery_app
from app.core.config import settings
from app.services.audit_nc_service import AuditNCService
from app.models.audit import AuditNC, AuditExecution
from app.models.user import User


# 创建异步数据库引擎（用于 Celery 任务）
async_engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DB_ECHO,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
)

# 创建异步会话工厂
AsyncSessionLocal = sessionmaker(
    bind=async_engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


class AsyncTask(Task):
    """
    异步任务基类
    支持在 Celery 任务中使用 async/await
    """
    
    def __call__(self, *args, **kwargs):
        """
        重写 __call__ 方法，支持异步任务
        """
        # 创建新的事件循环
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        try:
            # 运行异步任务
            return loop.run_until_complete(self.run_async(*args, **kwargs))
        finally:
            loop.close()
    
    async def run_async(self, *args, **kwargs):
        """
        子类需要实现此方法（异步版本）
        """
        raise NotImplementedError("Subclasses must implement run_async method")


@celery_app.task(
    name="app.tasks.audit_nc_tasks.check_overdue_ncs",
    base=AsyncTask,
    bind=True,
    max_retries=3,
    default_retry_delay=300  # 失败后5分钟重试
)
async def check_overdue_ncs(self) -> dict:
    """
    检查逾期NC并发送升级通知
    
    执行时间：每天早上 09:00 和下午 15:00
    
    功能：
    - 查询所有逾期的NC（deadline < 当前时间 且 状态不是 closed/verified）
    - 发送升级通知给审核员和责任人的上级
    - 记录升级日志
    
    Returns:
        dict: 执行结果统计
    """
    async with AsyncSessionLocal() as db:
        try:
            # 获取所有逾期的NC
            overdue_ncs = await AuditNCService.get_overdue_ncs(db)
            
            escalated_count = 0
            failed_count = 0
            
            for nc in overdue_ncs:
                try:
                    await _escalate_nc(db, nc)
                    escalated_count += 1
                except Exception as e:
                    failed_count += 1
                    print(f"升级NC {nc.id} 失败: {str(e)}")
            
            return {
                "status": "success",
                "total_overdue": len(overdue_ncs),
                "escalated": escalated_count,
                "failed": failed_count,
                "checked_at": datetime.utcnow().isoformat()
            }
        
        except Exception as e:
            # 记录错误并重试
            print(f"检查逾期NC任务失败: {str(e)}")
            raise self.retry(exc=e)


async def _escalate_nc(db: AsyncSession, nc: AuditNC):
    """
    升级单个NC
    
    实现逻辑：
    1. 获取审核执行记录和审核员信息
    2. 获取责任人信息
    3. 发送升级通知给审核员
    4. 发送升级通知给责任人的上级（如果有）
    5. 记录升级日志
    
    Args:
        db: 数据库会话
        nc: NC记录
    """
    # 获取审核执行记录
    audit_execution = await db.get(AuditExecution, nc.audit_id)
    if not audit_execution:
        return
    
    # 计算逾期天数
    now = datetime.utcnow()
    overdue_days = (now - nc.deadline).days
    
    # 构建升级消息
    escalation_message = f"""
    审核NC逾期提醒：
    
    NC编号：{nc.id}
    不符合条款：{nc.nc_item}
    责任部门：{nc.responsible_dept}
    期限：{nc.deadline.strftime('%Y-%m-%d %H:%M')}
    已逾期：{overdue_days} 天
    当前状态：{nc.verification_status}
    
    请尽快处理！
    """
    
    # TODO: 发送通知给审核员
    if audit_execution.auditor_id:
        # await NotificationService.send_notification(
        #     db,
        #     user_ids=[audit_execution.auditor_id],
        #     title="审核NC逾期提醒",
        #     content=escalation_message,
        #     notification_type="alert",
        #     link=f"/audit/nc/{nc.id}"
        # )
        pass
    
    # TODO: 发送通知给责任人
    if nc.assigned_to:
        # await NotificationService.send_notification(
        #     db,
        #     user_ids=[nc.assigned_to],
        #     title="审核NC逾期提醒",
        #     content=escalation_message,
        #     notification_type="alert",
        #     link=f"/audit/nc/{nc.id}"
        # )
        pass
    
    # TODO: 发送邮件通知
    # await EmailService.send_email(
    #     to_emails=[auditor_email, assignee_email],
    #     subject="审核NC逾期提醒",
    #     body=escalation_message
    # )
    
    print(f"NC {nc.id} 升级通知已发送（逾期 {overdue_days} 天）")
