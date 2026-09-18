"""
Lesson Learned Schemas
经验教训相关的Pydantic数据校验模型
"""
from pydantic import BaseModel, Field, validator
from typing import Optional, List
from datetime import datetime
from enum import Enum


class SourceModuleEnum(str, Enum):
    """经验教训来源模块枚举"""
    SUPPLIER_QUALITY = "supplier_quality"
    PROCESS_QUALITY = "process_quality"
    CUSTOMER_QUALITY = "customer_quality"
    MANUAL = "manual"


class LessonLearnedCreate(BaseModel):
    """创建经验教训请求模型"""
    lesson_title: str = Field(..., min_length=5, max_length=200, description="经验教训标题")
    lesson_content: str = Field(..., min_length=10, description="经验教训详细内容")
    source_module: SourceModuleEnum = Field(..., description="来源模块")
    source_record_id: Optional[int] = Field(None, description="来源记录ID（8D报告ID等）")
    root_cause: str = Field(..., min_length=10, description="根本原因")
    preventive_action: str = Field(..., min_length=10, description="预防措施")
    applicable_scenarios: Optional[str] = Field(None, description="适用场景描述")
    is_active: bool = Field(True, description="是否启用")
    
    class Config:
        json_schema_extra = {
            "example": {
                "lesson_title": "供应商模具老化导致尺寸超差",
                "lesson_content": "供应商A在2023年Q4连续3批次出现尺寸超差问题，根本原因为模具使用超过5年未进行保养",
                "source_module": "supplier_quality",
                "source_record_id": 123,
                "root_cause": "模具老化，未按周期保养",
                "preventive_action": "1. 要求供应商建立模具保养台账 2. 每季度提交模具状态报告 3. 关键尺寸增加首件检验",
                "applicable_scenarios": "注塑件、压铸件等模具加工产品",
                "is_active": True
            }
        }


class LessonLearnedUpdate(BaseModel):
    """更新经验教训请求模型"""
    lesson_title: Optional[str] = Field(None, min_length=5, max_length=200)
    lesson_content: Optional[str] = Field(None, min_length=10)
    root_cause: Optional[str] = Field(None, min_length=10)
    preventive_action: Optional[str] = Field(None, min_length=10)
    applicable_scenarios: Optional[str] = None
    is_active: Optional[bool] = None


class LessonLearnedResponse(BaseModel):
    """经验教训响应模型"""
    id: int
    lesson_title: str
    lesson_content: str
    source_module: str
    source_record_id: Optional[int]
    root_cause: str
    preventive_action: str
    applicable_scenarios: Optional[str]
    is_active: bool
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class LessonLearnedListResponse(BaseModel):
    """经验教训列表响应模型"""
    total: int
    items: List[LessonLearnedResponse]
    page: int
    page_size: int


class ProjectLessonCheckRequest(BaseModel):
    """项目经验教训点检请求模型"""
    lesson_id: int = Field(..., description="经验教训ID")
    is_applicable: bool = Field(..., description="是否适用于本项目")
    reason_if_not: Optional[str] = Field(None, description="不适用原因说明")
    evidence_description: Optional[str] = Field(None, description="规避措施描述")
    
    @validator('reason_if_not')
    def validate_reason_if_not(cls, v, values):
        """如果不适用，必须填写原因"""
        if 'is_applicable' in values and not values['is_applicable']:
            if not v or len(v.strip()) < 10:
                raise ValueError("不适用时必须填写原因说明（至少10字）")
        return v
    
    class Config:
        json_schema_extra = {
            "example": {
                "lesson_id": 1,
                "is_applicable": True,
                "reason_if_not": None,
                "evidence_description": "已在设计评审阶段要求供应商提供模具保养记录，并在PPAP文件中增加模具状态检查项"
            }
        }


class ProjectLessonCheckBatchRequest(BaseModel):
    """批量点检请求模型"""
    checks: List[ProjectLessonCheckRequest] = Field(..., description="点检列表")


class ProjectLessonCheckResponse(BaseModel):
    """项目经验教训点检响应模型"""
    id: int
    project_id: int
    lesson_id: int
    lesson_title: str  # 关联查询获取
    is_applicable: bool
    reason_if_not: Optional[str]
    evidence_file_path: Optional[str]
    evidence_description: Optional[str]
    checked_by: Optional[int]
    checked_at: Optional[datetime]
    verified_by: Optional[int]
    verified_at: Optional[datetime]
    verification_result: Optional[str]
    verification_comment: Optional[str]
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class EvidenceUploadResponse(BaseModel):
    """证据上传响应模型"""
    check_id: int
    file_path: str
    uploaded_at: datetime


class LessonLearnedPushResponse(BaseModel):
    """经验教训推送响应模型"""
    project_id: int
    project_name: str
    pushed_lessons: List[LessonLearnedResponse]
    total_pushed: int
    message: str
