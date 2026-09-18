"""
管理员相关的 Pydantic 数据校验模型
Admin Schemas - 用于管理员操作的 API 请求/响应验证
"""
from datetime import datetime
import re
from typing import Literal, Optional

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.schemas.user import UserResponseSchema


USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9_]+$")


def _normalize_allowed_environments(value: str) -> str:
    allowed = {"stable", "preview"}
    parts = [item.strip() for item in value.split(",") if item.strip()]
    if not parts or any(item not in allowed for item in parts):
        raise ValueError("allowed_environments 仅支持 stable 和 preview，用逗号分隔")
    return ",".join(dict.fromkeys(parts))


class UserApprovalRequest(BaseModel):
    """
    用户审核请求模型
    """
    reason: Optional[str] = Field(None, max_length=500, description="驳回原因（驳回时必填）")
    
    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "reason": "提供的资料不完整，请补充供应商资质证明"
                }
            ]
        }
    }


class UserFreezeRequest(BaseModel):
    """
    用户冻结请求模型
    """
    reason: Optional[str] = Field(None, max_length=500, description="冻结原因")
    
    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "reason": "供应商合作暂停"
                }
            ]
        }
    }


class UserUpdateRequest(BaseModel):
    """
    用户基本信息更新请求
    """

    full_name: str = Field(..., min_length=2, max_length=100, description="姓名")
    email: EmailStr = Field(..., description="邮箱")
    phone: Optional[str] = Field(None, max_length=20, description="电话")
    department: Optional[str] = Field(None, max_length=100, description="部门")
    position: Optional[str] = Field(None, max_length=100, description="岗位")
    allowed_environments: str = Field(..., min_length=6, max_length=50, description="允许访问环境")

    @field_validator("allowed_environments")
    @classmethod
    def validate_allowed_environments(cls, value: str) -> str:
        return _normalize_allowed_environments(value)


class _AdminUserProvisionBase(BaseModel):
    username: str = Field(..., min_length=3, max_length=50, description="用户名")
    full_name: str = Field(..., min_length=2, max_length=100, description="姓名")
    email: EmailStr = Field(..., description="邮箱")
    phone: Optional[str] = Field(None, max_length=20, description="电话")
    department: Optional[str] = Field(None, max_length=100, description="部门")
    position: Optional[str] = Field(None, max_length=100, description="岗位")
    supplier_identifier: Optional[str] = Field(
        None,
        max_length=200,
        description="供应商标识，优先填写供应商代码，兼容供应商ID或供应商名称；如名称重复请改用代码",
    )

    @field_validator("username")
    @classmethod
    def validate_username(cls, value: str) -> str:
        normalized = value.strip()
        if not USERNAME_PATTERN.match(normalized):
            raise ValueError("用户名仅支持字母、数字和下划线")
        return normalized

    @field_validator("full_name")
    @classmethod
    def validate_full_name(cls, value: str) -> str:
        return value.strip()

    @field_validator("phone", "department", "position", "supplier_identifier")
    @classmethod
    def normalize_optional_text(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class AdminUserCreateRequest(_AdminUserProvisionBase):
    user_type: Literal["internal", "supplier"] = Field(..., description="用户类型")
    allowed_environments: str = Field(..., min_length=6, max_length=50, description="允许访问环境")
    role_tag_ids: list[int] = Field(default_factory=list, description="创建后直接分配的角色标签")

    @field_validator("allowed_environments")
    @classmethod
    def validate_allowed_environments(cls, value: str) -> str:
        return _normalize_allowed_environments(value)


class AdminBulkUserCreateItem(_AdminUserProvisionBase):
    pass


class AdminBulkUserCreateRequest(BaseModel):
    user_type: Literal["internal", "supplier"] = Field(..., description="本批次创建的用户类型")
    allowed_environments: str = Field(..., min_length=6, max_length=50, description="允许访问环境")
    role_tag_ids: list[int] = Field(default_factory=list, description="本批次统一分配的角色标签")
    items: list[AdminBulkUserCreateItem] = Field(..., min_length=1, max_length=200, description="批量创建明细")

    @field_validator("allowed_environments")
    @classmethod
    def validate_allowed_environments(cls, value: str) -> str:
        return _normalize_allowed_environments(value)


class AdminUserCreateResponse(BaseModel):
    message: str
    user: UserResponseSchema
    temporary_password: str
    email_sent: bool = False


class AdminBulkUserCreateItemResponse(BaseModel):
    row_number: int
    user: UserResponseSchema
    temporary_password: str
    email_sent: bool = False


class AdminBulkUserCreateResponse(BaseModel):
    message: str
    total_count: int
    created_count: int
    results: list[AdminBulkUserCreateItemResponse]


class SupplierMasterBase(BaseModel):
    code: str = Field(..., min_length=1, max_length=50, description="供应商代码")
    name: str = Field(..., min_length=1, max_length=200, description="供应商名称")
    contact_person: Optional[str] = Field(None, max_length=100, description="联系人")
    contact_email: Optional[EmailStr] = Field(None, description="联系邮箱")
    contact_phone: Optional[str] = Field(None, max_length=20, description="联系电话")

    @field_validator("code")
    @classmethod
    def normalize_code(cls, value: str) -> str:
        normalized = value.strip().upper()
        if not normalized:
            raise ValueError("供应商代码不能为空")
        return normalized

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("供应商名称不能为空")
        return normalized

    @field_validator("contact_person", "contact_phone")
    @classmethod
    def normalize_optional_text(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class SupplierMasterCreateRequest(SupplierMasterBase):
    status: Literal["active", "suspended"] = Field(default="active", description="供应商状态")


class SupplierMasterUpdateRequest(SupplierMasterBase):
    status: Literal["active", "suspended"] = Field(..., description="供应商状态")


class SupplierMasterBulkCreateItem(SupplierMasterBase):
    pass


class SupplierMasterBulkCreateRequest(BaseModel):
    items: list[SupplierMasterBulkCreateItem] = Field(
        ..., min_length=1, max_length=500, description="批量导入明细"
    )
    status: Literal["active", "suspended"] = Field(default="active", description="统一导入状态")


class SupplierMasterResponse(BaseModel):
    id: int
    code: str
    name: str
    contact_person: Optional[str]
    contact_email: Optional[str]
    contact_phone: Optional[str]
    status: str
    linked_user_count: int = 0
    active_user_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SupplierMasterStatusUpdateRequest(BaseModel):
    status: Literal["active", "suspended"] = Field(..., description="供应商状态")


class SupplierMasterBulkCreateResponse(BaseModel):
    message: str
    total_count: int
    created_count: int
    suppliers: list[SupplierMasterResponse]


class CustomerMasterBase(BaseModel):
    code: str = Field(..., min_length=1, max_length=50, description="客户代码")
    name: str = Field(..., min_length=1, max_length=200, description="客户名称")
    contact_person: Optional[str] = Field(None, max_length=100, description="联系人")
    contact_email: Optional[EmailStr] = Field(None, description="联系邮箱")
    contact_phone: Optional[str] = Field(None, max_length=20, description="联系电话")

    @field_validator("code")
    @classmethod
    def normalize_code(cls, value: str) -> str:
        normalized = value.strip().upper()
        if not normalized:
            raise ValueError("客户代码不能为空")
        return normalized

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("客户名称不能为空")
        return normalized

    @field_validator("contact_person", "contact_phone")
    @classmethod
    def normalize_optional_text(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class CustomerMasterCreateRequest(CustomerMasterBase):
    status: Literal["active", "suspended"] = Field(default="active", description="客户状态")


class CustomerMasterUpdateRequest(CustomerMasterBase):
    status: Literal["active", "suspended"] = Field(..., description="客户状态")


class CustomerMasterBulkCreateItem(CustomerMasterBase):
    pass


class CustomerMasterBulkCreateRequest(BaseModel):
    items: list[CustomerMasterBulkCreateItem] = Field(
        ..., min_length=1, max_length=500, description="批量导入明细"
    )
    status: Literal["active", "suspended"] = Field(default="active", description="统一导入状态")


class CustomerMasterResponse(BaseModel):
    id: int
    code: str
    name: str
    contact_person: Optional[str]
    contact_email: Optional[str]
    contact_phone: Optional[str]
    status: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CustomerMasterStatusUpdateRequest(BaseModel):
    status: Literal["active", "suspended"] = Field(..., description="客户状态")


class CustomerMasterBulkCreateResponse(BaseModel):
    message: str
    total_count: int
    created_count: int
    customers: list[CustomerMasterResponse]


class UserRoleAssignmentRequest(BaseModel):
    """
    用户角色分配请求
    """

    role_tag_ids: list[int] = Field(default_factory=list, description="角色标签ID列表")


class PasswordResetResponse(BaseModel):
    """
    密码重置响应模型
    """
    message: str
    temporary_password: str
    email_sent: bool
    
    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "message": "密码已重置，临时密码已发送至用户邮箱",
                    "temporary_password": "TempPass123!",
                    "email_sent": True
                }
            ]
        }
    }


class UserActionResponse(BaseModel):
    """
    用户操作响应模型
    """
    message: str
    user_id: int
    username: str
    status: str
    email_sent: bool = False
    
    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "message": "用户已批准",
                    "user_id": 1,
                    "username": "zhang_san",
                    "status": "active",
                    "email_sent": True
                }
            ]
        }
    }
