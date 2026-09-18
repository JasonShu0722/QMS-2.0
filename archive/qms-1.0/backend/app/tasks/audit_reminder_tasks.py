"""
审核提醒任务
Audit Reminder Tasks - Celery定时任务，用于发送审核计划提醒邮件
"""
from datetime import datetime
from celery import shared_task
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import async_session_maker
from app.services.audit_plan_service import AuditPlanService
from app.services.notification_service import NotificationService


@shared_task(name="send_audit_reminders")
def send_audit_reminders(days_ahead: int = 7):
    """
    发送审核计划提醒
    
    定时任务：每天检查即将到来的审核计划，提前N天发送邮件通知
    
    Args:
        days_ahead: 提前天数（默认7天）
    """
    import asyncio
    
    async def _send_reminders():
        async with async_session_maker() as db:
            # 获取即将到来的审核计划
            upcoming_audits = await AuditPlanService.get_upcoming_audits(
                db=db,
                days_ahead=days_ahead
            )
            
            # 为每个审核计划发送提醒
            for audit in upcoming_audits:
                # 计算剩余天数
                days_remaining = (audit.planned_date - datetime.utcnow()).days
                
                # 发送站内信通知给审核员
                await NotificationService.send_notification(
                    db=db,
                    user_ids=[audit.auditor_id],
                    title=f"审核提醒：{audit.audit_name}",
                    content=f"您有一个审核计划将在 {days_remaining} 天后进行。\n"
                            f"审核类型：{audit.audit_type}\n"
                            f"被审核部门：{audit.auditee_dept}\n"
                            f"计划日期：{audit.planned_date.strftime('%Y-%m-%d %H:%M')}\n"
                            f"请提前准备相关资料。",
                    notification_type="system",
                    link=f"/audit-plans/{audit.id}"
                )
                
                # TODO: 发送邮件通知
                # 需要集成邮件服务，调用 NotificationService.send_email()
                # await NotificationService.send_email(
                #     to_email=auditor_email,
                #     subject=f"审核提醒：{audit.audit_name}",
                #     body=email_content
                # )
    
    # 运行异步任务
    asyncio.run(_send_reminders())
    
    return f"审核提醒任务完成，提前 {days_ahead} 天通知"


@shared_task(name="check_overdue_audits")
def check_overdue_audits():
    """
    检查逾期的审核计划
    
    定时任务：每天检查已逾期但未执行的审核计划，发送预警通知
    """
    import asyncio
    
    async def _check_overdue():
        async with async_session_maker() as db:
            # 获取所有计划状态且已逾期的审核
            from sqlalchemy import select
            from app.models.audit import AuditPlan
            
            now = datetime.utcnow()
            result = await db.execute(
                select(AuditPlan)
                .where(
                    AuditPlan.status == "planned",
                    AuditPlan.planned_date < now
                )
            )
            overdue_audits = result.scalars().all()
            
            # 发送逾期预警
            for audit in overdue_audits:
                days_overdue = (now - audit.planned_date).days
                
                # 发送站内信通知给审核员
                await NotificationService.send_notification(
                    db=db,
                    user_ids=[audit.auditor_id],
                    title=f"审核逾期预警：{audit.audit_name}",
                    content=f"您的审核计划已逾期 {days_overdue} 天。\n"
                            f"审核类型：{audit.audit_type}\n"
                            f"被审核部门：{audit.auditee_dept}\n"
                            f"原计划日期：{audit.planned_date.strftime('%Y-%m-%d %H:%M')}\n"
                            f"请尽快执行或申请延期。",
                    notification_type="alert",
                    link=f"/audit-plans/{audit.id}"
                )
    
    # 运行异步任务
    asyncio.run(_check_overdue())
    
    return "逾期审核检查任务完成"
