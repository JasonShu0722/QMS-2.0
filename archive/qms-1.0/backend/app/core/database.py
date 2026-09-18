"""
数据库连接管理模块
提供异步数据库引擎和会话管理
"""
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.pool import NullPool

from app.core.config import settings

# 创建异步数据库引擎
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DB_ECHO,
    poolclass=NullPool,  # 使用 NullPool 避免连接池问题
    future=True,
)

# 创建异步会话工厂
AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


async def get_db() -> AsyncSession:
    """
    依赖注入函数：获取数据库会话
    
    用于 FastAPI 路由的依赖注入，自动管理会话生命周期。
    
    Yields:
        AsyncSession: 异步数据库会话
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


# 导出 Base 用于 Alembic 迁移
from app.models.base import Base

__all__ = ["engine", "AsyncSessionLocal", "get_db", "Base"]
