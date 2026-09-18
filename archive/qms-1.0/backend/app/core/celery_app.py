"""
Celery 应用配置
Celery Application - 异步任务队列配置
"""
from celery import Celery
from celery.schedules import crontab

from app.core.config import settings


# 创建 Celery 应用实例
celery_app = Celery(
    "qms_tasks",
    broker=settings.CELERY_BROKER_URL or settings.REDIS_URL,
    backend=settings.CELERY_RESULT_BACKEND or settings.REDIS_URL,
    include=[
        "app.tasks.ims_sync_tasks",
        "app.tasks.audit_nc_tasks"
    ]  # 导入任务模块
)

# Celery 配置
celery_app.conf.update(
    # 时区设置
    timezone="Asia/Shanghai",
    enable_utc=True,
    
    # 任务结果配置
    result_expires=3600,  # 结果保留1小时
    task_track_started=True,
    task_time_limit=30 * 60,  # 任务超时时间：30分钟
    task_soft_time_limit=25 * 60,  # 软超时：25分钟
    
    # 任务序列化
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    
    # Worker 配置
    worker_prefetch_multiplier=1,  # 每次只预取1个任务
    worker_max_tasks_per_child=1000,  # Worker 处理1000个任务后重启
    
    # 定时任务配置
    beat_schedule={
        # 每日凌晨 02:00 同步 IMS 数据
        "sync-ims-data-daily": {
            "task": "app.tasks.ims_sync_tasks.sync_ims_data_daily",
            "schedule": crontab(hour=2, minute=0),  # 每天凌晨 02:00
            "args": (),
        },
        # 每天早上 09:00 检查逾期NC
        "check-overdue-ncs-morning": {
            "task": "app.tasks.audit_nc_tasks.check_overdue_ncs",
            "schedule": crontab(hour=9, minute=0),  # 每天早上 09:00
            "args": (),
        },
        # 每天下午 15:00 检查逾期NC
        "check-overdue-ncs-afternoon": {
            "task": "app.tasks.audit_nc_tasks.check_overdue_ncs",
            "schedule": crontab(hour=15, minute=0),  # 每天下午 15:00
            "args": (),
        },
    },
)


# 任务路由配置（可选）
celery_app.conf.task_routes = {
    "app.tasks.ims_sync_tasks.*": {"queue": "ims_sync"},
    "app.tasks.audit_nc_tasks.*": {"queue": "audit_nc"},
}


if __name__ == "__main__":
    celery_app.start()
