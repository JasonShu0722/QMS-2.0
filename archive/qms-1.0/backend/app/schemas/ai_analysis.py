"""
AI 智能诊断 Pydantic 模型
AI Analysis Schemas - 数据校验与序列化模型

Requirements: 2.4.4
"""
from typing import Optional, List, Dict, Any
from datetime import date
from pydantic import BaseModel, Field


class AnomalyDiagnoseRequest(BaseModel):
    """异常诊断请求"""
    metric_type: str = Field(..., description="指标类型")
    metric_date: date = Field(..., description="指标日期")
    current_value: float = Field(..., description="当前值")
    historical_avg: float = Field(..., description="历史平均值")
    supplier_id: Optional[int] = Field(None, description="供应商ID")
    product_type: Optional[str] = Field(None, description="产品类型")
    
    model_config = {
        "json_schema_extra": {
            "example": {
                "metric_type": "material_online_ppm",
                "metric_date": "2024-01-15",
                "current_value": 850.5,
                "historical_avg": 320.0,
                "supplier_id": 1,
                "product_type": "MCU"
            }
        }
    }


class AnomalyDiagnoseResponse(BaseModel):
    """异常诊断响应"""
    anomaly_detected: bool = Field(..., description="是否检测到异常")
    severity: Optional[str] = Field(None, description="严重程度: low/medium/high")
    change_percentage: Optional[float] = Field(None, description="变化百分比")
    root_causes: List[str] = Field(default_factory=list, description="可能的根本原因")
    recommendations: List[str] = Field(default_factory=list, description="建议措施")
    related_indicators: List[str] = Field(default_factory=list, description="相关指标")
    context: Optional[Dict[str, Any]] = Field(None, description="上下文数据")
    error: Optional[str] = Field(None, description="错误信息")
    
    model_config = {
        "json_schema_extra": {
            "example": {
                "anomaly_detected": True,
                "severity": "high",
                "change_percentage": 165.78,
                "root_causes": [
                    "供应商来料批次质量波动",
                    "检验标准执行不严格",
                    "物料存储环境异常"
                ],
                "recommendations": [
                    "立即对该供应商进行驻厂审核",
                    "加强来料检验抽样频率",
                    "检查仓库温湿度记录"
                ],
                "related_indicators": [
                    "来料批次合格率",
                    "制程不合格率"
                ]
            }
        }
    }


class NaturalLanguageQueryRequest(BaseModel):
    """自然语言查询请求"""
    question: str = Field(..., description="用户的自然语言问题", min_length=1)
    
    model_config = {
        "json_schema_extra": {
            "example": {
                "question": "帮我把过去三个月MCU产品的0KM不良率趋势画成折线图，并对比一下去年同期的数据"
            }
        }
    }


class NaturalLanguageQueryResponse(BaseModel):
    """自然语言查询响应"""
    success: bool = Field(..., description="查询是否成功")
    understood_query: Optional[str] = Field(None, description="AI理解的查询意图")
    sql_query: Optional[str] = Field(None, description="生成的SQL查询（仅供参考）")
    data: Optional[List[Dict[str, Any]]] = Field(None, description="查询结果数据")
    chart_type: Optional[str] = Field(None, description="建议的图表类型")
    explanation: Optional[str] = Field(None, description="结果解释")
    row_count: Optional[int] = Field(None, description="返回行数")
    error: Optional[str] = Field(None, description="错误信息")
    
    model_config = {
        "json_schema_extra": {
            "example": {
                "success": True,
                "understood_query": "查询过去三个月MCU产品的0KM不良率趋势",
                "sql_query": "SELECT metric_date, value FROM quality_metrics WHERE metric_type='okm_ppm' AND product_type='MCU' AND metric_date >= '2024-10-01' ORDER BY metric_date",
                "data": [
                    {"metric_date": "2024-10-01", "value": 120.5},
                    {"metric_date": "2024-11-01", "value": 98.3},
                    {"metric_date": "2024-12-01", "value": 85.7}
                ],
                "chart_type": "line",
                "explanation": "数据显示MCU产品的0KM不良率呈下降趋势，从120.5 PPM降至85.7 PPM",
                "row_count": 3
            }
        }
    }


class ChartGenerationRequest(BaseModel):
    """图表生成请求"""
    description: str = Field(..., description="用户对图表的描述", min_length=1)
    data: Optional[List[Dict[str, Any]]] = Field(None, description="可选的数据")
    
    model_config = {
        "json_schema_extra": {
            "example": {
                "description": "生成一个折线图，展示过去7天的制程不合格率趋势",
                "data": [
                    {"date": "2024-01-08", "value": 2.5},
                    {"date": "2024-01-09", "value": 2.3},
                    {"date": "2024-01-10", "value": 2.8}
                ]
            }
        }
    }


class ChartGenerationResponse(BaseModel):
    """图表生成响应"""
    success: bool = Field(..., description="生成是否成功")
    chart_type: Optional[str] = Field(None, description="图表类型")
    echarts_config: Optional[Dict[str, Any]] = Field(None, description="ECharts配置对象")
    description: Optional[str] = Field(None, description="图表说明")
    error: Optional[str] = Field(None, description="错误信息")
    
    model_config = {
        "json_schema_extra": {
            "example": {
                "success": True,
                "chart_type": "line",
                "echarts_config": {
                    "title": {"text": "制程不合格率趋势"},
                    "tooltip": {"trigger": "axis"},
                    "xAxis": {"type": "category", "data": ["2024-01-08", "2024-01-09", "2024-01-10"]},
                    "yAxis": {"type": "value", "name": "不合格率(%)"},
                    "series": [{"type": "line", "data": [2.5, 2.3, 2.8]}]
                },
                "description": "展示过去7天的制程不合格率变化趋势"
            }
        }
    }
