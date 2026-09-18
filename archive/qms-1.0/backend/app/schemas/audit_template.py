"""
审核模板 Pydantic 模型
Audit Template Schemas - 用于API请求和响应的数据验证
"""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field, field_validator


class AuditTemplateBase(BaseModel):
    """审核模板基础模型"""
    template_name: str = Field(..., min_length=1, max_length=255, description="模板名称")
    audit_type: str = Field(
        ...,
        description="适用审核类型: system_audit, process_audit, product_audit, custom"
    )
    checklist_items: dict = Field(..., description="检查表条款列表 (JSON格式)")
    scoring_rules: dict = Field(..., description="评分规则 (JSON格式)")
    description: Optional[str] = Field(None, description="模板描述")
    is_active: bool = Field(True, description="是否启用")
    
    @field_validator("audit_type")
    @classmethod
    def validate_audit_type(cls, v: str) -> str:
        """验证审核类型"""
        allowed_types = ["system_audit", "process_audit", "product_audit", "custom"]
        if v not in allowed_types:
            raise ValueError(f"审核类型必须是以下之一: {', '.join(allowed_types)}")
        return v


class AuditTemplateCreate(AuditTemplateBase):
    """创建审核模板请求模型"""
    pass


class AuditTemplateUpdate(BaseModel):
    """更新审核模板请求模型"""
    template_name: Optional[str] = Field(None, min_length=1, max_length=255)
    audit_type: Optional[str] = None
    checklist_items: Optional[dict] = None
    scoring_rules: Optional[dict] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None
    
    @field_validator("audit_type")
    @classmethod
    def validate_audit_type(cls, v: Optional[str]) -> Optional[str]:
        """验证审核类型"""
        if v is not None:
            allowed_types = ["system_audit", "process_audit", "product_audit", "custom"]
            if v not in allowed_types:
                raise ValueError(f"审核类型必须是以下之一: {', '.join(allowed_types)}")
        return v


class AuditTemplateResponse(AuditTemplateBase):
    """审核模板响应模型"""
    id: int
    is_builtin: bool = Field(..., description="是否为系统内置模板")
    created_at: datetime
    updated_at: datetime
    created_by: Optional[int] = None
    
    class Config:
        from_attributes = True


class AuditTemplateListResponse(BaseModel):
    """审核模板列表响应模型"""
    total: int = Field(..., description="总记录数")
    items: list[AuditTemplateResponse] = Field(..., description="审核模板列表")
    page: int = Field(..., description="当前页码")
    page_size: int = Field(..., description="每页记录数")
