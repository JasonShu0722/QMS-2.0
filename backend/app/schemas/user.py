"""
用户相关的 Pydantic 数据校验模型。
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, EmailStr, Field, field_serializer, field_validator

from app.schemas.role_tag import RoleTagSummarySchema
from app.core.timezone import serialize_beijing_datetime


class UserRegisterSchema(BaseModel):
    """
    公共注册仅面向内部员工。
    """

    username: str = Field(..., min_length=3, max_length=50, description="用户名")
    password: str = Field(..., min_length=8, description="密码")
    full_name: str = Field(..., min_length=2, max_length=100, description="姓名")
    email: EmailStr = Field(..., description="邮箱")
    phone: Optional[str] = Field(None, max_length=20, description="电话")
    user_type: Literal["internal"] = Field(default="internal", description="用户类型")
    department: Optional[str] = Field(None, max_length=100, description="部门")
    position: Optional[str] = Field(None, max_length=100, description="岗位")

    @field_validator("username")
    @classmethod
    def validate_username(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized.replace("_", "").isalnum():
            raise ValueError("用户名只支持字母、数字和下划线")
        return normalized

    @field_validator("full_name")
    @classmethod
    def validate_full_name(cls, value: str) -> str:
        return value.strip()

    @field_validator("phone", "department", "position")
    @classmethod
    def normalize_optional_text(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "username": "zhang_san",
                    "password": "SecurePass123!",
                    "full_name": "张三",
                    "email": "zhangsan@ics-energy.com",
                    "phone": "13800138000",
                    "user_type": "internal",
                    "department": "质量管理部",
                    "position": "体系工程师",
                }
            ]
        }
    }


class UserApprovalSchema(BaseModel):
    """
    用户审核操作校验模型。
    """

    action: str = Field(..., description="审核动作: approve 或 reject")
    reason: Optional[str] = Field(None, max_length=500, description="驳回原因")

    @field_validator("action")
    @classmethod
    def validate_action(cls, value: str) -> str:
        if value not in ["approve", "reject"]:
            raise ValueError("审核动作必须是 approve 或 reject")
        return value

    model_config = {
        "json_schema_extra": {
            "examples": [
                {"action": "approve"},
                {"action": "reject", "reason": "提供的资料不完整，请补充后重新提交"},
            ]
        }
    }


class UserResponseSchema(BaseModel):
    """
    用户信息响应模型。
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
    supplier_name: Optional[str] = None
    avatar_image_path: Optional[str]
    signature_image_path: Optional[str] = None
    digital_signature: Optional[str] = None
    allowed_environments: Optional[str]
    is_platform_admin: bool = False
    role_tags: list[RoleTagSummarySchema] = Field(default_factory=list)
    last_login_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @field_serializer("last_login_at", "created_at", "updated_at", when_used="json")
    def serialize_datetime_fields(self, value: datetime | None) -> str | None:
        return serialize_beijing_datetime(value)


class RegisterResponseSchema(BaseModel):
    """
    注册成功响应模型。
    """

    message: str
    user_id: int
    username: str
    status: str

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "message": "注册成功，请等待管理员审核",
                    "user_id": 1,
                    "username": "zhang_san",
                    "status": "pending",
                }
            ]
        }
    }


class LoginRequestSchema(BaseModel):
    """
    登录请求模型。
    """

    username: str = Field(..., min_length=3, max_length=50, description="用户名")
    password: str = Field(..., min_length=1, description="密码")
    user_type: str = Field(..., description="用户类型: internal 或 supplier")
    captcha: Optional[str] = Field(None, description="图形验证码")
    captcha_id: Optional[str] = Field(None, description="验证码 ID")
    environment: Optional[str] = Field(
        None,
        description="兼容旧客户端字段；登录目标环境由当前后端运行环境决定",
    )

    @field_validator("user_type")
    @classmethod
    def validate_user_type(cls, value: str) -> str:
        if value not in ["internal", "supplier"]:
            raise ValueError("用户类型必须是 internal 或 supplier")
        return value

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "username": "zhang_san",
                    "password": "SecurePass123!",
                    "user_type": "internal",
                },
                {
                    "username": "supplier_user",
                    "password": "SupplierPass456!",
                    "user_type": "supplier",
                    "captcha": "ABCD",
                    "captcha_id": "550e8400-e29b-41d4-a716-446655440000",
                },
            ]
        }
    }


class LoginResponseSchema(BaseModel):
    """
    登录成功响应模型。
    """

    access_token: str
    token_type: str = "bearer"
    user_info: UserResponseSchema
    environment: str = "stable"
    allowed_environments: list[str] = Field(default_factory=list, description="可访问环境列表")
    password_expired: bool = Field(default=False, description="密码是否已过期")

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
                    "token_type": "bearer",
                    "password_expired": False,
                    "user_info": {
                        "id": 1,
                        "username": "zhang_san",
                        "full_name": "张三",
                        "email": "zhangsan@ics-energy.com",
                        "user_type": "internal",
                        "status": "active",
                    },
                }
            ]
        }
    }


class CaptchaResponseSchema(BaseModel):
    """
    验证码响应模型。
    """

    captcha_id: str = Field(..., description="验证码 ID")
    captcha_image: str = Field(..., description="Base64 编码的验证码图片")

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "captcha_id": "550e8400-e29b-41d4-a716-446655440000",
                    "captcha_image": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
                }
            ]
        }
    }
