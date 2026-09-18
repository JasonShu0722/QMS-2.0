"""
供应商绩效评价定时任务
Supplier Performance Tasks - Celery定时任务
"""
from datetime import datetime
from celery import shared_task
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.services.supplier_performance_service import SupplierPerformanceService


# 创建异步数据库引擎
async_engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    future=True
)

AsyncSessionLocal = sessionmaker(
    async_engine,
    class_=AsyncSession,
    expire_on_commit=False
)


@shared_task(name="calculate_monthly_supplier_performances")
def calculate_monthly_supplier_performances():
    """
    每月1日自动计算所有供应商的绩效
    
    Celery Beat 配置示例：
    CELERY_BEAT_SCHEDULE = {
        'calculate-monthly-performances': {
            'task': 'calculate_monthly_supplier_performances',
            'schedule': crontab(day_of_month='1', hour='2', minute='0'),  # 每月1日凌晨2点
        },
    }
    """
    import asyncio
    
    async def _calculate():
        async with AsyncSessionLocal() as db:
            # 获取当前年月
            now = datetime.utcnow()
            year = now.year
            month = now.month
            
            # 如果是1月，计算上一年12月的数据
            if month == 1:
                year -= 1
                month = 12
            else:
                month -= 1
            
            # 批量计算绩效
            result = await SupplierPerformanceService.batch_calculate_monthly_performances(
                db, year, month
            )
            
            return result
    
    # 运行异步任务
    result = asyncio.run(_calculate())
    
    return {
        "task": "calculate_monthly_supplier_performances",
        "status": "completed",
        "year": result.get("year"),
        "month": result.get("month"),
        "success_count": result.get("success_count", 0),
        "failed_count": result.get("failed_count", 0),
        "failed_suppliers": result.get("failed_suppliers", [])
    }


@shared_task(name="recalculate_supplier_performance")
def recalculate_supplier_performance(supplier_id: int, year: int, month: int):
    """
    重新计算指定供应商的绩效
    
    用于手动触发或数据修正
    """
    import asyncio
    
    async def _recalculate():
        async with AsyncSessionLocal() as db:
            performance = await SupplierPerformanceService.calculate_and_save_performance(
                db, supplier_id, year, month
            )
            return performance.to_dict()
    
    result = asyncio.run(_recalculate())
    
    return {
        "task": "recalculate_supplier_performance",
        "status": "completed",
        "supplier_id": supplier_id,
        "year": year,
        "month": month,
        "performance": result
    }
