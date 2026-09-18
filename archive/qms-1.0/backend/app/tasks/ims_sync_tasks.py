"""
IMS 数据同步定时任务
IMS Sync Tasks - Celery 定时任务，每日凌晨 02:00 同步数据
"""
from datetime import date, timedelta
from celery import Task
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
import asyncio

from app.core.celery_app import celery_app
from app.core.config import settings
from app.services.ims_integration_service import ims_integration_service


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
    name="app.tasks.ims_sync_tasks.sync_ims_data_daily",
    base=AsyncTask,
    bind=True,
    max_retries=3,
    default_retry_delay=300  # 失败后5分钟重试
)
async def sync_ims_data_daily(self) -> dict:
    """
    每日 IMS 数据同步任务
    
    执行时间：每天凌晨 02:00
    
    功能：
    - 同步昨天的入库检验数据
    - 同步昨天的成品产出数据
    - 同步昨天的制程测试数据
    
    Returns:
        dict: 同步结果汇总
    """
    print("=" * 60)
    print("🚀 开始执行 IMS 数据同步定时任务")
    print(f"⏰ 执行时间: {date.today()}")
    print("=" * 60)
    
    # 创建数据库会话
    async with AsyncSessionLocal() as db:
        try:
            # 同步昨天的数据
            target_date = date.today() - timedelta(days=1)
            
            # 调用 IMS 集成服务
            result = await ims_integration_service.sync_all_data(
                db=db,
                target_date=target_date
            )
            
            # 打印同步结果
            print("\n📊 同步结果汇总:")
            print(f"  - 入库检验: {result['incoming_inspection']['records_count']} 条")
            print(f"  - 成品产出: {result['production_output']['records_count']} 条")
            print(f"  - 制程测试: {result['process_test']['records_count']} 条")
            print(f"  - 整体状态: {'✅ 成功' if result['overall_success'] else '❌ 失败'}")
            print("=" * 60)
            
            return result
            
        except Exception as e:
            error_message = f"IMS 数据同步任务失败: {str(e)}"
            print(f"❌ {error_message}")
            
            # 重试任务
            try:
                raise self.retry(exc=e)
            except Exception:
                # 如果重试次数已用完，返回错误结果
                return {
                    "success": False,
                    "error": error_message,
                    "date": target_date.isoformat()
                }


@celery_app.task(
    name="app.tasks.ims_sync_tasks.sync_ims_data_manual",
    base=AsyncTask,
    bind=True
)
async def sync_ims_data_manual(self, target_date_str: str) -> dict:
    """
    手动触发 IMS 数据同步任务
    
    用途：
    - 补录历史数据
    - 重新同步失败的日期
    
    Args:
        target_date_str: 目标日期字符串 (格式: YYYY-MM-DD)
    
    Returns:
        dict: 同步结果汇总
    """
    print(f"🔄 手动触发 IMS 数据同步: {target_date_str}")
    
    # 解析日期
    try:
        target_date = date.fromisoformat(target_date_str)
    except ValueError as e:
        error_message = f"日期格式错误: {target_date_str}，应为 YYYY-MM-DD"
        print(f"❌ {error_message}")
        return {
            "success": False,
            "error": error_message
        }
    
    # 创建数据库会话
    async with AsyncSessionLocal() as db:
        try:
            # 调用 IMS 集成服务
            result = await ims_integration_service.sync_all_data(
                db=db,
                target_date=target_date
            )
            
            print(f"✅ 手动同步完成: {target_date_str}")
            return result
            
        except Exception as e:
            error_message = f"手动同步失败: {str(e)}"
            print(f"❌ {error_message}")
            return {
                "success": False,
                "error": error_message,
                "date": target_date_str
            }


# 修复 AsyncTask 的 run_async 实现
AsyncTask.run_async = lambda self, *args, **kwargs: self.run(*args, **kwargs)
