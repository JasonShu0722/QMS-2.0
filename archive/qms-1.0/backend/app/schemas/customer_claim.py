"""
Customer Claim Schemas
客户索赔数据校验模型
"""
from pydantic import BaseModel, Field, validator
from datetime import date, datetime
from typing import Optional
from decimal import Decimal


class CustomerClaimBase(BaseModel):
    """客户索赔基础模型"""
    complaint_id: int = Field(..., description="关联的客诉单ID")
    claim_amount: Decimal = Field(..., gt=0, description="索赔金额（必须大于0）")
    claim_currency: str = Field(default="CNY", description="币种")
    claim_date: date = Field(..., description="索赔日期")
    customer_name: str = Field(..., min_length=1, max_length=200, description="客户名称")
    claim_description: Optional[str] = Field(None, max_length=500, description="索赔说明")
    claim_reference: Optional[str] = Field(None, max_length=100, description="客户索赔单号")

    @validator('claim_currency')
    def validate_currency(cls, v):
        """验证币种代码"""
        allowed_currencies = ['CNY', 'USD', 'EUR', 'JPY', 'GBP']
        if v not in allowed_currencies:
            raise ValueError(f'币种必须是以下之一: {", ".join(allowed_currencies)}')
        return v


class CustomerClaimCreate(CustomerClaimBase):
    """创建客户索赔请求模型"""
    pass


class CustomerClaimUpdate(BaseModel):
    """更新客户索赔请求模型"""
    claim_amount: Optional[Decimal] = Field(None, gt=0, description="索赔金额")
    claim_currency: Optional[str] = Field(None, description="币种")
    claim_date: Optional[date] = Field(None, description="索赔日期")
    customer_name: Optional[str] = Field(None, min_length=1, max_length=200, description="客户名称")
    claim_description: Optional[str] = Field(None, max_length=500, description="索赔说明")
    claim_reference: Optional[str] = Field(None, max_length=100, description="客户索赔单号")


class CustomerClaimResponse(CustomerClaimBase):
    """客户索赔响应模型"""
    id: int
    created_at: datetime
    updated_at: datetime
    created_by: Optional[int]

    class Config:
        from_attributes = True


class CustomerClaimListResponse(BaseModel):
    """客户索赔列表响应模型"""
    total: int
    items: list[CustomerClaimResponse]


class CustomerClaimStatistics(BaseModel):
    """客户索赔统计模型"""
    total_claims: int = Field(..., description="索赔总数")
    total_amount: Decimal = Field(..., description="索赔总金额")
    by_customer: dict[str, Decimal] = Field(..., description="按客户统计")
    by_month: dict[str, Decimal] = Field(..., description="按月份统计")
    by_currency: dict[str, Decimal] = Field(..., description="按币种统计")
