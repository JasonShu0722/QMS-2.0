"""
系统配置管理 API 测试
System Config API Tests - 测试系统全局配置管理接口
"""
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.system_config import SystemConfig
from app.services.system_config_service import SystemConfigService


@pytest.mark.asyncio
async def test_get_all_configs_empty(async_client: AsyncClient, db_session: AsyncSession):
    """测试获取所有配置（空列表）"""
    response = await async_client.get("/api/v1/admin/system-config")
    
    assert response.status_code == 200
    data = response.json()
    assert "total" in data
    assert "configs" in data
    assert data["total"] == 0
    assert len(data["configs"]) == 0


@pytest.mark.asyncio
async def test_create_config(async_client: AsyncClient, db_session: AsyncSession):
    """测试创建系统配置"""
    config_data = {
        "config_key": "test_max_upload_size",
        "config_value": {"value": 100, "unit": "MB"},
        "config_type": "object",
        "description": "测试文件上传大小限制",
        "category": "file_limit",
        "validation_rule": {
            "type": "object",
            "properties": {
                "value": {"type": "number", "minimum": 1, "maximum": 500},
                "unit": {"type": "string", "enum": ["MB", "GB"]}
            },
            "required": ["value", "unit"]
        }
    }
    
    response = await async_client.post("/api/v1/admin/system-config", json=config_data)
    
    assert response.status_code == 201
    data = response.json()
    assert data["config_key"] == "test_max_upload_size"
    assert data["config_value"] == {"value": 100, "unit": "MB"}
    assert data["config_type"] == "object"
    assert data["category"] == "file_limit"
    assert "id" in data
    assert "created_at" in data


@pytest.mark.asyncio
async def test_create_config_duplicate_key(async_client: AsyncClient, db_session: AsyncSession):
    """测试创建重复配置键（应失败）"""
    config_data = {
        "config_key": "duplicate_key",
        "config_value": {"value": 50},
        "config_type": "object",
        "category": "business_rule"
    }
    
    # 第一次创建
    response1 = await async_client.post("/api/v1/admin/system-config", json=config_data)
    assert response1.status_code == 201
    
    # 第二次创建（应失败）
    response2 = await async_client.post("/api/v1/admin/system-config", json=config_data)
    assert response2.status_code == 400
    assert "已存在" in response2.json()["detail"]


@pytest.mark.asyncio
async def test_get_config_by_key(async_client: AsyncClient, db_session: AsyncSession):
    """测试根据配置键获取配置"""
    # 先创建配置
    config = await SystemConfigService.create_config(
        db=db_session,
        config_key="test_session_timeout",
        config_value={"value": 24, "unit": "hours"},
        config_type="object",
        category="timeout",
        description="会话超时时长"
    )
    
    # 获取配置
    response = await async_client.get(f"/api/v1/admin/system-config/{config.config_key}")
    
    assert response.status_code == 200
    data = response.json()
    assert data["config_key"] == "test_session_timeout"
    assert data["config_value"] == {"value": 24, "unit": "hours"}
    assert data["category"] == "timeout"


@pytest.mark.asyncio
async def test_get_config_by_key_not_found(async_client: AsyncClient, db_session: AsyncSession):
    """测试获取不存在的配置"""
    response = await async_client.get("/api/v1/admin/system-config/nonexistent_key")
    
    assert response.status_code == 404
    assert "不存在" in response.json()["detail"]


@pytest.mark.asyncio
async def test_update_config(async_client: AsyncClient, db_session: AsyncSession):
    """测试更新系统配置"""
    # 先创建配置
    config = await SystemConfigService.create_config(
        db=db_session,
        config_key="test_password_expire",
        config_value={"value": 90, "unit": "days"},
        config_type="object",
        category="business_rule",
        description="密码过期天数"
    )
    
    # 更新配置
    update_data = {
        "config_value": {"value": 120, "unit": "days"},
        "description": "密码过期天数（已更新）"
    }
    
    response = await async_client.put(
        f"/api/v1/admin/system-config/{config.config_key}",
        json=update_data
    )
    
    assert response.status_code == 200
    data = response.json()
    assert data["config_value"] == {"value": 120, "unit": "days"}
    assert data["description"] == "密码过期天数（已更新）"


@pytest.mark.asyncio
async def test_update_config_not_found(async_client: AsyncClient, db_session: AsyncSession):
    """测试更新不存在的配置（应失败）"""
    update_data = {
        "config_value": {"value": 100}
    }
    
    response = await async_client.put(
        "/api/v1/admin/system-config/nonexistent_key",
        json=update_data
    )
    
    assert response.status_code == 400
    assert "不存在" in response.json()["detail"]


@pytest.mark.asyncio
async def test_delete_config(async_client: AsyncClient, db_session: AsyncSession):
    """测试删除系统配置"""
    # 先创建配置
    config = await SystemConfigService.create_config(
        db=db_session,
        config_key="test_delete_config",
        config_value={"value": 50},
        config_type="object",
        category="business_rule"
    )
    
    # 删除配置
    response = await async_client.delete(f"/api/v1/admin/system-config/{config.config_key}")
    
    assert response.status_code == 204
    
    # 验证配置已删除
    get_response = await async_client.get(f"/api/v1/admin/system-config/{config.config_key}")
    assert get_response.status_code == 404


@pytest.mark.asyncio
async def test_delete_config_not_found(async_client: AsyncClient, db_session: AsyncSession):
    """测试删除不存在的配置（应失败）"""
    response = await async_client.delete("/api/v1/admin/system-config/nonexistent_key")
    
    assert response.status_code == 404
    assert "不存在" in response.json()["detail"]


@pytest.mark.asyncio
async def test_get_configs_by_category(async_client: AsyncClient, db_session: AsyncSession):
    """测试按分类获取配置"""
    # 创建多个不同分类的配置
    await SystemConfigService.create_config(
        db=db_session,
        config_key="timeout_config_1",
        config_value={"value": 30},
        config_type="object",
        category="timeout"
    )
    
    await SystemConfigService.create_config(
        db=db_session,
        config_key="timeout_config_2",
        config_value={"value": 60},
        config_type="object",
        category="timeout"
    )
    
    await SystemConfigService.create_config(
        db=db_session,
        config_key="file_limit_config_1",
        config_value={"value": 50},
        config_type="object",
        category="file_limit"
    )
    
    # 获取按分类分组的配置
    response = await async_client.get("/api/v1/admin/system-config/by-category")
    
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) >= 2  # 至少有 timeout 和 file_limit 两个分类
    
    # 验证分类结构
    categories = {item["category"] for item in data}
    assert "timeout" in categories
    assert "file_limit" in categories
    
    # 验证 timeout 分类下有 2 个配置
    timeout_category = next(item for item in data if item["category"] == "timeout")
    assert len(timeout_category["configs"]) == 2


@pytest.mark.asyncio
async def test_filter_configs_by_category(async_client: AsyncClient, db_session: AsyncSession):
    """测试按分类过滤配置"""
    # 创建不同分类的配置
    await SystemConfigService.create_config(
        db=db_session,
        config_key="notification_config_1",
        config_value={"enabled": True},
        config_type="object",
        category="notification"
    )
    
    await SystemConfigService.create_config(
        db=db_session,
        config_key="business_rule_config_1",
        config_value={"value": 100},
        config_type="object",
        category="business_rule"
    )
    
    # 按分类过滤
    response = await async_client.get("/api/v1/admin/system-config?category=notification")
    
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 1
    assert data["configs"][0]["category"] == "notification"
    assert data["configs"][0]["config_key"] == "notification_config_1"


@pytest.mark.asyncio
async def test_clear_config_cache(async_client: AsyncClient, db_session: AsyncSession):
    """测试清除配置缓存"""
    response = await async_client.post("/api/v1/admin/system-config/cache/clear")
    
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert "缓存已清除" in data["message"]


@pytest.mark.asyncio
async def test_config_validation_rule(async_client: AsyncClient, db_session: AsyncSession):
    """测试配置验证规则"""
    # 创建带验证规则的配置
    config_data = {
        "config_key": "test_validated_config",
        "config_value": {"value": 50, "unit": "MB"},
        "config_type": "object",
        "category": "file_limit",
        "validation_rule": {
            "type": "object",
            "properties": {
                "value": {"type": "number", "minimum": 1, "maximum": 100},
                "unit": {"type": "string", "enum": ["MB", "GB"]}
            },
            "required": ["value", "unit"]
        }
    }
    
    response = await async_client.post("/api/v1/admin/system-config", json=config_data)
    
    assert response.status_code == 201
    data = response.json()
    assert data["validation_rule"] is not None
    assert data["validation_rule"]["type"] == "object"


@pytest.mark.asyncio
async def test_config_immediate_effect_after_update(async_client: AsyncClient, db_session: AsyncSession):
    """测试配置更新后立即生效（清除缓存）"""
    # 创建配置
    config = await SystemConfigService.create_config(
        db=db_session,
        config_key="test_immediate_effect",
        config_value={"value": 100},
        config_type="object",
        category="business_rule"
    )
    
    # 第一次获取（会缓存）
    response1 = await async_client.get(f"/api/v1/admin/system-config/{config.config_key}")
    assert response1.status_code == 200
    assert response1.json()["config_value"] == {"value": 100}
    
    # 更新配置
    update_data = {"config_value": {"value": 200}}
    response2 = await async_client.put(
        f"/api/v1/admin/system-config/{config.config_key}",
        json=update_data
    )
    assert response2.status_code == 200
    
    # 再次获取（应该是更新后的值，说明缓存已清除）
    response3 = await async_client.get(f"/api/v1/admin/system-config/{config.config_key}")
    assert response3.status_code == 200
    assert response3.json()["config_value"] == {"value": 200}


@pytest.mark.asyncio
async def test_default_value_mechanism(async_client: AsyncClient, db_session: AsyncSession):
    """测试配置默认值机制"""
    # 尝试获取不存在但有默认值的配置
    response = await async_client.get("/api/v1/admin/system-config/max_file_upload_size")
    
    # 应该返回 404，但错误信息中包含默认值
    assert response.status_code == 404
    assert "默认值" in response.json()["detail"]
    assert "50" in response.json()["detail"]  # 默认值是 50 MB


@pytest.mark.asyncio
async def test_config_categories(async_client: AsyncClient, db_session: AsyncSession):
    """测试配置分类管理"""
    categories = ["business_rule", "timeout", "file_limit", "notification"]
    
    # 为每个分类创建配置
    for i, category in enumerate(categories):
        await SystemConfigService.create_config(
            db=db_session,
            config_key=f"test_{category}_config",
            config_value={"value": i * 10},
            config_type="object",
            category=category
        )
    
    # 获取所有配置
    response = await async_client.get("/api/v1/admin/system-config")
    
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == len(categories)
    
    # 验证所有分类都存在
    config_categories = {config["category"] for config in data["configs"]}
    assert config_categories == set(categories)
