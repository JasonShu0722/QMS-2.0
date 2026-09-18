"""
供应商会议管理 Pydantic Schemas
Supplier Meeting Management Schemas
"""
from datetime import date, datetime
from typing import Optional
from pydantic import BaseModel, Field, ConfigDict


class SupplierMeetingBase(BaseModel):
    """供应商会议基础模型"""
    meeting_date: Optional[date] = Field(None, description="会议日期")
    actual_attendee_level: Optional[str] = Field(None, description="实际参会最高级别人员")
    attendee_name: Optional[str] = Field(None, description="参会人员姓名")
    attendee_position: Optional[str] = Field(None, description="参会人员职位")
    meeting_minutes: Optional[str] = Field(None, description="会议纪要")
    supplier_attended: bool = Field(True, description="供应商是否参会")


class SupplierMeetingCreate(SupplierMeetingBase):
    """创建供应商会议记录"""
    supplier_id: int = Field(..., description="供应商ID")
    performance_id: int = Field(..., description="关联的绩效评价ID")
    performance_grade: str = Field(..., description="触发会议的绩效等级（C或D）")


class SupplierMeetingUpdate(BaseModel):
    """更新供应商会议记录"""
    meeting_date: Optional[date] = Field(None, description="会议日期")
    actual_attendee_level: Optional[str] = Field(None, description="实际参会最高级别人员")
    attendee_name: Optional[str] = Field(None, description="参会人员姓名")
    attendee_position: Optional[str] = Field(None, description="参会人员职位")
    meeting_minutes: Optional[str] = Field(None, description="会议纪要")
    supplier_attended: Optional[bool] = Field(None, description="供应商是否参会")
    status: Optional[str] = Field(None, description="状态：pending-待召开，completed-已完成，cancelled-已取消")


class SupplierMeetingReportUpload(BaseModel):
    """供应商上传改善报告"""
    improvement_report_path: str = Field(..., description="物料品质问题改善报告路径")


class SupplierMeetingResponse(SupplierMeetingBase):
    """供应商会议响应模型"""
    model_config = ConfigDict(from_attributes=True)
    
    id: int
    supplier_id: int
    performance_id: int
    meeting_number: str
    performance_grade: str
    required_attendee_level: str
    improvement_report_path: Optional[str] = None
    report_uploaded_at: Optional[datetime] = None
    report_uploaded_by: Optional[int] = None
    report_submitted: bool
    penalty_applied: bool
    penalty_reason: Optional[str] = None
    status: str
    recorded_by: Optional[int] = None
    recorded_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    created_by: Optional[int] = None


class SupplierMeetingListResponse(BaseModel):
    """供应商会议列表响应"""
    total: int = Field(..., description="总记录数")
    items: list[SupplierMeetingResponse] = Field(..., description="会议记录列表")
    page: int = Field(..., description="当前页码")
    page_size: int = Field(..., description="每页记录数")


class SupplierMeetingStatistics(BaseModel):
    """供应商会议统计"""
    total_meetings: int = Field(..., description="总会议数")
    pending_meetings: int = Field(..., description="待召开会议数")
    completed_meetings: int = Field(..., description="已完成会议数")
    meetings_with_penalty: int = Field(..., description="有违规处罚的会议数")
    report_submission_rate: float = Field(..., description="报告提交率")
    attendance_rate: float = Field(..., description="参会率")
