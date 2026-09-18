"""
认证策略模块测试
测试 LocalAuthStrategy 和 AuthService 的核心功能
"""
import pytest
from datetime import datetime, timedelta

from app.core.auth_strategy import (
    LocalAuthStrategy,
    LDAPAuthStrategy,
    AuthService,
)


@pytest.fixture
def local_strategy():
    """创建本地认证策略实例"""
    return LocalAuthStrategy()


class TestLocalAuthStrategy:
    """测试本地认证策略"""
    
    def test_password_hashing(self, local_strategy: LocalAuthStrategy):
        """测试密码哈希功能"""
        password = "Test@123"
        hashed = local_strategy.hash_password(password)
        
        # 验证哈希后的密码不等于原密码
        assert hashed != password
        
        # 验证密码验证功能
        assert local_strategy.verify_password(password, hashed) is True
        assert local_strategy.verify_password("WrongPassword", hashed) is False
    
    def test_password_complexity_validation(self, local_strategy: LocalAuthStrategy):
        """测试密码复杂度验证"""
        # 有效密码（包含大写、小写、数字）
        valid, msg = local_strategy.validate_password_complexity("Test@123")
        assert valid is True
        
        # 无效密码 - 太短
        valid, msg = local_strategy.validate_password_complexity("Test@1")
        assert valid is False
        assert "长度" in msg
        
        # 无效密码 - 复杂度不足（只有小写和数字）
        valid, msg = local_strategy.validate_password_complexity("test1234")
        assert valid is False
        assert "至少三种" in msg
        
        # 有效密码（包含大写、小写、数字、特殊字符）
        valid, msg = local_strategy.validate_password_complexity("Test@123!")
        assert valid is True
    
    def test_token_creation_and_verification(self, local_strategy: LocalAuthStrategy):
        """测试 Token 生成和验证"""
        user_id = 123
        
        # 生成 Token
        token = local_strategy.create_access_token(user_id)
        assert token is not None
        assert isinstance(token, str)
        
        # 验证 Token
        payload = local_strategy.verify_token(token)
        assert payload["sub"] == str(user_id)
        assert "exp" in payload
        assert "iat" in payload


class TestLDAPAuthStrategy:
    """测试 LDAP 认证策略（预留功能）"""
    
    def test_ldap_not_implemented(self):
        """测试 LDAP 认证抛出 NotImplementedError"""
        ldap_strategy = LDAPAuthStrategy()
        
        with pytest.raises(NotImplementedError):
            # 使用 asyncio.run 来运行异步方法
            import asyncio
            asyncio.run(ldap_strategy.authenticate(None, "user", "pass"))
    
    def test_ldap_token_methods(self):
        """测试 LDAP 策略的 Token 方法（复用本地认证逻辑）"""
        ldap_strategy = LDAPAuthStrategy()
        
        # 测试 Token 生成
        token = ldap_strategy.create_access_token(123)
        assert token is not None
        
        # 测试 Token 验证
        payload = ldap_strategy.verify_token(token)
        assert payload["sub"] == "123"


class TestAuthService:
    """测试统一认证服务"""
    
    def test_strategy_selection(self):
        """测试策略选择逻辑"""
        auth_service = AuthService()
        
        # 内部员工使用本地策略（LDAP 未启用）
        strategy = auth_service.get_strategy("internal")
        assert isinstance(strategy, LocalAuthStrategy)
        
        # 供应商使用本地策略
        strategy = auth_service.get_strategy("supplier")
        assert isinstance(strategy, LocalAuthStrategy)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
