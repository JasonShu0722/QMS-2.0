"""
Trial Production Schemas
试产记录数据校验模型
"""
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
from datetime import datetime, date
from enum import Enum


class TrialStatusEnum(str, Enum):
    """试产状态枚举"""
    PLANNED = "planned"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class IMSSyncStatusEnum(str, Enum):
    """IMS同步状态枚举"""
    PENDING = "pending"
    SYNCED = "synced"
    FAILED = "failed"


class TrialProductionCreate(BaseModel):
    """创建试产记录请求模型"""
    project_id: int = Field(..., description="项目ID")
    work_order: str = Field(..., min_length=1, max_length=100, description="IMS工单号")
    trial_batch: Optional[str] = Field(None, max_length=50, description="试产批次号")
    trial_date: Optional[date] = Field(None, description="试产日期")
    target_metrics: Optional[Dict[str, Any]] = Field(
        None,
        description="目标指标（JSON格式）",
        example={
            "pass_rate": {"target": 95, "unit": "%"},
            "cpk": {"target": 1.33, "unit": ""},
            "dimension_pass_rate": {"target": 100, "unit": "%"}
        }
    )
    summary_comments: Optional[str] = Field(None, description="试产总结评价")

    class Config:
        json_schema_extra = {
            "example": {
                "project_id": 1,
                "work_order": "WO202602140001",
                "trial_batch": "TRIAL-001",
                "trial_date": "2026-02-14",
                "target_metrics": {
                    "pass_rate": {"target": 95, "unit": "%"},
                    "cpk": {"target": 1.33, "unit": ""},
                    "dimension_pass_rate": {"target": 100, "unit": "%"}
                },
                "summary_comments": "首次试产"
            }
        }


class TrialProductionUpdate(BaseModel):
    """更新试产记录请求模型"""
    trial_batch: Optional[str] = Field(None, max_length=50, description="试产批次号")
    trial_date: Optional[date] = Field(None, description="试产日期")
    target_metrics: Optional[Dict[str, Any]] = Field(None, description="目标指标（JSON格式）")
    actual_metrics: Optional[Dict[str, Any]] = Field(None, description="实绩指标（JSON格式）")
    status: Optional[TrialStatusEnum] = Field(None, description="试产状态")
    summary_comments: Optional[str] = Field(None, description="试产总结评价")

    class Config:
        json_schema_extra = {
            "example": {
                "status": "completed",
                "actual_metrics": {
                    "input_qty": 1000,
                    "output_qty": 950,
                    "first_pass_qty": 920,
                    "defect_qty": 30,
                    "pass_rate": {"actual": 96.8, "status": "pass"},
                    "cpk": {"actual": 1.45, "status": "pass"},
                    "dimension_pass_rate": {"actual": 100, "status": "pass"}
                },
                "summary_comments": "试产完成，各项指标达标"
            }
        }


class ManualMetricsInput(BaseModel):
    """手动补录实绩数据请求模型"""
    cpk: Optional[float] = Field(None, ge=0, description="CPK测算值")
    destructive_test_result: Optional[str] = Field(None, description="破坏性实验结果")
    appearance_score: Optional[float] = Field(None, ge=0, le=100, description="外观评审得分")
    dimension_pass_rate: Optional[float] = Field(None, ge=0, le=100, description="尺寸合格率")
    other_metrics: Optional[Dict[str, Any]] = Field(None, description="其他手工录入指标")

    class Config:
        json_schema_extra = {
            "example": {
                "cpk": 1.45,
                "destructive_test_result": "合格",
                "appearance_score": 95.5,
                "dimension_pass_rate": 100.0,
                "other_metrics": {
                    "vibration_test": "通过",
                    "temperature_test": "通过"
                }
            }
        }


class TrialProductionResponse(BaseModel):
    """试产记录响应模型"""
    id: int
    project_id: int
    work_order: str
    trial_batch: Optional[str]
    trial_date: Optional[datetime]
    target_metrics: Optional[Dict[str, Any]]
    actual_metrics: Optional[Dict[str, Any]]
    ims_sync_status: Optional[str]
    ims_sync_at: Optional[datetime]
    ims_sync_error: Optional[str]
    status: str
    summary_report_path: Optional[str]
    summary_comments: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
        json_schema_extra = {
            "example": {
                "id": 1,
                "project_id": 1,
                "work_order": "WO202602140001",
                "trial_batch": "TRIAL-001",
                "trial_date": "2026-02-14T08:00:00",
                "target_metrics": {
                    "pass_rate": {"target": 95, "unit": "%"},
                    "cpk": {"target": 1.33, "unit": ""}
                },
                "actual_metrics": {
                    "input_qty": 1000,
                    "output_qty": 950,
                    "pass_rate": {"actual": 96.8, "status": "pass"}
                },
                "ims_sync_status": "synced",
                "ims_sync_at": "2026-02-14T10:00:00",
                "status": "completed",
                "summary_report_path": "/reports/trial_001.pdf",
                "created_at": "2026-02-14T08:00:00",
                "updated_at": "2026-02-14T10:00:00"
            }
        }


class TrialProductionSummary(BaseModel):
    """试产总结报告模型"""
    trial_production: TrialProductionResponse
    target_vs_actual: Dict[str, Any] = Field(
        ...,
        description="目标值 vs 实绩值对比",
        example={
            "pass_rate": {
                "target": 95,
                "actual": 96.8,
                "status": "pass",
                "unit": "%"
            },
            "cpk": {
                "target": 1.33,
                "actual": 1.45,
                "status": "pass",
                "unit": ""
            }
        }
    )
    overall_status: str = Field(..., description="整体达成状态：pass/fail")
    pass_count: int = Field(..., description="达标指标数量")
    fail_count: int = Field(..., description="未达标指标数量")
    recommendations: Optional[str] = Field(None, description="改进建议")

    class Config:
        json_schema_extra = {
            "example": {
                "trial_production": {
                    "id": 1,
                    "work_order": "WO202602140001",
                    "status": "completed"
                },
                "target_vs_actual": {
                    "pass_rate": {
                        "target": 95,
                        "actual": 96.8,
                        "status": "pass",
                        "unit": "%"
                    }
                },
                "overall_status": "pass",
                "pass_count": 3,
                "fail_count": 0,
                "recommendations": "各项指标均达标，可进入量产阶段"
            }
        }


class IMSSyncRequest(BaseModel):
    """IMS数据同步请求模型"""
    work_order: str = Field(..., description="IMS工单号")
    force_sync: bool = Field(False, description="是否强制重新同步")

    class Config:
        json_schema_extra = {
            "example": {
                "work_order": "WO202602140001",
                "force_sync": False
            }
        }


class IMSSyncResponse(BaseModel):
    """IMS数据同步响应模型"""
    success: bool
    message: str
    synced_data: Optional[Dict[str, Any]] = None
    error: Optional[str] = None

    class Config:
        json_schema_extra = {
            "example": {
                "success": True,
                "message": "IMS数据同步成功",
                "synced_data": {
                    "input_qty": 1000,
                    "output_qty": 950,
                    "first_pass_qty": 920,
                    "defect_qty": 30
                }
            }
        }
