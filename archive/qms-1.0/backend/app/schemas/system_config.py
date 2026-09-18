"""
系统配置 Pydantic 数据校验模型
System Config Schemas - 用于 API 请求/响应的数据验证
"""
from typing import Optional, Any, Dict
from datetime import datetime
from pydantic import BaseModel, Field, field_validator
import json


class SystemConfigBase(BaseModel):
    """系统配置基础模型"""
    config_key: str = Field(..., description="配置键（唯一标识）", max_length=100)
    config_value: Dict[str, Any] = Field(..., description="配置值（JSON 格式）")
    config_type: str = Field(..., description="配置数据类型", max_length=50)
    description: Optional[str] = Field(None, description="配置项描述说明")
    category: str = Field(..., description="配置分类", max_length=50)
    validation_rule: Optional[Dict[str, Any]] = Field(None, description="验证规则（JSON Schema）")


class SystemConfigCreate(SystemConfigBase):
    """创建系统配置请求模型"""
    pass


class SystemConfigUpdate(BaseModel):
    """更新系统配置请求模型"""
    config_value: Dict[str, Any] = Field(..., description="配置值（JSON 格式）")
    description: Optional[str] = Field(None, description="配置项描述说明")
    
    @field_validator('config_value')
    @classmethod
    def validate_config_value(cls, v):
        """验证配置值是否为有效的 JSON 对象"""
        if not isinstance(v, dict):
            raise ValueError("配置值必须是 JSON 对象格式")
        return v


class SystemConfigResponse(SystemConfigBase):
    """系统配置响应模型"""
    id: int = Field(..., description="配置ID")
    created_at: datetime = Field(..., description="创建时间")
    updated_at: datetime = Field(..., description="更新时间")
    updated_by: Optional[int] = Field(None, description="最后更新人ID")
    
    model_config = {
        "from_attributes": True,
        "json_schema_extra": {
            "example": {
                "id": 1,
                "config_key": "max_file_upload_size",
                "config_value": {"value": 50, "unit": "MB"},
                "config_type": "object",
                "description": "文件上传大小限制",
                "category": "file_limit",
                "validation_rule": {
                    "type": "object",
                    "properties": {
                        "value": {"type": "number", "minimum": 1, "maximum": 100},
                        "unit": {"type": "string", "enum": ["MB", "GB"]}
                    },
                    "required": ["value", "unit"]
                },
                "created_at": "2024-01-15T10:00:00",
                "updated_at": "2024-01-15T10:00:00",
                "updated_by": 1
            }
        }
    }


class SystemConfigListResponse(BaseModel):
    """系统配置列表响应模型"""
    total: int = Field(..., description="配置总数")
    configs: list[SystemConfigResponse] = Field(..., description="配置列表")
    
    model_config = {
        "json_schema_extra": {
            "example": {
                "total": 2,
                "configs": [
                    {
                        "id": 1,
                        "config_key": "max_file_upload_size",
                        "config_value": {"value": 50, "unit": "MB"},
                        "config_type": "object",
                        "description": "文件上传大小限制",
                        "category": "file_limit",
                        "validation_rule": None,
                        "created_at": "2024-01-15T10:00:00",
                        "updated_at": "2024-01-15T10:00:00",
                        "updated_by": 1
                    }
                ]
            }
        }
    }


class SystemConfigCategoryResponse(BaseModel):
    """按分类分组的系统配置响应模型"""
    category: str = Field(..., description="配置分类")
    configs: list[SystemConfigResponse] = Field(..., description="该分类下的配置列表")
    
    model_config = {
        "json_schema_extra": {
            "example": {
                "category": "file_limit",
                "configs": [
                    {
                        "id": 1,
                        "config_key": "max_file_upload_size",
                        "config_value": {"value": 50, "unit": "MB"},
                        "config_type": "object",
                        "description": "文件上传大小限制",
                        "category": "file_limit",
                        "validation_rule": None,
                        "created_at": "2024-01-15T10:00:00",
                        "updated_at": "2024-01-15T10:00:00",
                        "updated_by": 1
                    }
                ]
            }
        }
    }
