"""
供应商质量目标 Pydantic 数据校验模型
Supplier Target Schemas - 用于API请求/响应的数据验证
"""
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field, field_validator
from app.models.supplier_target import TargetType


# ==================== 批量设定目标 ====================

class BatchTargetCreate(BaseModel):
    """批量设定目标请求模型"""
    year: int = Field(..., description="目标年份", ge=2020, le=2100)
    target_type: TargetType = Field(..., description="目标类型")
    target_value: float = Field(..., description="目标值", ge=0)
    supplier_ids: List[int] = Field(..., description="供应商ID列表", min_length=1)
    
    @field_validator('supplier_ids')
    @classmethod
    def validate_supplier_ids(cls, v):
        if not v:
            raise ValueError("供应商ID列表不能为空")
        if len(v) != len(set(v)):
            raise ValueError("供应商ID列表包含重复项")
        return v
    
    class Config:
        json_schema_extra = {
            "example": {
                "year": 2026,
                "target_type": "incoming_pass_rate",
                "target_value": 99.8,
                "supplier_ids": [1, 2, 3, 4, 5]
            }
        }


class BatchTargetCreateResponse(BaseModel):
    """批量设定目标响应模型"""
    success_count: int = Field(..., description="成功创建数量")
    failed_count: int = Field(..., description="失败数量")
    failed_suppliers: List[dict] = Field(default_factory=list, description="失败的供应商列表")
    created_targets: List[int] = Field(default_factory=list, description="创建的目标ID列表")
    
    class Config:
        json_schema_extra = {
            "example": {
                "success_count": 5,
                "failed_count": 0,
                "failed_suppliers": [],
                "created_targets": [1, 2, 3, 4, 5]
            }
        }


# ==================== 单独设定目标 ====================

class IndividualTargetCreate(BaseModel):
    """单独设定目标请求模型"""
    supplier_id: int = Field(..., description="供应商ID", gt=0)
    year: int = Field(..., description="目标年份", ge=2020, le=2100)
    target_type: TargetType = Field(..., description="目标类型")
    target_value: float = Field(..., description="目标值", ge=0)
    previous_year_actual: Optional[float] = Field(None, description="上一年实际达成值（辅助决策）")
    
    class Config:
        json_schema_extra = {
            "example": {
                "supplier_id": 1,
                "year": 2026,
                "target_type": "material_ppm",
                "target_value": 500.0,
                "previous_year_actual": 650.0
            }
        }


class IndividualTargetUpdate(BaseModel):
    """更新单独目标请求模型"""
    target_value: Optional[float] = Field(None, description="目标值", ge=0)
    previous_year_actual: Optional[float] = Field(None, description="上一年实际达成值")
    
    class Config:
        json_schema_extra = {
            "example": {
                "target_value": 480.0,
                "previous_year_actual": 650.0
            }
        }


# ==================== 目标签署 ====================

class TargetSignRequest(BaseModel):
    """供应商签署目标请求模型"""
    confirm: bool = Field(..., description="确认签署（必须为True）")
    
    @field_validator('confirm')
    @classmethod
    def validate_confirm(cls, v):
        if not v:
            raise ValueError("必须确认签署才能提交")
        return v
    
    class Config:
        json_schema_extra = {
            "example": {
                "confirm": True
            }
        }


# ==================== 目标审批 ====================

class TargetApprovalRequest(BaseModel):
    """质量经理审批目标请求模型"""
    target_ids: List[int] = Field(..., description="目标ID列表", min_length=1)
    approve: bool = Field(..., description="是否批准")
    comment: Optional[str] = Field(None, description="审批意见", max_length=500)
    
    class Config:
        json_schema_extra = {
            "example": {
                "target_ids": [1, 2, 3],
                "approve": True,
                "comment": "目标设定合理，批准发布"
            }
        }


# ==================== 目标查询 ====================

class TargetQueryParams(BaseModel):
    """目标查询参数模型"""
    supplier_id: Optional[int] = Field(None, description="供应商ID")
    year: Optional[int] = Field(None, description="目标年份")
    target_type: Optional[TargetType] = Field(None, description="目标类型")
    is_signed: Optional[bool] = Field(None, description="是否已签署")
    is_approved: Optional[bool] = Field(None, description="是否已审批")
    is_individual: Optional[bool] = Field(None, description="是否单独设定")
    page: int = Field(1, description="页码", ge=1)
    page_size: int = Field(50, description="每页数量", ge=1, le=100)


# ==================== 目标响应 ====================

class TargetResponse(BaseModel):
    """目标响应模型"""
    id: int
    supplier_id: int
    year: int
    target_type: str
    target_value: float
    is_individual: bool
    is_signed: bool
    signed_at: Optional[datetime]
    signed_by: Optional[int]
    is_approved: bool
    approved_by: Optional[int]
    approved_at: Optional[datetime]
    previous_year_actual: Optional[float]
    created_at: datetime
    updated_at: datetime
    created_by: Optional[int]
    
    # 辅助决策数据（运行时计算）
    historical_data: Optional[dict] = Field(None, description="历史实际值数据")
    risk_level: Optional[str] = Field(None, description="风险等级：normal/warning/danger")
    
    class Config:
        from_attributes = True
        json_schema_extra = {
            "example": {
                "id": 1,
                "supplier_id": 1,
                "year": 2026,
                "target_type": "incoming_pass_rate",
                "target_value": 99.8,
                "is_individual": True,
                "is_signed": True,
                "signed_at": "2026-01-15T10:30:00",
                "signed_by": 10,
                "is_approved": True,
                "approved_by": 5,
                "approved_at": "2026-01-10T14:20:00",
                "previous_year_actual": 99.5,
                "created_at": "2026-01-05T09:00:00",
                "updated_at": "2026-01-15T10:30:00",
                "created_by": 3,
                "historical_data": {
                    "2025_avg": 99.5,
                    "2025_min": 98.8,
                    "2025_max": 99.9
                },
                "risk_level": "normal"
            }
        }


class TargetListResponse(BaseModel):
    """目标列表响应模型"""
    total: int = Field(..., description="总数量")
    page: int = Field(..., description="当前页码")
    page_size: int = Field(..., description="每页数量")
    items: List[TargetResponse] = Field(..., description="目标列表")
    
    class Config:
        json_schema_extra = {
            "example": {
                "total": 100,
                "page": 1,
                "page_size": 50,
                "items": []
            }
        }


# ==================== 辅助决策数据 ====================

class HistoricalPerformanceData(BaseModel):
    """历史绩效数据模型（辅助决策）"""
    supplier_id: int
    supplier_name: str
    year: int
    target_type: str
    
    # 历史实际值统计
    avg_value: Optional[float] = Field(None, description="平均值")
    min_value: Optional[float] = Field(None, description="最小值")
    max_value: Optional[float] = Field(None, description="最大值")
    std_dev: Optional[float] = Field(None, description="标准差")
    
    # 月度趋势
    monthly_trend: Optional[List[dict]] = Field(None, description="月度趋势数据")
    
    # 风险评估
    risk_assessment: Optional[str] = Field(None, description="风险评估：目标是否合理")
    
    class Config:
        json_schema_extra = {
            "example": {
                "supplier_id": 1,
                "supplier_name": "供应商A",
                "year": 2025,
                "target_type": "incoming_pass_rate",
                "avg_value": 99.5,
                "min_value": 98.8,
                "max_value": 99.9,
                "std_dev": 0.3,
                "monthly_trend": [
                    {"month": 1, "value": 99.2},
                    {"month": 2, "value": 99.5}
                ],
                "risk_assessment": "目标设定合理，略高于历史平均值"
            }
        }


# ==================== 未签署目标统计 ====================

class UnsignedTargetsSummary(BaseModel):
    """未签署目标统计模型"""
    total_unsigned: int = Field(..., description="未签署总数")
    by_supplier: List[dict] = Field(..., description="按供应商分组统计")
    deadline: Optional[datetime] = Field(None, description="签署截止日期")
    
    class Config:
        json_schema_extra = {
            "example": {
                "total_unsigned": 15,
                "by_supplier": [
                    {"supplier_id": 1, "supplier_name": "供应商A", "unsigned_count": 5},
                    {"supplier_id": 2, "supplier_name": "供应商B", "unsigned_count": 10}
                ],
                "deadline": "2026-01-31T23:59:59"
            }
        }
