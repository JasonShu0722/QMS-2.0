"""
Pytest 配置和共享 Fixtures
"""
import pytest
import asyncio
from typing import AsyncGenerator
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.pool import StaticPool
from datetime import datetime

from app.main import app
from app.core.database import get_db
from app.models.base import Base
from app.models.user import User, UserType, UserStatus
from app.core.auth_strategy import LocalAuthStrategy


# 测试数据库 URL（使用 SQLite 内存数据库）
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"


@pytest.fixture(scope="session")
def event_loop():
    """创建事件循环"""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="function")
async def db_engine():
    """创建测试数据库引擎"""
    engine = create_async_engine(
        TEST_DATABASE_URL,
        echo=False,
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    
    # 创建所有表
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    yield engine
    
    # 清理：删除所有表
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    
    await engine.dispose()


@pytest.fixture(scope="function")
async def db_session(db_engine) -> AsyncGenerator[AsyncSession, None]:
    """创建测试数据库会话"""
    async_session = async_sessionmaker(
        db_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    
    async with async_session() as session:
        yield session


@pytest.fixture(scope="function")
async def async_db_session(db_session: AsyncSession) -> AsyncSession:
    """别名：用于某些测试中更清晰的命名"""
    return db_session


@pytest.fixture(scope="function")
async def test_user(db_session: AsyncSession) -> User:
    """创建测试用户"""
    auth_strategy = LocalAuthStrategy()
    
    user = User(
        username="testuser",
        password_hash=auth_strategy.hash_password("Test@1234"),
        full_name="测试用户",
        email="test@example.com",
        phone="13800138000",
        user_type=UserType.INTERNAL,
        status=UserStatus.ACTIVE,
        department="质量部",
        position="质量工程师",
        password_changed_at=datetime.utcnow(),
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    
    return user


@pytest.fixture(scope="function")
async def test_user_token(test_user: User) -> str:
    """创建测试用户的 JWT Token"""
    auth_strategy = LocalAuthStrategy()
    token = auth_strategy.create_access_token(test_user.id)
    return token


@pytest.fixture(scope="function")
async def async_client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """创建测试 HTTP 客户端"""
    
    # 覆盖依赖注入
    async def override_get_db():
        yield db_session
    
    app.dependency_overrides[get_db] = override_get_db
    
    transport = ASGITransport(app=app)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client
    
    # 清理依赖覆盖
    app.dependency_overrides.clear()
