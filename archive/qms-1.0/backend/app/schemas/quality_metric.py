"""
质量指标 Pydantic 模型
Quality Metric Schemas - API 请求/响应数据校验
"""
from datetime import date as date_type
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from decimal import Decimal

from app.models.quality_metric import MetricType


class QualityMetricResponse(BaseModel):
    """质量指标响应模型"""
    id: int
    metric_type: str
    metric_date: date_type
    value: float
    target_value: Optional[float] = None
    product_type: Optional[str] = None
    supplier_id: Optional[int] = None
    line_id: Optional[str] = None
    process_id: Optional[str] = None
    is_target_met: Optional[bool] = None
    created_at: str
    updated_at: str
    
    model_config = {
        "from_attributes": True
    }


class DashboardMetricSummary(BaseModel):
    """仪表盘指标摘要"""
    metric_type: str = Field(..., description="指标类型")
    metric_name: str = Field(..., description="指标名称")
    current_value: float = Field(..., description="当前值")
    target_value: Optional[float] = Field(None, description="目标值")
    is_target_met: Optional[bool] = Field(None, description="是否达标")
    status: str = Field(..., description="状态：good/warning/danger")
    trend: str = Field(..., description="趋势：up/down/stable")
    change_percentage: Optional[float] = Field(None, description="变化百分比")


class DashboardResponse(BaseModel):
    """仪表盘数据响应"""
    date: date_type = Field(..., description="数据日期")
    metrics: List[DashboardMetricSummary] = Field(..., description="指标列表")
    summary: Dict[str, Any] = Field(..., description="汇总信息")


class MetricTrendRequest(BaseModel):
    """指标趋势查询请求"""
    metric_type: str = Field(..., description="指标类型")
    start_date: date_type = Field(..., description="开始日期")
    end_date: date_type = Field(..., description="结束日期")
    supplier_id: Optional[int] = Field(None, description="供应商ID（可选）")
    product_type: Optional[str] = Field(None, description="产品类型（可选）")
    line_id: Optional[str] = Field(None, description="产线ID（可选）")
    process_id: Optional[str] = Field(None, description="工序ID（可选）")


class MetricTrendResponse(BaseModel):
    """指标趋势响应"""
    metric_type: str
    metric_name: str
    start_date: date_type
    end_date: date_type
    data_points: List[QualityMetricResponse]
    statistics: Dict[str, Any] = Field(..., description="统计信息：平均值、最大值、最小值等")


class DrillDownRequest(BaseModel):
    """下钻查询请求"""
    metric_type: str = Field(..., description="指标类型")
    metric_date: date_type = Field(..., description="指标日期")
    supplier_id: Optional[int] = Field(None, description="供应商ID（可选）")
    product_type: Optional[str] = Field(None, description="产品类型（可选）")
    line_id: Optional[str] = Field(None, description="产线ID（可选）")
    process_id: Optional[str] = Field(None, description="工序ID（可选）")


class DrillDownResponse(BaseModel):
    """下钻查询响应"""
    metric_type: str
    metric_date: date_type
    metric_value: float
    details: List[Dict[str, Any]] = Field(..., description="明细数据")
    breakdown: Dict[str, Any] = Field(..., description="分类统计")


class TopSupplierItem(BaseModel):
    """Top供应商项"""
    supplier_id: int
    supplier_name: str
    metric_value: float
    rank: int
    status: str = Field(..., description="状态：good/warning/danger")


class TopSuppliersResponse(BaseModel):
    """Top5供应商清单响应"""
    metric_type: str
    metric_name: str
    period: str = Field(..., description="统计周期：daily/monthly/yearly")
    date: date_type
    top_suppliers: List[TopSupplierItem]


class ProcessAnalysisItem(BaseModel):
    """制程质量分析项"""
    category: str = Field(..., description="分类：责任类别/工序/线体")
    category_name: str
    defect_rate: float
    fpy: float
    defect_count: int
    total_count: int
    trend: str = Field(..., description="趋势：improving/stable/worsening")


class ProcessAnalysisResponse(BaseModel):
    """制程质量分析响应"""
    period: str = Field(..., description="统计周期")
    start_date: date_type
    end_date: date_type
    by_responsibility: List[ProcessAnalysisItem] = Field(..., description="按责任类别统计")
    by_process: List[ProcessAnalysisItem] = Field(..., description="按工序统计")
    by_line: List[ProcessAnalysisItem] = Field(..., description="按线体统计")
    monthly_trend: List[Dict[str, Any]] = Field(..., description="月度趋势")


class CustomerAnalysisItem(BaseModel):
    """客户质量分析项"""
    product_type: str
    okm_ppm: float
    mis_3_ppm: float
    mis_12_ppm: float
    complaint_count: int
    trend: str


class CustomerAnalysisResponse(BaseModel):
    """客户质量分析响应"""
    period: str
    start_date: date_type
    end_date: date_type
    by_product_type: List[CustomerAnalysisItem] = Field(..., description="按产品类型统计")
    monthly_trend: List[Dict[str, Any]] = Field(..., description="月度趋势")
    severity_distribution: Dict[str, int] = Field(..., description="严重度分布")
