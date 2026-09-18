"""
PPAP 定时任务
Production Part Approval Process Scheduled Tasks
"""
from datetime import date, timedelta
from celery import shared_task
from sqlalchemy import select, and_
from app.core.database import get_async_session
from app.models.ppap import PPAP, PPAPStatus
from app.services.ppap_service import PPAPService
import logging

logger = logging.getLogger(__name__)


@shared_task(name="ppap.check_revalidation_reminders")
async def check_ppap_revalidation_reminders():
    """
    检查 PPAP 年度再鉴定提醒
    
    定时任务：每日执行
    功能：
    1. 检查即将到期的 PPAP（提前30天提醒）
    2. 检查已过期的 PPAP，自动标记为 expired 状态
    3. 发送通知给 SQE 和供应商
    """
    logger.info("开始检查 PPAP 年度再鉴定提醒...")
    
    try:
        async with get_async_session() as db:
            today = date.today()
            
            # 1. 获取即将到期的 PPAP（30天内）
            upcoming_ppaps = await PPAPService.get_revalidation_reminders(db, days_threshold=30)
            
            logger.info(f"发现 {len(upcoming_ppaps)} 个即将到期的 PPAP")
            
            # 2. 检查已过期的 PPAP
            expired_count = 0
            for ppap in upcoming_ppaps:
                if ppap.revalidation_due_date < today and ppap.status == PPAPStatus.APPROVED:
                    # 自动标记为已过期
                    await PPAPService.mark_as_expired(db, ppap.id)
                    expired_count += 1
                    logger.info(f"PPAP {ppap.id} 已过期，已自动标记为 expired 状态")
            
            logger.info(f"已标记 {expired_count} 个过期的 PPAP")
            
            # 3. 发送提醒通知
            # TODO: 集成通知服务
            # - 提前30天：发送邮件给 SQE 和供应商
            # - 提前7天：再次提醒
            # - 已过期：发送紧急通知
            
            for ppap in upcoming_ppaps:
                days_until_due = (ppap.revalidation_due_date - today).days
                
                if days_until_due == 30:
                    logger.info(f"PPAP {ppap.id} 将在30天后到期，需发送提醒")
                    # await NotificationService.send_notification(...)
                
                elif days_until_due == 7:
                    logger.info(f"PPAP {ppap.id} 将在7天后到期，需发送再次提醒")
                    # await NotificationService.send_notification(...)
                
                elif days_until_due < 0:
                    logger.warning(f"PPAP {ppap.id} 已过期 {abs(days_until_due)} 天")
                    # await NotificationService.send_urgent_notification(...)
            
            logger.info("PPAP 年度再鉴定提醒检查完成")
            
            return {
                "success": True,
                "upcoming_count": len(upcoming_ppaps),
                "expired_count": expired_count
            }
    
    except Exception as e:
        logger.error(f"PPAP 年度再鉴定提醒检查失败: {str(e)}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


@shared_task(name="ppap.check_submission_deadlines")
async def check_ppap_submission_deadlines():
    """
    检查 PPAP 提交截止日期
    
    定时任务：每日执行
    功能：
    1. 检查即将逾期的 PPAP 提交任务（提前7天提醒）
    2. 检查已逾期的 PPAP 提交任务
    3. 发送通知给供应商和 SQE
    """
    logger.info("开始检查 PPAP 提交截止日期...")
    
    try:
        async with get_async_session() as db:
            today = date.today()
            threshold_date = today + timedelta(days=7)
            
            # 查询即将逾期或已逾期的待提交 PPAP
            stmt = select(PPAP).where(
                and_(
                    PPAP.status == PPAPStatus.PENDING,
                    PPAP.submission_deadline.isnot(None),
                    PPAP.submission_deadline <= threshold_date
                )
            ).order_by(PPAP.submission_deadline)
            
            result = await db.execute(stmt)
            ppap_list = result.scalars().all()
            
            logger.info(f"发现 {len(ppap_list)} 个即将逾期或已逾期的 PPAP 提交任务")
            
            overdue_count = 0
            upcoming_count = 0
            
            for ppap in ppap_list:
                days_until_deadline = (ppap.submission_deadline - today).days
                
                if days_until_deadline < 0:
                    # 已逾期
                    overdue_count += 1
                    logger.warning(f"PPAP {ppap.id} 已逾期 {abs(days_until_deadline)} 天")
                    # TODO: 发送逾期通知
                    # await NotificationService.send_overdue_notification(...)
                
                elif days_until_deadline <= 7:
                    # 即将逾期（7天内）
                    upcoming_count += 1
                    logger.info(f"PPAP {ppap.id} 将在 {days_until_deadline} 天后到期")
                    # TODO: 发送提醒通知
                    # await NotificationService.send_reminder_notification(...)
            
            logger.info(f"PPAP 提交截止日期检查完成：{overdue_count} 个已逾期，{upcoming_count} 个即将逾期")
            
            return {
                "success": True,
                "overdue_count": overdue_count,
                "upcoming_count": upcoming_count
            }
    
    except Exception as e:
        logger.error(f"PPAP 提交截止日期检查失败: {str(e)}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }


# Celery Beat 定时任务配置
# 在 celery_config.py 中添加以下配置：
"""
from celery.schedules import crontab

beat_schedule = {
    # PPAP 年度再鉴定提醒（每日凌晨 2:00 执行）
    'ppap-revalidation-reminders': {
        'task': 'ppap.check_revalidation_reminders',
        'schedule': crontab(hour=2, minute=0),
    },
    # PPAP 提交截止日期检查（每日凌晨 3:00 执行）
    'ppap-submission-deadlines': {
        'task': 'ppap.check_submission_deadlines',
        'schedule': crontab(hour=3, minute=0),
    },
}
"""
