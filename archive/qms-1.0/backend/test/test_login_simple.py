"""
简单登录功能测试
Simple Login Test - 测试登录API的基本功能
"""
import pytest
from datetime import datetime

from app.core.auth_strategy import LocalAuthStrategy
from app.services.captcha_service import captcha_service


def test_password_hashing():
    """测试密码哈希功能"""
    local_auth = LocalAuthStrategy()
    
    password = "TestPass123!"
    hashed = local_auth.hash_password(password)
    
    # 验证哈希后的密码不等于原密码
    assert hashed != password
    
    # 验证密码验证功能
    assert local_auth.verify_password(password, hashed) is True
    assert local_auth.verify_password("WrongPassword", hashed) is False


def test_password_complexity_validation():
    """测试密码复杂度验证"""
    local_auth = LocalAuthStrategy()
    
    # 有效密码
    is_valid, error = local_auth.validate_password_complexity("TestPass123!")
    assert is_valid is True
    assert error == ""
    
    # 太短
    is_valid, error = local_auth.validate_password_complexity("Test1!")
    assert is_valid is False
    assert "长度" in error
    
    # 复杂度不足
    is_valid, error = local_auth.validate_password_complexity("testpassword")
    assert is_valid is False
    assert "至少三种" in error


def test_jwt_token_creation_and_verification():
    """测试 JWT Token 生成和验证"""
    local_auth = LocalAuthStrategy()
    
    user_id = 123
    token = local_auth.create_access_token(user_id)
    
    # 验证 Token
    payload = local_auth.verify_token(token)
    
    assert payload["sub"] == str(user_id)
    assert "exp" in payload
    assert "iat" in payload


def test_captcha_generation():
    """测试验证码生成"""
    captcha_id, captcha_image = captcha_service.generate_captcha()
    
    # 验证返回值
    assert captcha_id is not None
    assert len(captcha_id) > 0
    assert captcha_image.startswith("data:image/png;base64,")


def test_captcha_verification():
    """测试验证码验证"""
    # 生成验证码
    captcha_id, _ = captcha_service.generate_captcha()
    
    # 获取验证码文本（从内部存储）
    captcha_text = captcha_service._captcha_store[captcha_id]["text"]
    
    # 验证正确的验证码
    assert captcha_service.verify_captcha(captcha_id, captcha_text) is True
    
    # 验证码只能使用一次
    assert captcha_service.verify_captcha(captcha_id, captcha_text) is False


def test_captcha_case_insensitive():
    """测试验证码不区分大小写"""
    captcha_id, _ = captcha_service.generate_captcha()
    captcha_text = captcha_service._captcha_store[captcha_id]["text"]
    
    # 小写验证
    assert captcha_service.verify_captcha(captcha_id, captcha_text.lower()) is True


def test_captcha_invalid_id():
    """测试无效的验证码ID"""
    assert captcha_service.verify_captcha("invalid_id", "ABCD") is False


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
