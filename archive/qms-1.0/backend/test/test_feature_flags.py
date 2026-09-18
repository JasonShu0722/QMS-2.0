"""
功能特性开关测试
Feature Flags Tests - 测试功能开关服务和API
"""
import pytest
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.feature_flag import FeatureFlag, FeatureFlagScope, FeatureFlagEnvironment
from app.services.feature_flag_service import FeatureFlagService

pytestmark = pytest.mark.foundation_smoke


@pytest.mark.asyncio
async def test_create_feature_flag(db_session: AsyncSession):
    """测试创建功能开关"""
    # 创建功能开关
    flag = await FeatureFlagService.create_feature_flag(
        db=db_session,
        feature_key="test_feature",
        feature_name="测试功能",
        description="这是一个测试功能",
        is_enabled=True,
        scope="global",
        environment="stable"
    )
    
    assert flag.id is not None
    assert flag.feature_key == "test_feature"
    assert flag.feature_name == "测试功能"
    assert flag.is_enabled is True
    assert flag.scope == FeatureFlagScope.GLOBAL


@pytest.mark.asyncio
async def test_is_feature_enabled_global(db_session: AsyncSession):
    """测试全局功能开关"""
    # 创建全局启用的功能
    await FeatureFlagService.create_feature_flag(
        db=db_session,
        feature_key="global_feature",
        feature_name="全局功能",
        is_enabled=True,
        scope="global",
        environment="stable"
    )
    
    # 检查任意用户都能访问
    is_enabled = await FeatureFlagService.is_feature_enabled(
        db=db_session,
        feature_key="global_feature",
        user_id=1,
        environment="stable"
    )
    
    assert is_enabled is True
    
    # 检查另一个用户也能访问
    is_enabled = await FeatureFlagService.is_feature_enabled(
        db=db_session,
        feature_key="global_feature",
        user_id=999,
        environment="stable"
    )
    
    assert is_enabled is True


@pytest.mark.asyncio
async def test_is_feature_enabled_whitelist(db_session: AsyncSession):
    """测试白名单功能开关"""
    # 创建白名单功能
    await FeatureFlagService.create_feature_flag(
        db=db_session,
        feature_key="whitelist_feature",
        feature_name="白名单功能",
        is_enabled=True,
        scope="whitelist",
        whitelist_user_ids=[1, 2, 3],
        whitelist_supplier_ids=[10, 20],
        environment="stable"
    )
    
    # 白名单用户可以访问
    is_enabled = await FeatureFlagService.is_feature_enabled(
        db=db_session,
        feature_key="whitelist_feature",
        user_id=1,
        environment="stable"
    )
    assert is_enabled is True
    
    # 非白名单用户不能访问
    is_enabled = await FeatureFlagService.is_feature_enabled(
        db=db_session,
        feature_key="whitelist_feature",
        user_id=999,
        environment="stable"
    )
    assert is_enabled is False
    
    # 白名单供应商可以访问
    is_enabled = await FeatureFlagService.is_feature_enabled(
        db=db_session,
        feature_key="whitelist_feature",
        supplier_id=10,
        environment="stable"
    )
    assert is_enabled is True
    
    # 非白名单供应商不能访问
    is_enabled = await FeatureFlagService.is_feature_enabled(
        db=db_session,
        feature_key="whitelist_feature",
        supplier_id=999,
        environment="stable"
    )
    assert is_enabled is False


@pytest.mark.asyncio
async def test_is_feature_disabled(db_session: AsyncSession):
    """测试禁用的功能开关"""
    # 创建禁用的功能
    await FeatureFlagService.create_feature_flag(
        db=db_session,
        feature_key="disabled_feature",
        feature_name="禁用功能",
        is_enabled=False,
        scope="global",
        environment="stable"
    )
    
    # 即使是全局作用域，禁用的功能也不能访问
    is_enabled = await FeatureFlagService.is_feature_enabled(
        db=db_session,
        feature_key="disabled_feature",
        user_id=1,
        environment="stable"
    )
    
    assert is_enabled is False


@pytest.mark.asyncio
async def test_environment_isolation(db_session: AsyncSession):
    """测试环境隔离"""
    # 创建预览环境的功能
    await FeatureFlagService.create_feature_flag(
        db=db_session,
        feature_key="preview_feature",
        feature_name="预览功能",
        is_enabled=True,
        scope="global",
        environment="preview"
    )
    
    # 在预览环境可以访问
    is_enabled = await FeatureFlagService.is_feature_enabled(
        db=db_session,
        feature_key="preview_feature",
        user_id=1,
        environment="preview"
    )
    assert is_enabled is True
    
    # 在正式环境不能访问
    is_enabled = await FeatureFlagService.is_feature_enabled(
        db=db_session,
        feature_key="preview_feature",
        user_id=1,
        environment="stable"
    )
    assert is_enabled is False


@pytest.mark.asyncio
async def test_same_feature_key_can_exist_in_both_environments(db_session: AsyncSession):
    """同一 feature_key 可以分别在 stable / preview 维护。"""
    await FeatureFlagService.create_feature_flag(
        db=db_session,
        feature_key="dual_env_feature",
        feature_name="Dual Env Feature Stable",
        is_enabled=False,
        scope="global",
        environment="stable"
    )

    await FeatureFlagService.create_feature_flag(
        db=db_session,
        feature_key="dual_env_feature",
        feature_name="Dual Env Feature Preview",
        is_enabled=True,
        scope="global",
        environment="preview"
    )

    stable_enabled = await FeatureFlagService.is_feature_enabled(
        db=db_session,
        feature_key="dual_env_feature",
        user_id=1,
        environment="stable"
    )
    preview_enabled = await FeatureFlagService.is_feature_enabled(
        db=db_session,
        feature_key="dual_env_feature",
        user_id=1,
        environment="preview"
    )

    assert stable_enabled is False
    assert preview_enabled is True


@pytest.mark.asyncio
async def test_update_feature_flag(db_session: AsyncSession):
    """测试更新功能开关"""
    # 创建功能开关
    flag = await FeatureFlagService.create_feature_flag(
        db=db_session,
        feature_key="update_test",
        feature_name="更新测试",
        is_enabled=False,
        scope="global",
        environment="stable"
    )
    
    # 更新功能开关
    updated_flag = await FeatureFlagService.update_feature_flag(
        db=db_session,
        feature_key="update_test",
        is_enabled=True,
        scope="whitelist",
        whitelist_user_ids=[1, 2],
        whitelist_supplier_ids=[10]
    )
    
    assert updated_flag.is_enabled is True
    assert updated_flag.scope == FeatureFlagScope.WHITELIST
    assert updated_flag.whitelist_user_ids == [1, 2]
    assert updated_flag.whitelist_supplier_ids == [10]


@pytest.mark.asyncio
async def test_get_all_feature_flags(db_session: AsyncSession):
    """测试获取所有功能开关"""
    # 创建多个功能开关
    await FeatureFlagService.create_feature_flag(
        db=db_session,
        feature_key="feature_1",
        feature_name="功能1",
        environment="stable"
    )
    
    await FeatureFlagService.create_feature_flag(
        db=db_session,
        feature_key="feature_2",
        feature_name="功能2",
        environment="preview"
    )
    
    # 获取所有功能开关
    all_flags = await FeatureFlagService.get_all_feature_flags(db_session)
    assert len(all_flags) >= 2
    
    # 按环境过滤
    stable_flags = await FeatureFlagService.get_all_feature_flags(
        db_session,
        environment="stable"
    )
    assert all(flag.environment == FeatureFlagEnvironment.STABLE for flag in stable_flags)


@pytest.mark.asyncio
async def test_get_user_enabled_features(db_session: AsyncSession):
    """测试获取用户可用功能列表"""
    # 创建多个功能开关
    await FeatureFlagService.create_feature_flag(
        db=db_session,
        feature_key="user_feature_1",
        feature_name="用户功能1",
        is_enabled=True,
        scope="global",
        environment="stable"
    )
    
    await FeatureFlagService.create_feature_flag(
        db=db_session,
        feature_key="user_feature_2",
        feature_name="用户功能2",
        is_enabled=True,
        scope="whitelist",
        whitelist_user_ids=[1],
        environment="stable"
    )
    
    await FeatureFlagService.create_feature_flag(
        db=db_session,
        feature_key="user_feature_3",
        feature_name="用户功能3",
        is_enabled=False,
        scope="global",
        environment="stable"
    )
    
    # 获取用户1的可用功能
    enabled_features = await FeatureFlagService.get_user_enabled_features(
        db=db_session,
        user_id=1,
        environment="stable"
    )
    
    # 应该包含全局启用的功能和白名单功能
    assert "user_feature_1" in enabled_features
    assert "user_feature_2" in enabled_features
    # 不应该包含禁用的功能
    assert "user_feature_3" not in enabled_features
    
    # 获取用户2的可用功能
    enabled_features = await FeatureFlagService.get_user_enabled_features(
        db=db_session,
        user_id=2,
        environment="stable"
    )
    
    # 应该只包含全局启用的功能
    assert "user_feature_1" in enabled_features
    # 不应该包含白名单功能（用户2不在白名单中）
    assert "user_feature_2" not in enabled_features


@pytest.mark.asyncio
async def test_feature_flag_not_exists(db_session: AsyncSession):
    """测试不存在的功能开关"""
    # 检查不存在的功能
    is_enabled = await FeatureFlagService.is_feature_enabled(
        db=db_session,
        feature_key="non_existent_feature",
        user_id=1
    )
    
    assert is_enabled is False


@pytest.mark.asyncio
async def test_create_duplicate_feature_flag(db_session: AsyncSession):
    """测试创建重复的功能开关"""
    # 创建功能开关
    await FeatureFlagService.create_feature_flag(
        db=db_session,
        feature_key="duplicate_test",
        feature_name="重复测试"
    )
    
    # 尝试创建相同键的功能开关
    with pytest.raises(ValueError, match="功能开关已存在"):
        await FeatureFlagService.create_feature_flag(
            db=db_session,
            feature_key="duplicate_test",
            feature_name="重复测试2"
        )


@pytest.mark.asyncio
async def test_update_non_existent_feature_flag(db_session: AsyncSession):
    """测试更新不存在的功能开关"""
    with pytest.raises(ValueError, match="功能开关不存在"):
        await FeatureFlagService.update_feature_flag(
            db=db_session,
            feature_key="non_existent",
            is_enabled=True,
            scope="global"
        )
