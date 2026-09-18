"""
审核计划 Pydantic 模型
Audit Plan Schemas - 用于API请求和响应的数据验证
"""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field, field_validator


class AuditPlanBase(BaseModel):
    """审核计划基础模型"""
    audit_type: str = Field(
        ...,
        description="审核类型: system_audit, process_audit, product_audit, customer_audit"
    )
    audit_name: str = Field(..., min_length=1, max_length=255, description="审核名称")
    planned_date: datetime = Field(..., description="计划审核日期")
    auditor_id: int = Field(..., gt=0, description="主审核员ID")
    auditee_dept: str = Field(..., min_length=1, max_length=100, description="被审核部门")
    notes: Optional[str] = Field(None, description="备注")
    
    @field_validator("audit_type")
    @classmethod
    def validate_audit_type(cls, v: str) -> str:
        """验证审核类型"""
        allowed_types = ["system_audit", "process_audit", "product_audit", "customer_audit"]
        if v not in allowed_types:
            raise ValueError(f"审核类型必须是以下之一: {', '.join(allowed_types)}")
        return v


class AuditPlanCreate(AuditPlanBase):
    """创建审核计划请求模型"""
    pass


class AuditPlanUpdate(BaseModel):
    """更新审核计划请求模型"""
    audit_type: Optional[str] = None
    audit_name: Optional[str] = Field(None, min_length=1, max_length=255)
    planned_date: Optional[datetime] = None
    auditor_id: Optional[int] = Field(None, gt=0)
    auditee_dept: Optional[str] = Field(None, min_length=1, max_length=100)
    notes: Optional[str] = None
    status: Optional[str] = None
    
    @field_validator("audit_type")
    @classmethod
    def validate_audit_type(cls, v: Optional[str]) -> Optional[str]:
        """验证审核类型"""
        if v is not None:
            allowed_types = ["system_audit", "process_audit", "product_audit", "customer_audit"]
            if v not in allowed_types:
                raise ValueError(f"审核类型必须是以下之一: {', '.join(allowed_types)}")
        return v
    
    @field_validator("status")
    @classmethod
    def validate_status(cls, v: Optional[str]) -> Optional[str]:
        """验证状态"""
        if v is not None:
            allowed_statuses = ["planned", "in_progress", "completed", "postponed", "cancelled"]
            if v not in allowed_statuses:
                raise ValueError(f"状态必须是以下之一: {', '.join(allowed_statuses)}")
        return v


class AuditPlanPostponeRequest(BaseModel):
    """延期申请请求模型"""
    new_planned_date: datetime = Field(..., description="新的计划日期")
    postpone_reason: str = Field(..., min_length=1, description="延期原因")


class AuditPlanResponse(AuditPlanBase):
    """审核计划响应模型"""
    id: int
    status: str
    postpone_reason: Optional[str] = None
    postpone_approved_by: Optional[int] = None
    postpone_approved_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    created_by: Optional[int] = None
    
    class Config:
        from_attributes = True


class AuditPlanListResponse(BaseModel):
    """审核计划列表响应模型"""
    total: int = Field(..., description="总记录数")
    items: list[AuditPlanResponse] = Field(..., description="审核计划列表")
    page: int = Field(..., description="当前页码")
    page_size: int = Field(..., description="每页记录数")


class AuditPlanYearViewResponse(BaseModel):
    """年度审核计划视图响应模型"""
    year: int = Field(..., description="年份")
    total_plans: int = Field(..., description="总计划数")
    by_type: dict[str, int] = Field(..., description="按类型统计")
    by_status: dict[str, int] = Field(..., description="按状态统计")
    by_month: dict[str, list[AuditPlanResponse]] = Field(..., description="按月份分组的计划列表")
