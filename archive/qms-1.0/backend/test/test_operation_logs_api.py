"""
操作日志 API 测试
Test Operation Logs API
"""
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timedelta

from app.models.user import User, UserType, UserStatus
from app.models.operation_log import OperationLog
from app.core.auth_strategy import LocalAuthStrategy


@pytest.fixture
async def test_user(db_session: AsyncSession) -> User:
    """创建测试用户"""
    auth_strategy = LocalAuthStrategy()
    hashed_password = auth_strategy.hash_password("Test@1234")
    
    user = User(
        username="testuser",
        password_hash=hashed_password,
        full_name="Test User",
        email="test@example.com",
        phone="13800138000",
        user_type=UserType.INTERNAL,
        status=UserStatus.ACTIVE,
        department="Quality",
        position="QE",
        password_changed_at=datetime.utcnow(),
    )
    
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    
    return user


@pytest.fixture
async def auth_token(test_user: User) -> str:
    """生成测试用户的 JWT Token"""
    auth_strategy = LocalAuthStrategy()
    token = auth_strategy.create_access_token(test_user.id)
    return token


@pytest.fixture
async def test_operation_logs(db_session: AsyncSession, test_user: User) -> list[OperationLog]:
    """创建测试操作日志"""
    logs = [
        OperationLog(
            user_id=test_user.id,
            operation_type="create",
            target_module="users",
            target_id=1,
            before_data=None,
            after_data={"username": "newuser", "email": "new@example.com"},
            ip_address="192.168.1.100",
            user_agent="Mozilla/5.0",
            created_at=datetime.utcnow() - timedelta(days=2),
        ),
        OperationLog(
            user_id=test_user.id,
            operation_type="update",
            target_module="users",
            target_id=1,
            before_data={"email": "old@example.com"},
            after_data={"email": "new@example.com"},
            ip_address="192.168.1.100",
            user_agent="Mozilla/5.0",
            created_at=datetime.utcnow() - timedelta(days=1),
        ),
        OperationLog(
            user_id=test_user.id,
            operation_type="delete",
            target_module="permissions",
            target_id=5,
            before_data={"user_id": 1, "module_path": "test.module"},
            after_data=None,
            ip_address="192.168.1.101",
            user_agent="Chrome/90.0",
            created_at=datetime.utcnow(),
        ),
    ]
    
    for log in logs:
        db_session.add(log)
    
    await db_session.commit()
    
    return logs


@pytest.mark.asyncio
async def test_get_operation_logs_list(
    async_client: AsyncClient,
    auth_token: str,
    test_operation_logs: list[OperationLog],
):
    """测试获取操作日志列表"""
    response = await async_client.get(
        "/api/v1/admin/operation-logs",
        headers={"Authorization": f"Bearer {auth_token}"},
    )
    
    assert response.status_code == 200
    data = response.json()
    
    assert "total" in data
    assert "page" in data
    assert "page_size" in data
    assert "items" in data
    
    assert data["total"] == 3
    assert data["page"] == 1
    assert len(data["items"]) == 3
    
    # 验证日志按时间倒序排列
    items = data["items"]
    assert items[0]["operation_type"] == "delete"
    assert items[1]["operation_type"] == "update"
    assert items[2]["operation_type"] == "create"


@pytest.mark.asyncio
async def test_get_operation_logs_with_filters(
    async_client: AsyncClient,
    auth_token: str,
    test_operation_logs: list[OperationLog],
):
    """测试带筛选条件的操作日志查询"""
    # 按操作类型筛选
    response = await async_client.get(
        "/api/v1/admin/operation-logs?operation_type=create",
        headers={"Authorization": f"Bearer {auth_token}"},
    )
    
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 1
    assert data["items"][0]["operation_type"] == "create"
    
    # 按目标模块筛选
    response = await async_client.get(
        "/api/v1/admin/operation-logs?target_module=users",
        headers={"Authorization": f"Bearer {auth_token}"},
    )
    
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 2
    
    # 按用户ID筛选
    response = await async_client.get(
        f"/api/v1/admin/operation-logs?user_id={test_operation_logs[0].user_id}",
        headers={"Authorization": f"Bearer {auth_token}"},
    )
    
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 3


@pytest.mark.asyncio
async def test_get_operation_logs_pagination(
    async_client: AsyncClient,
    auth_token: str,
    test_operation_logs: list[OperationLog],
):
    """测试操作日志分页"""
    # 第一页，每页2条
    response = await async_client.get(
        "/api/v1/admin/operation-logs?page=1&page_size=2",
        headers={"Authorization": f"Bearer {auth_token}"},
    )
    
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 3
    assert data["page"] == 1
    assert data["page_size"] == 2
    assert len(data["items"]) == 2
    
    # 第二页
    response = await async_client.get(
        "/api/v1/admin/operation-logs?page=2&page_size=2",
        headers={"Authorization": f"Bearer {auth_token}"},
    )
    
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 3
    assert data["page"] == 2
    assert len(data["items"]) == 1


@pytest.mark.asyncio
async def test_get_operation_log_detail(
    async_client: AsyncClient,
    auth_token: str,
    test_operation_logs: list[OperationLog],
):
    """测试获取操作日志详情"""
    log_id = test_operation_logs[1].id  # update 操作
    
    response = await async_client.get(
        f"/api/v1/admin/operation-logs/{log_id}",
        headers={"Authorization": f"Bearer {auth_token}"},
    )
    
    assert response.status_code == 200
    data = response.json()
    
    assert data["id"] == log_id
    assert data["operation_type"] == "update"
    assert data["target_module"] == "users"
    assert data["before_data"] == {"email": "old@example.com"}
    assert data["after_data"] == {"email": "new@example.com"}
    
    # 验证 diff 计算
    assert "data_diff" in data
    diff = data["data_diff"]
    assert "modified" in diff
    assert "email" in diff["modified"]
    assert diff["modified"]["email"]["old"] == "old@example.com"
    assert diff["modified"]["email"]["new"] == "new@example.com"


@pytest.mark.asyncio
async def test_get_operation_log_detail_not_found(
    async_client: AsyncClient,
    auth_token: str,
):
    """测试获取不存在的操作日志"""
    response = await async_client.get(
        "/api/v1/admin/operation-logs/99999",
        headers={"Authorization": f"Bearer {auth_token}"},
    )
    
    assert response.status_code == 404
    assert "操作日志不存在" in response.json()["detail"]


@pytest.mark.asyncio
async def test_get_operation_logs_unauthorized(async_client: AsyncClient):
    """测试未认证访问操作日志"""
    response = await async_client.get("/api/v1/admin/operation-logs")
    
    assert response.status_code == 403  # HTTPBearer 返回 403


@pytest.mark.asyncio
async def test_operation_log_diff_calculation():
    """测试 diff 计算逻辑"""
    from app.api.v1.admin.operation_logs import _calculate_diff
    
    # 测试修改字段
    before = {"name": "old", "email": "old@example.com", "age": 25}
    after = {"name": "new", "email": "old@example.com", "age": 30}
    
    diff = _calculate_diff(before, after)
    assert diff is not None
    assert "name" in diff["modified"]
    assert "age" in diff["modified"]
    assert diff["modified"]["name"]["old"] == "old"
    assert diff["modified"]["name"]["new"] == "new"
    
    # 测试新增字段
    before = {"name": "test"}
    after = {"name": "test", "email": "new@example.com"}
    
    diff = _calculate_diff(before, after)
    assert "email" in diff["added"]
    assert diff["added"]["email"] == "new@example.com"
    
    # 测试删除字段
    before = {"name": "test", "email": "old@example.com"}
    after = {"name": "test"}
    
    diff = _calculate_diff(before, after)
    assert "email" in diff["removed"]
    assert diff["removed"]["email"] == "old@example.com"
    
    # 测试无变更
    before = {"name": "test"}
    after = {"name": "test"}
    
    diff = _calculate_diff(before, after)
    assert diff is None
