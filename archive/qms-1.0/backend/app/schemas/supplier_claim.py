"""
Supplier Claim Schemas
供应商索赔数据校验模型
"""
from pydantic import BaseModel, Field, validator
from datetime import date, datetime
from typing import Optional
from decimal import Decimal
from enum import Enum


class SupplierClaimStatus(str, Enum):
    """供应商索赔状态枚举"""
    DRAFT = "draft"
    SUBMITTED = "submitted"
    UNDER_NEGOTIATION = "under_negotiation"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    PARTIALLY_ACCEPTED = "partially_accepted"
    PAID = "paid"
    CLOSED = "closed"


class SupplierClaimBase(BaseModel):
    """供应商索赔基础模型"""
    supplier_id: int = Field(..., description="供应商ID")
    claim_amount: Decimal = Field(..., gt=0, description="索赔金额（必须大于0）")
    claim_currency: str = Field(default="CNY", description="币种")
    claim_date: date = Field(..., description="索赔日期")
    claim_description: Optional[str] = Field(None, max_length=500, description="索赔说明")
    material_code: Optional[str] = Field(None, max_length=50, description="涉及物料编码")
    defect_qty: Optional[int] = Field(None, gt=0, description="不良数量")
    complaint_id: Optional[int] = Field(None, description="关联的客诉单ID（可选）")

    @validator('claim_currency')
    def validate_currency(cls, v):
        """验证币种代码"""
        allowed_currencies = ['CNY', 'USD', 'EUR', 'JPY', 'GBP']
        if v not in allowed_currencies:
            raise ValueError(f'币种必须是以下之一: {", ".join(allowed_currencies)}')
        return v


class SupplierClaimCreate(SupplierClaimBase):
    """创建供应商索赔请求模型"""
    pass


class SupplierClaimFromComplaint(BaseModel):
    """从客诉单生成供应商索赔请求模型（一键转嫁）"""
    complaint_id: int = Field(..., description="客诉单ID")
    supplier_id: int = Field(..., description="供应商ID")
    claim_amount: Decimal = Field(..., gt=0, description="索赔金额")
    claim_currency: str = Field(default="CNY", description="币种")
    material_code: Optional[str] = Field(None, max_length=50, description="涉及物料编码")
    defect_qty: Optional[int] = Field(None, gt=0, description="不良数量")
    claim_description: Optional[str] = Field(None, max_length=500, description="索赔说明")


class SupplierClaimUpdate(BaseModel):
    """更新供应商索赔请求模型"""
    claim_amount: Optional[Decimal] = Field(None, gt=0, description="索赔金额")
    claim_currency: Optional[str] = Field(None, description="币种")
    claim_date: Optional[date] = Field(None, description="索赔日期")
    claim_description: Optional[str] = Field(None, max_length=500, description="索赔说明")
    material_code: Optional[str] = Field(None, max_length=50, description="涉及物料编码")
    defect_qty: Optional[int] = Field(None, gt=0, description="不良数量")
    status: Optional[SupplierClaimStatus] = Field(None, description="索赔状态")
    negotiation_notes: Optional[str] = Field(None, max_length=1000, description="协商记录")
    final_amount: Optional[Decimal] = Field(None, gt=0, description="最终索赔金额")
    payment_date: Optional[date] = Field(None, description="实际支付日期")


class SupplierClaimResponse(SupplierClaimBase):
    """供应商索赔响应模型"""
    id: int
    status: SupplierClaimStatus
    negotiation_notes: Optional[str]
    final_amount: Optional[Decimal]
    payment_date: Optional[date]
    created_at: datetime
    updated_at: datetime
    created_by: Optional[int]

    class Config:
        from_attributes = True


class SupplierClaimListResponse(BaseModel):
    """供应商索赔列表响应模型"""
    total: int
    items: list[SupplierClaimResponse]


class SupplierClaimStatistics(BaseModel):
    """供应商索赔统计模型"""
    total_claims: int = Field(..., description="索赔总数")
    total_amount: Decimal = Field(..., description="索赔总金额")
    by_supplier: dict[str, Decimal] = Field(..., description="按供应商统计")
    by_status: dict[str, int] = Field(..., description="按状态统计")
    by_month: dict[str, Decimal] = Field(..., description="按月份统计")
    by_currency: dict[str, Decimal] = Field(..., description="按币种统计")
