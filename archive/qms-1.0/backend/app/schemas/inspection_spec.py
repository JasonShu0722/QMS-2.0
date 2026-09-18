"""
物料检验规范 Pydantic 模型
Inspection Specification Schemas - 数据校验与序列化
"""
from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field, field_validator


class KeyCharacteristic(BaseModel):
    """关键检验项目"""
    item: str = Field(..., description="检验项目名称")
    spec: str = Field(..., description="规格要求")
    method: str = Field(..., description="检验方法")
    sample_size: int = Field(..., description="抽样数量", ge=1)
    acceptance_criteria: Optional[str] = Field(None, description="接收标准")


class InspectionSpecCreate(BaseModel):
    """创建检验规范请求（SQE 发起）"""
    material_code: str = Field(..., description="物料编码", min_length=1, max_length=100)
    supplier_id: int = Field(..., description="供应商ID", gt=0)
    report_frequency_type: str = Field(
        "batch",
        description="报告频率类型",
        pattern="^(batch|weekly|monthly|quarterly)$"
    )
    
    @field_validator("report_frequency_type")
    @classmethod
    def validate_frequency_type(cls, v: str) -> str:
        """验证报告频率类型"""
        allowed = ["batch", "weekly", "monthly", "quarterly"]
        if v not in allowed:
            raise ValueError(f"报告频率类型必须是以下之一: {', '.join(allowed)}")
        return v


class InspectionSpecSubmit(BaseModel):
    """供应商提交 SIP"""
    key_characteristics: List[KeyCharacteristic] = Field(..., description="关键检验项目列表", min_length=1)
    sip_file_path: str = Field(..., description="SIP 文件路径（双方签字版 PDF）", min_length=1, max_length=500)
    
    @field_validator("key_characteristics")
    @classmethod
    def validate_key_characteristics(cls, v: List[KeyCharacteristic]) -> List[KeyCharacteristic]:
        """验证关键检验项目不为空"""
        if not v:
            raise ValueError("关键检验项目列表不能为空")
        return v


class InspectionSpecApprove(BaseModel):
    """SQE 审批检验规范"""
    approved: bool = Field(..., description="是否批准")
    review_comments: Optional[str] = Field(None, description="审核意见", max_length=1000)
    effective_date: Optional[datetime] = Field(None, description="生效日期（批准时必填）")
    
    @field_validator("review_comments")
    @classmethod
    def validate_review_comments(cls, v: Optional[str], info) -> Optional[str]:
        """驳回时必须填写审核意见"""
        approved = info.data.get("approved")
        if not approved and not v:
            raise ValueError("驳回时必须填写审核意见")
        return v
    
    @field_validator("effective_date")
    @classmethod
    def validate_effective_date(cls, v: Optional[datetime], info) -> Optional[datetime]:
        """批准时必须填写生效日期"""
        approved = info.data.get("approved")
        if approved and not v:
            raise ValueError("批准时必须填写生效日期")
        return v


class InspectionSpecUpdate(BaseModel):
    """更新检验规范（版本升级）"""
    report_frequency_type: Optional[str] = Field(
        None,
        description="报告频率类型",
        pattern="^(batch|weekly|monthly|quarterly)$"
    )


class InspectionSpecResponse(BaseModel):
    """检验规范响应"""
    id: int
    material_code: str
    supplier_id: int
    version: str
    sip_file_path: Optional[str]
    key_characteristics: Optional[List[Dict[str, Any]]]
    report_frequency_type: Optional[str]
    status: str
    reviewer_id: Optional[int]
    review_comments: Optional[str]
    approved_at: Optional[datetime]
    effective_date: Optional[datetime]
    created_at: datetime
    updated_at: datetime
    created_by: Optional[int]
    
    class Config:
        from_attributes = True


class InspectionSpecListResponse(BaseModel):
    """检验规范列表响应"""
    total: int = Field(..., description="总数")
    items: List[InspectionSpecResponse] = Field(..., description="检验规范列表")
    page: int = Field(..., description="当前页码")
    page_size: int = Field(..., description="每页数量")


class ReportTaskCreate(BaseModel):
    """定期报告提交任务创建（系统自动生成）"""
    inspection_spec_id: int = Field(..., description="检验规范ID", gt=0)
    due_date: datetime = Field(..., description="截止日期")
    report_period: str = Field(..., description="报告周期（如：2024-W01, 2024-01）")

