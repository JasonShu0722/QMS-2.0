"""
New Product Project Schemas
新品项目相关的Pydantic数据校验模型
"""
from pydantic import BaseModel, Field, validator
from typing import Optional, List
from datetime import datetime
from enum import Enum


class ProjectStageEnum(str, Enum):
    """项目阶段枚举"""
    CONCEPT = "concept"
    DESIGN = "design"
    DEVELOPMENT = "development"
    VALIDATION = "validation"
    TRIAL_PRODUCTION = "trial_production"
    SOP = "sop"
    CLOSED = "closed"


class ProjectStatusEnum(str, Enum):
    """项目状态枚举"""
    ACTIVE = "active"
    ON_HOLD = "on_hold"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class ReviewResultEnum(str, Enum):
    """评审结果枚举"""
    PASSED = "passed"
    CONDITIONAL_PASS = "conditional_pass"
    FAILED = "failed"
    PENDING = "pending"


# ==================== 交付物相关 ====================

class DeliverableItem(BaseModel):
    """交付物条目"""
    name: str = Field(..., description="交付物名称")
    required: bool = Field(True, description="是否必需")
    file_path: Optional[str] = Field(None, description="文件路径")
    status: str = Field("missing", description="状态：missing/submitted/approved")
    description: Optional[str] = Field(None, description="说明")
    uploaded_at: Optional[datetime] = Field(None, description="上传时间")
    uploaded_by: Optional[int] = Field(None, description="上传人ID")


class DeliverableUploadRequest(BaseModel):
    """上传交付物请求"""
    deliverable_name: str = Field(..., description="交付物名称")
    file_path: str = Field(..., description="文件路径")
    description: Optional[str] = Field(None, description="说明")


# ==================== 项目创建与更新 ====================

class NewProductProjectCreate(BaseModel):
    """创建新品项目请求"""
    project_code: str = Field(..., min_length=1, max_length=50, description="项目代码")
    project_name: str = Field(..., min_length=1, max_length=200, description="项目名称")
    product_type: Optional[str] = Field(None, max_length=100, description="产品类型")
    project_manager: Optional[str] = Field(None, max_length=100, description="项目经理")
    project_manager_id: Optional[int] = Field(None, description="项目经理用户ID")
    planned_sop_date: Optional[datetime] = Field(None, description="计划SOP日期")
    
    @validator('project_code')
    def validate_project_code(cls, v):
        """验证项目代码格式"""
        if not v or not v.strip():
            raise ValueError("项目代码不能为空")
        return v.strip().upper()


class NewProductProjectUpdate(BaseModel):
    """更新新品项目请求"""
    project_name: Optional[str] = Field(None, max_length=200, description="项目名称")
    product_type: Optional[str] = Field(None, max_length=100, description="产品类型")
    project_manager: Optional[str] = Field(None, max_length=100, description="项目经理")
    project_manager_id: Optional[int] = Field(None, description="项目经理用户ID")
    current_stage: Optional[ProjectStageEnum] = Field(None, description="当前阶段")
    status: Optional[ProjectStatusEnum] = Field(None, description="项目状态")
    planned_sop_date: Optional[datetime] = Field(None, description="计划SOP日期")
    actual_sop_date: Optional[datetime] = Field(None, description="实际SOP日期")


class NewProductProjectResponse(BaseModel):
    """新品项目响应"""
    id: int
    project_code: str
    project_name: str
    product_type: Optional[str]
    project_manager: Optional[str]
    project_manager_id: Optional[int]
    current_stage: str
    status: str
    planned_sop_date: Optional[datetime]
    actual_sop_date: Optional[datetime]
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


# ==================== 阶段评审相关 ====================

class StageReviewCreate(BaseModel):
    """创建阶段评审请求"""
    stage_name: str = Field(..., min_length=1, max_length=100, description="阶段名称")
    planned_review_date: Optional[datetime] = Field(None, description="计划评审日期")
    deliverables: Optional[List[DeliverableItem]] = Field(None, description="交付物清单")
    reviewer_ids: Optional[str] = Field(None, description="评审人ID列表（逗号分隔）")


class StageReviewUpdate(BaseModel):
    """更新阶段评审请求"""
    stage_name: Optional[str] = Field(None, max_length=100, description="阶段名称")
    review_date: Optional[datetime] = Field(None, description="评审日期")
    planned_review_date: Optional[datetime] = Field(None, description="计划评审日期")
    deliverables: Optional[List[DeliverableItem]] = Field(None, description="交付物清单")
    review_result: Optional[ReviewResultEnum] = Field(None, description="评审结果")
    review_comments: Optional[str] = Field(None, description="评审意见")
    reviewer_ids: Optional[str] = Field(None, description="评审人ID列表")
    conditional_requirements: Optional[str] = Field(None, description="有条件通过时的整改要求")
    conditional_deadline: Optional[datetime] = Field(None, description="整改截止日期")


class StageReviewApprovalRequest(BaseModel):
    """阶段评审批准请求"""
    review_result: ReviewResultEnum = Field(..., description="评审结果")
    review_comments: Optional[str] = Field(None, description="评审意见")
    conditional_requirements: Optional[str] = Field(None, description="有条件通过时的整改要求")
    conditional_deadline: Optional[datetime] = Field(None, description="整改截止日期")
    
    @validator('conditional_requirements')
    def validate_conditional_requirements(cls, v, values):
        """验证有条件通过时必须填写整改要求"""
        if values.get('review_result') == ReviewResultEnum.CONDITIONAL_PASS and not v:
            raise ValueError("有条件通过时必须填写整改要求")
        return v


class StageReviewResponse(BaseModel):
    """阶段评审响应"""
    id: int
    project_id: int
    stage_name: str
    review_date: Optional[datetime]
    planned_review_date: Optional[datetime]
    deliverables: Optional[List[dict]]
    review_result: str
    review_comments: Optional[str]
    reviewer_ids: Optional[str]
    conditional_requirements: Optional[str]
    conditional_deadline: Optional[datetime]
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True
