"""
供应商绩效评价数据模型
Supplier Performance Schemas - 请求/响应数据模型
"""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field, field_validator


class CooperationEvaluation(BaseModel):
    """配合度评价"""
    cooperation_level: str = Field(..., description="配合度等级: high/medium/low")
    cooperation_comment: Optional[str] = Field(None, description="配合度评价说明")
    
    @field_validator("cooperation_level")
    @classmethod
    def validate_cooperation_level(cls, v: str) -> str:
        if v not in ["high", "medium", "low"]:
            raise ValueError("配合度等级必须是 high/medium/low 之一")
        return v


class PerformanceReview(BaseModel):
    """SQE人工校核"""
    review_comment: Optional[str] = Field(None, description="校核说明")
    manual_adjustment: float = Field(0.0, description="人工调整分数（正数为加分，负数为扣分）")


class PerformanceQueryParams(BaseModel):
    """绩效查询参数"""
    supplier_id: Optional[int] = Field(None, description="供应商ID")
    year: Optional[int] = Field(None, description="年份")
    month: Optional[int] = Field(None, description="月份")
    grade: Optional[str] = Field(None, description="绩效等级: A/B/C/D")
    is_reviewed: Optional[bool] = Field(None, description="是否已校核")
    page: int = Field(1, ge=1, description="页码")
    page_size: int = Field(20, ge=1, le=100, description="每页数量")
    
    @field_validator("grade")
    @classmethod
    def validate_grade(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in ["A", "B", "C", "D"]:
            raise ValueError("绩效等级必须是 A/B/C/D 之一")
        return v


class PerformanceDeductionDetail(BaseModel):
    """扣分明细"""
    incoming_quality_deduction: float = Field(..., description="来料质量扣分")
    incoming_quality_reason: str = Field(..., description="来料质量扣分原因")
    
    process_quality_deduction: float = Field(..., description="制程质量扣分")
    process_quality_reason: str = Field(..., description="制程质量扣分原因")
    
    cooperation_deduction: float = Field(..., description="配合度扣分")
    cooperation_reason: str = Field(..., description="配合度扣分原因")
    
    zero_km_deduction: float = Field(..., description="0公里/售后质量扣分")
    zero_km_reason: str = Field(..., description="0公里/售后质量扣分原因")
    
    total_deduction: float = Field(..., description="总扣分")


class PerformanceResponse(BaseModel):
    """绩效评价响应"""
    id: int
    supplier_id: int
    supplier_name: Optional[str] = None
    year: int
    month: int
    
    # 扣分明细
    incoming_quality_deduction: float
    process_quality_deduction: float
    cooperation_deduction: float
    zero_km_deduction: float
    total_deduction: float
    
    # 最终得分和等级
    final_score: float
    grade: str
    
    # 配合度评价
    cooperation_level: Optional[str] = None
    cooperation_comment: Optional[str] = None
    
    # 校核信息
    is_reviewed: bool
    reviewed_by: Optional[int] = None
    reviewed_at: Optional[datetime] = None
    review_comment: Optional[str] = None
    manual_adjustment: float
    
    # 审计字段
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class PerformanceListResponse(BaseModel):
    """绩效列表响应"""
    total: int = Field(..., description="总记录数")
    page: int = Field(..., description="当前页码")
    page_size: int = Field(..., description="每页数量")
    items: list[PerformanceResponse] = Field(..., description="绩效记录列表")


class PerformanceCardResponse(BaseModel):
    """绩效卡响应（供应商视图）"""
    supplier_id: int
    supplier_name: str
    year: int
    month: int
    
    # 当前绩效
    current_score: float
    current_grade: str
    
    # 本月扣分情况
    deduction_this_month: float
    deduction_detail: PerformanceDeductionDetail
    
    # 历史趋势（最近6个月）
    historical_scores: list[dict] = Field(..., description="历史得分趋势")
    
    # 是否需要参加改善会议
    requires_meeting: bool = Field(..., description="是否需要参加改善会议（C/D级）")


class PerformanceStatistics(BaseModel):
    """绩效统计"""
    total_suppliers: int = Field(..., description="总供应商数")
    grade_distribution: dict[str, int] = Field(..., description="等级分布")
    average_score: float = Field(..., description="平均得分")
    
    # Top/Bottom供应商
    top_suppliers: list[dict] = Field(..., description="Top5供应商")
    bottom_suppliers: list[dict] = Field(..., description="Bottom5供应商")
    
    # 需要关注的供应商
    requires_attention: list[dict] = Field(..., description="C/D级供应商清单")
