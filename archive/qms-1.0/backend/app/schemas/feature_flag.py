"""
功能特性开关数据校验模型
Feature Flag Schemas - Pydantic 数据校验与序列化
"""
from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel, Field, field_validator


class FeatureFlagBase(BaseModel):
    """功能开关基础模型"""
    feature_key: str = Field(..., description="功能唯一标识键", min_length=1, max_length=100)
    feature_name: str = Field(..., description="功能名称", min_length=1, max_length=200)
    description: Optional[str] = Field(None, description="功能描述", max_length=500)
    is_enabled: bool = Field(False, description="是否启用")
    scope: str = Field("global", description="作用域（global/whitelist）")
    whitelist_user_ids: List[int] = Field(default_factory=list, description="白名单用户ID列表")
    whitelist_supplier_ids: List[int] = Field(default_factory=list, description="白名单供应商ID列表")
    environment: str = Field("stable", description="环境标识（stable/preview）")
    
    @field_validator("scope")
    @classmethod
    def validate_scope(cls, v: str) -> str:
        """验证作用域"""
        valid_scopes = ["global", "whitelist"]
        if v not in valid_scopes:
            raise ValueError(f"作用域必须是: {', '.join(valid_scopes)}")
        return v
    
    @field_validator("environment")
    @classmethod
    def validate_environment(cls, v: str) -> str:
        """验证环境标识"""
        valid_environments = ["stable", "preview"]
        if v not in valid_environments:
            raise ValueError(f"环境标识必须是: {', '.join(valid_environments)}")
        return v


class FeatureFlagCreate(FeatureFlagBase):
    """创建功能开关请求模型"""
    pass


class FeatureFlagUpdate(BaseModel):
    """更新功能开关请求模型"""
    is_enabled: bool = Field(..., description="是否启用")
    scope: str = Field(..., description="作用域（global/whitelist）")
    whitelist_user_ids: List[int] = Field(default_factory=list, description="白名单用户ID列表")
    whitelist_supplier_ids: List[int] = Field(default_factory=list, description="白名单供应商ID列表")
    environment: Optional[str] = Field(None, description="环境标识（stable/preview）")
    
    @field_validator("scope")
    @classmethod
    def validate_scope(cls, v: str) -> str:
        """验证作用域"""
        valid_scopes = ["global", "whitelist"]
        if v not in valid_scopes:
            raise ValueError(f"作用域必须是: {', '.join(valid_scopes)}")
        return v
    
    @field_validator("environment")
    @classmethod
    def validate_environment(cls, v: Optional[str]) -> Optional[str]:
        """验证环境标识"""
        if v is not None:
            valid_environments = ["stable", "preview"]
            if v not in valid_environments:
                raise ValueError(f"环境标识必须是: {', '.join(valid_environments)}")
        return v


class FeatureFlagResponse(BaseModel):
    """功能开关响应模型"""
    id: int = Field(..., description="功能开关ID")
    feature_key: str = Field(..., description="功能唯一标识键")
    feature_name: str = Field(..., description="功能名称")
    description: Optional[str] = Field(None, description="功能描述")
    is_enabled: bool = Field(..., description="是否启用")
    scope: str = Field(..., description="作用域")
    whitelist_user_ids: List[int] = Field(..., description="白名单用户ID列表")
    whitelist_supplier_ids: List[int] = Field(..., description="白名单供应商ID列表")
    environment: str = Field(..., description="环境标识")
    created_at: datetime = Field(..., description="创建时间")
    updated_at: datetime = Field(..., description="更新时间")
    created_by: Optional[int] = Field(None, description="创建人ID")
    
    model_config = {
        "from_attributes": True,
        "json_schema_extra": {
            "example": {
                "id": 1,
                "feature_key": "supplier_ppap_v2",
                "feature_name": "供应商PPAP 2.0版本",
                "description": "新版PPAP提交流程，支持在线审核和自动提醒",
                "is_enabled": True,
                "scope": "whitelist",
                "whitelist_user_ids": [1, 2, 3],
                "whitelist_supplier_ids": [10, 20],
                "environment": "preview",
                "created_at": "2024-01-15T10:00:00",
                "updated_at": "2024-01-15T10:00:00",
                "created_by": 1
            }
        }
    }


class FeatureFlagListResponse(BaseModel):
    """功能开关列表响应模型"""
    total: int = Field(..., description="总数")
    feature_flags: List[FeatureFlagResponse] = Field(..., description="功能开关列表")
    
    model_config = {
        "json_schema_extra": {
            "example": {
                "total": 2,
                "feature_flags": [
                    {
                        "id": 1,
                        "feature_key": "supplier_ppap_v2",
                        "feature_name": "供应商PPAP 2.0版本",
                        "description": "新版PPAP提交流程",
                        "is_enabled": True,
                        "scope": "whitelist",
                        "whitelist_user_ids": [1, 2],
                        "whitelist_supplier_ids": [10],
                        "environment": "preview",
                        "created_at": "2024-01-15T10:00:00",
                        "updated_at": "2024-01-15T10:00:00",
                        "created_by": 1
                    }
                ]
            }
        }
    }


class UserEnabledFeaturesResponse(BaseModel):
    """用户可用功能列表响应模型"""
    user_id: int = Field(..., description="用户ID")
    enabled_features: List[str] = Field(..., description="启用的功能键列表")
    
    model_config = {
        "json_schema_extra": {
            "example": {
                "user_id": 1,
                "enabled_features": [
                    "supplier_ppap_v2",
                    "quality_cost_analysis",
                    "instrument_management"
                ]
            }
        }
    }


class FeatureFlagCheckRequest(BaseModel):
    """功能开关检查请求模型"""
    feature_key: str = Field(..., description="功能唯一标识键")
    user_id: Optional[int] = Field(None, description="用户ID")
    supplier_id: Optional[int] = Field(None, description="供应商ID")
    environment: Optional[str] = Field(None, description="环境标识")


class FeatureFlagCheckResponse(BaseModel):
    """功能开关检查响应模型"""
    feature_key: str = Field(..., description="功能唯一标识键")
    is_enabled: bool = Field(..., description="是否启用")
    
    model_config = {
        "json_schema_extra": {
            "example": {
                "feature_key": "supplier_ppap_v2",
                "is_enabled": True
            }
        }
    }
