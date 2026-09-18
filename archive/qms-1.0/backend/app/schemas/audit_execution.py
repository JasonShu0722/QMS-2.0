"""
审核执行 Pydantic 模型
Audit Execution Schemas - 用于API请求和响应的数据验证
"""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field, field_validator


class AuditExecutionBase(BaseModel):
    """审核执行基础模型"""
    audit_plan_id: int = Field(..., description="审核计划ID")
    template_id: int = Field(..., description="审核模板ID")
    audit_date: datetime = Field(..., description="实际审核日期")
    auditor_id: int = Field(..., description="主审核员ID")
    audit_team: Optional[dict] = Field(None, description="审核组成员列表 (JSON格式)")
    summary: Optional[str] = Field(None, description="审核总结")


class AuditExecutionCreate(AuditExecutionBase):
    """创建审核执行记录请求模型"""
    pass


class ChecklistItemScore(BaseModel):
    """检查表条款评分模型"""
    item_id: str = Field(..., description="条款ID")
    score: int = Field(..., ge=0, le=10, description="评分 (0-10分)")
    comment: Optional[str] = Field(None, description="评价意见")
    evidence_photos: Optional[list[str]] = Field(None, description="证据照片路径列表")
    is_nc: bool = Field(False, description="是否为不符合项")
    nc_description: Optional[str] = Field(None, description="不符合项描述")


class ChecklistSubmit(BaseModel):
    """检查表提交模型"""
    checklist_results: list[ChecklistItemScore] = Field(..., description="检查表结果列表")
    
    @field_validator("checklist_results")
    @classmethod
    def validate_checklist_results(cls, v: list[ChecklistItemScore]) -> list[ChecklistItemScore]:
        """验证检查表结果"""
        if not v:
            raise ValueError("检查表结果不能为空")
        return v


class AuditExecutionUpdate(BaseModel):
    """更新审核执行记录请求模型"""
    audit_date: Optional[datetime] = None
    auditor_id: Optional[int] = None
    audit_team: Optional[dict] = None
    summary: Optional[str] = None
    status: Optional[str] = None
    
    @field_validator("status")
    @classmethod
    def validate_status(cls, v: Optional[str]) -> Optional[str]:
        """验证状态"""
        if v is not None:
            allowed_statuses = ["draft", "completed", "nc_open", "nc_closed"]
            if v not in allowed_statuses:
                raise ValueError(f"状态必须是以下之一: {', '.join(allowed_statuses)}")
        return v


class AuditExecutionResponse(AuditExecutionBase):
    """审核执行记录响应模型"""
    id: int
    checklist_results: dict = Field(..., description="检查表结果 (JSON格式)")
    final_score: Optional[int] = Field(None, description="最终得分 (百分制)")
    grade: Optional[str] = Field(None, description="等级评定 (A/B/C/D)")
    audit_report_path: Optional[str] = Field(None, description="审核报告文件路径")
    status: str = Field(..., description="状态")
    created_at: datetime
    updated_at: datetime
    created_by: Optional[int] = None
    
    class Config:
        from_attributes = True


class AuditExecutionListResponse(BaseModel):
    """审核执行记录列表响应模型"""
    total: int = Field(..., description="总记录数")
    items: list[AuditExecutionResponse] = Field(..., description="审核执行记录列表")
    page: int = Field(..., description="当前页码")
    page_size: int = Field(..., description="每页记录数")


class AuditReportRequest(BaseModel):
    """审核报告生成请求模型"""
    include_radar_chart: bool = Field(True, description="是否包含雷达图")
    include_photos: bool = Field(True, description="是否包含证据照片")


class AuditReportResponse(BaseModel):
    """审核报告响应模型"""
    report_path: str = Field(..., description="报告文件路径")
    report_url: str = Field(..., description="报告下载URL")
