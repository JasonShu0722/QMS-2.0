"""
角色标签相关的 Pydantic 模型
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator

from app.models.permission import OperationType


ROLE_KEY_PATTERN = re.compile(r"^[a-z][a-z0-9_.-]{1,99}$")


class RoleTagSummarySchema(BaseModel):
    id: int
    role_key: str
    role_name: str
    description: Optional[str] = None
    applicable_user_type: Optional[str] = None
    is_active: bool = True
    assigned_user_count: int = 0
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class RoleTagCreateRequest(BaseModel):
    role_key: str = Field(..., min_length=2, max_length=100, description="角色唯一键")
    role_name: str = Field(..., min_length=2, max_length=100, description="角色名称")
    description: Optional[str] = Field(None, max_length=255, description="角色描述")
    applicable_user_type: Optional[str] = Field(None, description="适用用户类型：internal/supplier")
    is_active: bool = Field(True, description="是否启用")

    @field_validator("role_key")
    @classmethod
    def validate_role_key(cls, value: str) -> str:
        if not ROLE_KEY_PATTERN.match(value):
            raise ValueError("角色唯一键必须以小写字母开头，仅支持小写字母、数字、点、下划线和中划线")
        return value

    @field_validator("applicable_user_type")
    @classmethod
    def validate_applicable_user_type(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        if value not in {"internal", "supplier"}:
            raise ValueError("适用用户类型必须是 internal 或 supplier")
        return value


class RoleTagUpdateRequest(BaseModel):
    role_name: str = Field(..., min_length=2, max_length=100, description="角色名称")
    description: Optional[str] = Field(None, max_length=255, description="角色描述")
    applicable_user_type: Optional[str] = Field(None, description="适用用户类型：internal/supplier")
    is_active: bool = Field(..., description="是否启用")

    @field_validator("applicable_user_type")
    @classmethod
    def validate_applicable_user_type(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        if value not in {"internal", "supplier"}:
            raise ValueError("适用用户类型必须是 internal 或 supplier")
        return value


class RoleTagPermissionItem(BaseModel):
    module_path: str = Field(..., description="功能模块路径")
    operation_type: OperationType = Field(..., description="操作类型")
    is_granted: bool = Field(..., description="是否授予")


class RoleTagPermissionUpdateRequest(BaseModel):
    permissions: list[RoleTagPermissionItem] = Field(..., min_length=1, description="角色权限变更列表")


class RoleTagOperationResponse(BaseModel):
    message: str
    role_id: int


class RolePermissionOperationResponse(BaseModel):
    success: bool
    message: str
    role_id: int
    affected_permissions: int


class RoleTemplateInitializationResponse(BaseModel):
    success: bool
    message: str
    created_roles: int
    existing_roles: int
    created_permissions: int
    role_keys: list[str]
