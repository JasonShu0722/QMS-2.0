"""
个人信息管理相关的 Pydantic 数据校验模型
Profile Schemas - 用于个人中心 API 的数据验证
"""
from typing import Optional
from pydantic import BaseModel, EmailStr, Field, field_validator
import re


class PasswordChangeSchema(BaseModel):
    """
    修改密码请求模型
    """
    old_password: str = Field(..., min_length=1, description="旧密码")
    new_password: str = Field(..., min_length=8, description="新密码")
    
    @field_validator('new_password')
    @classmethod
    def validate_password_complexity(cls, v: str) -> str:
        """
        验证密码复杂度
        规则：大写、小写、数字、特殊字符中至少三种，长度>8位
        """
        if len(v) < 8:
            raise ValueError('密码长度必须大于 8 位')
        
        # 检查字符类型
        has_upper = bool(re.search(r'[A-Z]', v))
        has_lower = bool(re.search(r'[a-z]', v))
        has_digit = bool(re.search(r'\d', v))
        has_special = bool(re.search(r'[!@#$%^&*(),.?":{}|<>]', v))
        
        complexity_count = sum([has_upper, has_lower, has_digit, has_special])
        
        if complexity_count < 3:
            raise ValueError('密码必须包含大写字母、小写字母、数字、特殊字符中的至少三种')
        
        return v
    
    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "old_password": "OldPass123!",
                    "new_password": "NewSecurePass456!"
                }
            ]
        }
    }


class PasswordChangeResponseSchema(BaseModel):
    """
    修改密码响应模型
    """
    message: str
    password_changed_at: str
    
    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "message": "密码修改成功，请重新登录",
                    "password_changed_at": "2024-01-15T10:30:00"
                }
            ]
        }
    }


class SignatureUploadResponseSchema(BaseModel):
    """
    电子签名上传响应模型
    """
    message: str
    signature_path: str
    
    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "message": "电子签名上传成功",
                    "signature_path": "/uploads/signatures/user_1_signature.png"
                }
            ]
        }
    }


class ProfileUpdateSchema(BaseModel):
    """
    更新个人信息请求模型
    """
    full_name: Optional[str] = Field(None, min_length=2, max_length=100, description="姓名")
    email: Optional[EmailStr] = Field(None, description="邮箱")
    phone: Optional[str] = Field(None, max_length=20, description="电话")
    department: Optional[str] = Field(None, max_length=100, description="部门")
    position: Optional[str] = Field(None, max_length=100, description="职位")

    @field_validator("full_name", mode="before")
    @classmethod
    def normalize_full_name(cls, value):
        if value is None:
            return None

        if isinstance(value, str):
            normalized = value.strip()
            if not normalized:
                raise ValueError("姓名不能为空")
            return normalized

        return value

    @field_validator("phone", "department", "position", mode="before")
    @classmethod
    def normalize_optional_text(cls, value):
        if value is None:
            return None

        if isinstance(value, str):
            normalized = value.strip()
            return normalized or None

        return value

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "full_name": "张三",
                    "email": "zhangsan@company.com",
                    "phone": "13800138000",
                    "department": "信息技术部",
                    "position": "系统管理员"
                }
            ]
        }
    }


class ProfileResponseSchema(BaseModel):
    """
    个人信息响应模型
    """
    id: int
    username: str
    full_name: str
    email: str
    phone: Optional[str]
    user_type: str
    status: str
    department: Optional[str]
    position: Optional[str]
    supplier_id: Optional[int]
    avatar_image_path: Optional[str]
    digital_signature: Optional[str]
    password_changed_at: Optional[str]
    last_login_at: Optional[str]
    created_at: str
    
    model_config = {
        "from_attributes": True,
        "json_schema_extra": {
            "examples": [
                {
                    "id": 1,
                    "username": "zhang_san",
                    "full_name": "张三",
                    "email": "zhangsan@company.com",
                    "phone": "13800138000",
                    "user_type": "internal",
                    "status": "active",
                    "department": "质量部",
                    "position": "质量工程师",
                    "supplier_id": None,
                    "digital_signature": "/uploads/signatures/user_1_signature.png",
                    "password_changed_at": "2024-01-01T00:00:00",
                    "last_login_at": "2024-01-15T09:00:00",
                    "created_at": "2023-12-01T00:00:00"
                }
            ]
        }
    }
