"""
物料检验规范定时任务
Inspection Specification Celery Tasks - 定期报告任务推送
"""
from datetime import datetime, timedelta
from celery import shared_task
from sqlalchemy import select, and_

from app.core.database import async_session_maker
from app.models.inspection_spec import InspectionSpec, InspectionSpecStatus
from app.services.notification_service import NotificationService


@shared_task(name="inspection_spec.generate_periodic_report_tasks")
async def generate_periodic_report_tasks():
    """
    定期报告任务推送（预留功能）
    
    执行频率：每日凌晨 01:00
    
    逻辑：
    1. 查询所有 APPROVED 状态且 report_frequency_type != 'batch' 的规范
    2. 根据频率（weekly/monthly/quarterly）计算下次提交日期
    3. 生成待办任务推送给供应商
    
    待 ASN 发货数据流打通后启用
    """
    async with async_session_maker() as db:
        try:
            # 查询需要定期报告的检验规范
            result = await db.execute(
                select(InspectionSpec).where(
                    and_(
                        InspectionSpec.status == InspectionSpecStatus.APPROVED,
                        InspectionSpec.report_frequency_type.in_(["weekly", "monthly", "quarterly"])
                    )
                )
            )
            specs = result.scalars().all()
            
            today = datetime.utcnow().date()
            tasks_created = 0
            
            for spec in specs:
                # 计算下次提交日期
                due_date = _calculate_next_due_date(
                    spec.report_frequency_type,
                    spec.effective_date or spec.approved_at
                )
                
                # 如果到期日期是今天，生成任务
                if due_date == today:
                    # TODO: 创建待办任务（需要实现 Task 模型）
                    # task = Task(
                    #     task_type="inspection_report_submission",
                    #     inspection_spec_id=spec.id,
                    #     supplier_id=spec.supplier_id,
                    #     due_date=due_date,
                    #     status="pending"
                    # )
                    # db.add(task)
                    
                    # 发送通知给供应商
                    # await NotificationService.send_notification(
                    #     user_ids=[...],  # 供应商用户ID列表
                    #     title="定期检验报告提交提醒",
                    #     content=f"物料 {spec.material_code} 的 {spec.report_frequency_type} 检验报告需要提交",
                    #     notification_type="workflow"
                    # )
                    
                    tasks_created += 1
            
            # await db.commit()
            
            return {
                "status": "success",
                "tasks_created": tasks_created,
                "message": f"成功生成 {tasks_created} 个定期报告任务（预留功能）"
            }
        
        except Exception as e:
            return {
                "status": "error",
                "message": f"生成定期报告任务失败: {str(e)}"
            }


def _calculate_next_due_date(frequency_type: str, start_date: datetime) -> datetime.date:
    """
    计算下次提交日期
    
    Args:
        frequency_type: 报告频率类型（weekly/monthly/quarterly）
        start_date: 起始日期（生效日期或批准日期）
    
    Returns:
        下次提交日期
    """
    today = datetime.utcnow().date()
    start = start_date.date() if isinstance(start_date, datetime) else start_date
    
    if frequency_type == "weekly":
        # 每周一提交
        days_since_start = (today - start).days
        weeks_passed = days_since_start // 7
        next_due = start + timedelta(weeks=weeks_passed + 1)
        # 调整到周一
        next_due = next_due - timedelta(days=next_due.weekday())
        return next_due
    
    elif frequency_type == "monthly":
        # 每月1日提交
        if today.day == 1:
            return today
        else:
            # 下个月1日
            if today.month == 12:
                return datetime(today.year + 1, 1, 1).date()
            else:
                return datetime(today.year, today.month + 1, 1).date()
    
    elif frequency_type == "quarterly":
        # 每季度第一个月1日提交（1月、4月、7月、10月）
        quarter_months = [1, 4, 7, 10]
        current_quarter_start = max([m for m in quarter_months if m <= today.month])
        
        if today.month == current_quarter_start and today.day == 1:
            return today
        else:
            # 下个季度第一天
            next_quarter_month = quarter_months[(quarter_months.index(current_quarter_start) + 1) % 4]
            if next_quarter_month < today.month:
                return datetime(today.year + 1, next_quarter_month, 1).date()
            else:
                return datetime(today.year, next_quarter_month, 1).date()
    
    return today


@shared_task(name="inspection_spec.send_overdue_reminders")
async def send_overdue_reminders():
    """
    逾期报告提醒（预留功能）
    
    执行频率：每日上午 09:00
    
    逻辑：
    1. 查询所有逾期未提交的报告任务
    2. 发送催办通知给供应商
    3. 超过 7 天未提交，升级通知给 SQE
    
    待 ASN 发货数据流打通后启用
    """
    async with async_session_maker() as db:
        try:
            # TODO: 实现逾期提醒逻辑
            # 1. 查询逾期任务
            # 2. 发送催办通知
            # 3. 升级通知
            
            return {
                "status": "success",
                "message": "逾期报告提醒发送成功（预留功能）"
            }
        
        except Exception as e:
            return {
                "status": "error",
                "message": f"发送逾期报告提醒失败: {str(e)}"
            }

