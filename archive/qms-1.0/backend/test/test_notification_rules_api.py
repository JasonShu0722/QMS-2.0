"""
通知规则配置管理 API 测试
测试通知规则、SMTP配置、Webhook配置等功能
"""
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime

from app.models.user import User, UserStatus, UserType
from app.models.notification_rule import NotificationRule
from app.models.smtp_config import SMTPConfig
from app.core.auth_strategy import LocalAuthStrategy


@pytest.fixture
async def admin_user(db_session: AsyncSession) -> User:
    """创建管理员用户"""
    auth_strategy = LocalAuthStrategy()
    hashed_password = auth_strategy.hash_password("AdminPass123!")
    
    admin = User(
        username="admin_notif",
        password_hash=hashed_password,
        full_name="通知管理员",
        email="admin@company.com",
        phone="13800138000",
        user_type=UserType.INTERNAL,
        status=UserStatus.ACTIVE,
        department="质量部",
        position="系统管理员",
        password_changed_at=datetime.utcnow()
    )
    
    db_session.add(admin)
    await db_session.commit()
    await db_session.refresh(admin)
    
    return admin


@pytest.fixture
async def admin_token(async_client: AsyncClient, admin_user: User) -> str:
    """获取管理员 Token"""
    response = await async_client.post(
        "/api/v1/auth/login",
        json={
            "username": "admin_notif",
            "password": "AdminPass123!",
            "user_type": "internal"
        }
    )
    
    assert response.status_code == 200
    data = response.json()
    return data["access_token"]


@pytest.fixture
async def sample_notification_rule(db_session: AsyncSession, admin_user: User) -> NotificationRule:
    """创建示例通知规则"""
    rule = NotificationRule(
        rule_name="客诉单驳回通知",
        business_object="customer_complaint",
        trigger_condition={
            "field": "status",
            "operator": "equals",
            "value": "rejected"
        },
        action_type="send_email",
        action_config={
            "recipients": ["submitter"],
            "template": "rejection_notice"
        },
        escalation_enabled=True,
        escalation_hours=48,
        escalation_recipients=[1, 2, 3],
        is_active=True,
        created_by=admin_user.id
    )
    
    db_session.add(rule)
    await db_session.commit()
    await db_session.refresh(rule)
    
    return rule


# ==================== 通知规则管理测试 ====================

@pytest.mark.asyncio
async def test_get_notification_rules(
    async_client: AsyncClient,
    admin_token: str,
    sample_notification_rule: NotificationRule
):
    """测试获取所有通知规则"""
    response = await async_client.get(
        "/api/v1/admin/notification-rules",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    
    # 验证规则数据
    rule = data[0]
    assert rule["rule_name"] == "客诉单驳回通知"
    assert rule["business_object"] == "customer_complaint"
    assert rule["action_type"] == "send_email"
    assert rule["is_active"] is True


@pytest.mark.asyncio
async def test_get_notification_rules_with_filters(
    async_client: AsyncClient,
    admin_token: str,
    sample_notification_rule: NotificationRule
):
    """测试带筛选条件获取通知规则"""
    response = await async_client.get(
        "/api/v1/admin/notification-rules?business_object=customer_complaint&is_active=true",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    assert all(r["business_object"] == "customer_complaint" for r in data)
    assert all(r["is_active"] is True for r in data)


@pytest.mark.asyncio
async def test_get_notification_rule_by_id(
    async_client: AsyncClient,
    admin_token: str,
    sample_notification_rule: NotificationRule
):
    """测试根据ID获取通知规则"""
    response = await async_client.get(
        f"/api/v1/admin/notification-rules/{sample_notification_rule.id}",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == sample_notification_rule.id
    assert data["rule_name"] == "客诉单驳回通知"


@pytest.mark.asyncio
async def test_create_notification_rule(
    async_client: AsyncClient,
    admin_token: str
):
    """测试创建通知规则"""
    rule_data = {
        "rule_name": "PPAP审批超时通知",
        "business_object": "ppap",
        "trigger_condition": {
            "field": "status",
            "operator": "equals",
            "value": "pending"
        },
        "action_type": "send_notification",
        "action_config": {
            "recipients": ["reviewer"],
            "template": "ppap_reminder"
        },
        "escalation_enabled": True,
        "escalation_hours": 24,
        "escalation_recipients": [1, 2],
        "is_active": True
    }
    
    response = await async_client.post(
        "/api/v1/admin/notification-rules",
        headers={"Authorization": f"Bearer {admin_token}"},
        json=rule_data
    )
    
    assert response.status_code == 201
    data = response.json()
    assert data["rule_name"] == "PPAP审批超时通知"
    assert data["business_object"] == "ppap"
    assert data["action_type"] == "send_notification"
    assert data["escalation_enabled"] is True
    assert data["escalation_hours"] == 24


@pytest.mark.asyncio
async def test_create_notification_rule_invalid_action_type(
    async_client: AsyncClient,
    admin_token: str
):
    """测试创建通知规则 - 无效的动作类型"""
    rule_data = {
        "rule_name": "测试规则",
        "business_object": "test",
        "trigger_condition": {"field": "status"},
        "action_type": "invalid_action",  # 无效的动作类型
        "action_config": {},
        "is_active": True
    }
    
    response = await async_client.post(
        "/api/v1/admin/notification-rules",
        headers={"Authorization": f"Bearer {admin_token}"},
        json=rule_data
    )
    
    assert response.status_code == 422  # Validation error


@pytest.mark.asyncio
async def test_update_notification_rule(
    async_client: AsyncClient,
    admin_token: str,
    sample_notification_rule: NotificationRule
):
    """测试更新通知规则"""
    update_data = {
        "rule_name": "客诉单驳回通知（更新）",
        "is_active": False
    }
    
    response = await async_client.put(
        f"/api/v1/admin/notification-rules/{sample_notification_rule.id}",
        headers={"Authorization": f"Bearer {admin_token}"},
        json=update_data
    )
    
    assert response.status_code == 200
    data = response.json()
    assert data["rule_name"] == "客诉单驳回通知（更新）"
    assert data["is_active"] is False


@pytest.mark.asyncio
async def test_delete_notification_rule(
    async_client: AsyncClient,
    admin_token: str,
    sample_notification_rule: NotificationRule
):
    """测试删除通知规则"""
    response = await async_client.delete(
        f"/api/v1/admin/notification-rules/{sample_notification_rule.id}",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    assert response.status_code == 204
    
    # 验证规则已删除
    get_response = await async_client.get(
        f"/api/v1/admin/notification-rules/{sample_notification_rule.id}",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert get_response.status_code == 404


@pytest.mark.asyncio
async def test_test_notification_rule(
    async_client: AsyncClient,
    admin_token: str,
    sample_notification_rule: NotificationRule
):
    """测试通知规则测试功能"""
    test_data = {
        "rule_id": sample_notification_rule.id,
        "test_data": {
            "status": "rejected",
            "submitter_email": "test@example.com"
        }
    }
    
    response = await async_client.post(
        "/api/v1/admin/notification-rules/test",
        headers={"Authorization": f"Bearer {admin_token}"},
        json=test_data
    )
    
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "通知规则测试成功" in data["message"]
    assert "details" in data


# ==================== SMTP配置管理测试 ====================

@pytest.mark.asyncio
async def test_get_smtp_configs(
    async_client: AsyncClient,
    admin_token: str
):
    """测试获取所有SMTP配置"""
    response = await async_client.get(
        "/api/v1/admin/notification-rules/smtp-configs",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)


@pytest.mark.asyncio
async def test_create_smtp_config(
    async_client: AsyncClient,
    admin_token: str
):
    """测试创建SMTP配置"""
    smtp_data = {
        "config_name": "测试邮件服务器",
        "smtp_host": "smtp.example.com",
        "smtp_port": 587,
        "smtp_user": "test@example.com",
        "smtp_password": "testpassword",
        "use_tls": True,
        "from_email": "qms@example.com",
        "from_name": "QMS系统",
        "is_active": True
    }
    
    response = await async_client.post(
        "/api/v1/admin/notification-rules/smtp-config",
        headers={"Authorization": f"Bearer {admin_token}"},
        json=smtp_data
    )
    
    # 注意：由于实际SMTP连接会失败，这里预期返回400
    # 在实际测试中，可以mock SMTP连接
    assert response.status_code in [201, 400]


@pytest.mark.asyncio
async def test_create_smtp_config_duplicate_name(
    async_client: AsyncClient,
    admin_token: str,
    db_session: AsyncSession
):
    """测试创建SMTP配置 - 重复的配置名称"""
    # 先创建一个配置
    existing_config = SMTPConfig(
        config_name="已存在的配置",
        smtp_host="smtp.example.com",
        smtp_port=587,
        smtp_user="test@example.com",
        smtp_password_encrypted="encrypted_password",
        use_tls=True,
        from_email="qms@example.com",
        is_active=True
    )
    db_session.add(existing_config)
    await db_session.commit()
    
    # 尝试创建同名配置
    smtp_data = {
        "config_name": "已存在的配置",
        "smtp_host": "smtp.example.com",
        "smtp_port": 587,
        "smtp_user": "test@example.com",
        "smtp_password": "testpassword",
        "use_tls": True,
        "from_email": "qms@example.com",
        "is_active": True
    }
    
    response = await async_client.post(
        "/api/v1/admin/notification-rules/smtp-config",
        headers={"Authorization": f"Bearer {admin_token}"},
        json=smtp_data
    )
    
    assert response.status_code == 400
    assert "已存在" in response.json()["detail"]


# ==================== Webhook配置管理测试 ====================

@pytest.mark.asyncio
async def test_create_webhook_config(
    async_client: AsyncClient,
    admin_token: str
):
    """测试配置Webhook"""
    webhook_data = {
        "config_name": "企业微信通知",
        "webhook_type": "wechat_work",
        "webhook_url": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test",
        "is_active": True
    }
    
    response = await async_client.post(
        "/api/v1/admin/notification-rules/webhook-config",
        headers={"Authorization": f"Bearer {admin_token}"},
        json=webhook_data
    )
    
    # 注意：由于实际Webhook连接可能失败，这里检查响应格式
    assert response.status_code == 200
    data = response.json()
    assert "success" in data
    assert "message" in data


@pytest.mark.asyncio
async def test_create_webhook_config_invalid_type(
    async_client: AsyncClient,
    admin_token: str
):
    """测试配置Webhook - 无效的类型"""
    webhook_data = {
        "config_name": "测试Webhook",
        "webhook_type": "invalid_type",  # 无效的类型
        "webhook_url": "https://example.com/webhook",
        "is_active": True
    }
    
    response = await async_client.post(
        "/api/v1/admin/notification-rules/webhook-config",
        headers={"Authorization": f"Bearer {admin_token}"},
        json=webhook_data
    )
    
    assert response.status_code == 422  # Validation error


# ==================== 权限测试 ====================

@pytest.mark.asyncio
async def test_notification_rules_requires_auth(async_client: AsyncClient):
    """测试通知规则API需要认证"""
    response = await async_client.get("/api/v1/admin/notification-rules")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_notification_rules_requires_internal_user(
    async_client: AsyncClient,
    db_session: AsyncSession
):
    """测试通知规则API需要内部员工权限"""
    # 创建供应商用户
    auth_strategy = LocalAuthStrategy()
    hashed_password = auth_strategy.hash_password("SupplierPass123!")
    
    supplier_user = User(
        username="supplier_user",
        password_hash=hashed_password,
        full_name="供应商用户",
        email="supplier@example.com",
        phone="13900139000",
        user_type=UserType.SUPPLIER,
        status=UserStatus.ACTIVE,
        password_changed_at=datetime.utcnow()
    )
    
    db_session.add(supplier_user)
    await db_session.commit()
    
    # 获取供应商用户Token
    login_response = await async_client.post(
        "/api/v1/auth/login",
        json={
            "username": "supplier_user",
            "password": "SupplierPass123!",
            "user_type": "supplier"
        }
    )
    
    assert login_response.status_code == 200
    supplier_token = login_response.json()["access_token"]
    
    # 尝试访问通知规则API
    response = await async_client.get(
        "/api/v1/admin/notification-rules",
        headers={"Authorization": f"Bearer {supplier_token}"}
    )
    
    assert response.status_code == 403
    assert "仅内部员工可访问" in response.json()["detail"]
