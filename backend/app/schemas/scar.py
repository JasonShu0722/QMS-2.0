"""
SCAR 和 8D 报告的 Pydantic 数据校验模型
"""
from datetime import datetime
from typing import Optional, Dict, Any
from pydantic import BaseModel, Field, validator


# ============ SCAR Schemas ============

def validate_scar_evidence_files(files):
    if files is None:
        return files

    if len(files) > 10:
        raise ValueError("evidence_files cannot contain more than 10 files")

    max_size = 10 * 1024 * 1024
    for file in files:
        if not isinstance(file, dict):
            raise ValueError("each evidence file must be an object")

        file_type = str(file.get("type") or "")
        data_url = str(file.get("data_url") or "")
        if file_type and not file_type.startswith("image/"):
            raise ValueError("SCAR evidence files only support images")
        if data_url and not data_url.startswith("data:image/"):
            raise ValueError("SCAR evidence data_url must be an image")

        size = file.get("size")
        if isinstance(size, (int, float)) and size > max_size:
            raise ValueError("each evidence file cannot exceed 10MB")

    return files


class SCARCreate(BaseModel):
    """创建 SCAR 请求模型"""
    supplier_id: int = Field(..., description="供应商ID")
    material_code: str = Field(..., min_length=1, max_length=100, description="物料编码")
    material_category: Optional[str] = Field(None, description="来料分类：structure/electronic")
    defect_description: str = Field(..., min_length=1, description="缺陷描述")
    defect_qty: int = Field(..., gt=0, description="不良数量")
    evidence_files: Optional[list[Dict[str, Any]]] = Field(None, description="附图佐证")
    severity: str = Field(..., description="严重度: low, medium, high, critical")
    deadline: datetime = Field(..., description="截止日期")
    
    @validator('severity')
    def validate_severity(cls, v):
        allowed = ['low', 'medium', 'high', 'critical']
        if v not in allowed:
            raise ValueError(f'severity must be one of {allowed}')
        return v

    @validator('material_category')
    def validate_material_category(cls, v):
        if v is not None:
            allowed = ['structure', 'electronic']
            if v not in allowed:
                raise ValueError(f'material_category must be one of {allowed}')
        return v

    @validator('evidence_files')
    def validate_evidence_files(cls, v):
        return validate_scar_evidence_files(v)


class SCARUpdate(BaseModel):
    """更新 SCAR 请求模型"""
    supplier_id: Optional[int] = Field(None, description="供应商ID")
    material_code: Optional[str] = Field(None, min_length=1, max_length=100, description="物料编码")
    material_category: Optional[str] = Field(None, description="来料分类：structure/electronic")
    defect_description: Optional[str] = Field(None, min_length=1, description="缺陷描述")
    defect_qty: Optional[int] = Field(None, gt=0, description="不良数量")
    evidence_files: Optional[list[Dict[str, Any]]] = Field(None, description="附图佐证")
    severity: Optional[str] = Field(None, description="严重度")
    deadline: Optional[datetime] = Field(None, description="截止日期")
    current_handler_id: Optional[int] = Field(None, description="当前处理人ID")
    
    @validator('severity')
    def validate_severity(cls, v):
        if v is not None:
            allowed = ['low', 'medium', 'high', 'critical']
            if v not in allowed:
                raise ValueError(f'severity must be one of {allowed}')
        return v

    @validator('material_category')
    def validate_material_category(cls, v):
        if v is not None:
            allowed = ['structure', 'electronic']
            if v not in allowed:
                raise ValueError(f'material_category must be one of {allowed}')
        return v

    @validator('evidence_files')
    def validate_evidence_files(cls, v):
        return validate_scar_evidence_files(v)


class SCARResponse(BaseModel):
    """SCAR 响应模型"""
    id: int
    scar_number: str
    supplier_id: int
    material_code: str
    material_category: Optional[str] = None
    defect_description: str
    defect_qty: int
    evidence_files: Optional[list[Dict[str, Any]]] = None
    severity: str
    status: str
    current_handler_id: Optional[int]
    deadline: datetime
    created_at: datetime
    updated_at: datetime
    
    # 关联数据（可选）
    supplier_name: Optional[str] = None
    current_handler_name: Optional[str] = None
    has_8d_report: bool = False
    
    class Config:
        from_attributes = True


class SCARListQuery(BaseModel):
    """SCAR 列表查询参数"""
    supplier_id: Optional[int] = Field(None, description="供应商ID筛选")
    material_code: Optional[str] = Field(None, description="物料编码筛选")
    status: Optional[str] = Field(None, description="状态筛选")
    severity: Optional[str] = Field(None, description="严重度筛选")
    page: int = Field(1, ge=1, description="页码")
    page_size: int = Field(20, ge=1, le=100, description="每页数量")


class SCARSupplierOption(BaseModel):
    """SCAR 创建时使用的供应商检索选项"""
    id: int
    code: str
    name: str
    status: str


class SCARInternalUserOption(BaseModel):
    """SCAR 8D 提交审核时使用的内部人员选项"""
    id: int
    username: str
    full_name: str
    department: Optional[str] = None
    position: Optional[str] = None


# ============ 8D Report Schemas ============

class EightDSubmit(BaseModel):
    """供应商提交 8D 报告请求模型"""
    d0_d3_data: Optional[Dict[str, Any]] = Field(None, description="D0-D3 阶段数据")
    status: Optional[str] = Field("submitted", description="8D 报告状态：draft/submitted")
    reviewer_id: Optional[int] = Field(None, description="提交审核的供应商质量工程师ID")
    d4_d7_data: Dict[str, Any] = Field(default_factory=dict, description="D4-D7 阶段数据")
    d8_data: Optional[Dict[str, Any]] = Field(None, description="D8 阶段数据")

    @validator('status')
    def validate_status(cls, v):
        allowed = ['draft', 'submitted']
        if v not in allowed:
            raise ValueError(f'status must be one of {allowed}')
        return v
    
    @validator('d4_d7_data')
    def validate_d4_d7(cls, v, values):
        """验证 D4-D7 必填字段"""
        if values.get('status') == 'draft':
            return v or {}

        v = v or {}
        response_mode = v.get('response_mode')
        severity = v.get('severity')
        if response_mode == 'brief' or severity == 'low':
            required_fields = ['root_cause', 'corrective_action', 'completion_time']
        else:
            required_fields = ['root_cause', 'corrective_action', 'preventive_action']

        for field in required_fields:
            if field not in v or not v[field]:
                raise ValueError(f'D4-D7 data must contain {field}')
        return v


class EightDReview(BaseModel):
    """SQE 审核 8D 报告请求模型"""
    review_comments: str = Field(..., min_length=1, description="审核意见")
    approved: bool = Field(..., description="是否批准")


class EightDResponse(BaseModel):
    """8D 报告响应模型"""
    id: int
    scar_id: int
    d0_d3_data: Optional[Dict[str, Any]]
    d4_d7_data: Optional[Dict[str, Any]]
    d8_data: Optional[Dict[str, Any]]
    status: str
    submitted_by: Optional[int]
    reviewed_by: Optional[int]
    review_comments: Optional[str]
    created_at: datetime
    updated_at: datetime
    submitted_at: Optional[datetime]
    reviewed_at: Optional[datetime]
    
    # 关联数据（可选）
    submitter_name: Optional[str] = None
    reviewer_name: Optional[str] = None
    scar_number: Optional[str] = None
    approval_workflow: Optional[Dict[str, Any]] = None
    current_approval_level: Optional[str] = None
    current_approval_level_label: Optional[str] = None
    current_approval_user_id: Optional[int] = None
    current_approval_user_name: Optional[str] = None
    
    class Config:
        from_attributes = True


# ============ AI Pre-review Schemas ============

class AIPreReviewRequest(BaseModel):
    """AI 预审请求模型"""
    eight_d_data: Dict[str, Any] = Field(..., description="8D 报告数据")
    supplier_id: int = Field(..., description="供应商ID")


class AIPreReviewResponse(BaseModel):
    """AI 预审响应模型"""
    passed: bool = Field(..., description="是否通过预审")
    issues: list[str] = Field(default_factory=list, description="发现的问题列表")
    suggestions: list[str] = Field(default_factory=list, description="改进建议列表")
    duplicate_check: Optional[Dict[str, Any]] = Field(None, description="历史查重结果")
