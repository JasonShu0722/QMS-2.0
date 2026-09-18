"""
供应商生命周期管理 Pydantic Schemas
Supplier Lifecycle Management Schemas
"""
from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field, field_validator


# ==================== 供应商准入审核 ====================

class SupplierQualificationCreate(BaseModel):
    """供应商准入审核创建"""
    supplier_id: int = Field(..., description="供应商ID")
    qualification_type: str = Field(..., description="准入类型: new_supplier, requalification")
    review_comment: Optional[str] = Field(None, description="审核意见")
    
    @field_validator('qualification_type')
    @classmethod
    def validate_qualification_type(cls, v):
        allowed = ['new_supplier', 'requalification']
        if v not in allowed:
            raise ValueError(f'qualification_type must be one of {allowed}')
        return v


class SupplierQualificationResponse(BaseModel):
    """供应商准入审核响应"""
    id: int
    supplier_id: int
    qualification_type: str
    status: str
    review_comment: Optional[str]
    reviewed_by: Optional[int]
    reviewed_at: Optional[datetime]
    created_at: datetime
    
    class Config:
        from_attributes = True


# ==================== 供应商资质文件 ====================

class SupplierDocumentUpload(BaseModel):
    """供应商资质文件上传"""
    supplier_id: int = Field(..., description="供应商ID")
    document_type: str = Field(..., description="文件类型")
    document_name: str = Field(..., description="文件名称")
    file_path: str = Field(..., description="文件路径")
    file_size: Optional[int] = Field(None, description="文件大小")
    issue_date: Optional[datetime] = Field(None, description="签发日期")
    expiry_date: Optional[datetime] = Field(None, description="到期日期")
    
    @field_validator('document_type')
    @classmethod
    def validate_document_type(cls, v):
        allowed = ['iso9001', 'iatf16949', 'business_license', 'other']
        if v not in allowed:
            raise ValueError(f'document_type must be one of {allowed}')
        return v


class SupplierDocumentReview(BaseModel):
    """供应商资质文件审核"""
    review_status: str = Field(..., description="审核状态: approved, rejected")
    review_comment: Optional[str] = Field(None, description="审核意见")
    
    @field_validator('review_status')
    @classmethod
    def validate_review_status(cls, v):
        allowed = ['approved', 'rejected']
        if v not in allowed:
            raise ValueError(f'review_status must be one of {allowed}')
        return v


class SupplierDocumentResponse(BaseModel):
    """供应商资质文件响应"""
    id: int
    supplier_id: int
    document_type: str
    document_name: str
    file_path: str
    file_size: Optional[int]
    issue_date: Optional[datetime]
    expiry_date: Optional[datetime]
    review_status: str
    review_comment: Optional[str]
    reviewed_by: Optional[int]
    reviewed_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime
    uploaded_by: Optional[int]
    
    class Config:
        from_attributes = True


# ==================== 供应商变更管理 (PCN) ====================

class SupplierPCNCreate(BaseModel):
    """供应商变更申请创建"""
    supplier_id: int = Field(..., description="供应商ID")
    change_type: str = Field(..., description="变更类型")
    material_code: Optional[str] = Field(None, description="物料编码")
    change_description: str = Field(..., description="变更描述")
    change_reason: str = Field(..., description="变更原因")
    impact_assessment: Optional[Dict[str, Any]] = Field(None, description="影响评估")
    risk_level: Optional[str] = Field(None, description="风险等级")
    planned_implementation_date: Optional[datetime] = Field(None, description="计划实施日期")
    attachments: Optional[Dict[str, Any]] = Field(None, description="附件列表")
    
    @field_validator('change_type')
    @classmethod
    def validate_change_type(cls, v):
        allowed = ['material', 'process', 'equipment', 'location', 'design']
        if v not in allowed:
            raise ValueError(f'change_type must be one of {allowed}')
        return v
    
    @field_validator('risk_level')
    @classmethod
    def validate_risk_level(cls, v):
        if v is not None:
            allowed = ['low', 'medium', 'high']
            if v not in allowed:
                raise ValueError(f'risk_level must be one of {allowed}')
        return v


class SupplierPCNUpdate(BaseModel):
    """供应商变更申请更新"""
    status: Optional[str] = Field(None, description="状态")
    review_comment: Optional[str] = Field(None, description="审核意见")
    actual_implementation_date: Optional[datetime] = Field(None, description="实际实施日期")
    cutoff_info: Optional[Dict[str, Any]] = Field(None, description="断点信息")
    
    @field_validator('status')
    @classmethod
    def validate_status(cls, v):
        if v is not None:
            allowed = ['submitted', 'under_review', 'approved', 'rejected', 'implemented']
            if v not in allowed:
                raise ValueError(f'status must be one of {allowed}')
        return v


class SupplierPCNResponse(BaseModel):
    """供应商变更申请响应"""
    id: int
    pcn_number: str
    supplier_id: int
    change_type: str
    material_code: Optional[str]
    change_description: str
    change_reason: str
    impact_assessment: Optional[Dict[str, Any]]
    risk_level: Optional[str]
    planned_implementation_date: Optional[datetime]
    actual_implementation_date: Optional[datetime]
    cutoff_info: Optional[Dict[str, Any]]
    status: str
    current_reviewer_id: Optional[int]
    review_comments: Optional[Dict[str, Any]]
    approved_by: Optional[int]
    approved_at: Optional[datetime]
    attachments: Optional[Dict[str, Any]]
    created_at: datetime
    updated_at: datetime
    submitted_by: Optional[int]
    
    class Config:
        from_attributes = True


# ==================== 供应商审核计划 ====================

class SupplierAuditPlanCreate(BaseModel):
    """供应商审核计划创建"""
    supplier_id: int = Field(..., description="供应商ID")
    audit_year: int = Field(..., description="审核年度")
    audit_month: int = Field(..., ge=1, le=12, description="计划审核月份")
    audit_type: str = Field(..., description="审核类型")
    auditor_id: int = Field(..., description="审核员ID")
    notes: Optional[str] = Field(None, description="备注")
    
    @field_validator('audit_type')
    @classmethod
    def validate_audit_type(cls, v):
        allowed = ['system', 'process', 'product', 'qualification']
        if v not in allowed:
            raise ValueError(f'audit_type must be one of {allowed}')
        return v


class SupplierAuditPlanResponse(BaseModel):
    """供应商审核计划响应"""
    id: int
    supplier_id: int
    audit_year: int
    audit_month: int
    audit_type: str
    auditor_id: int
    status: str
    notes: Optional[str]
    created_at: datetime
    updated_at: datetime
    created_by: Optional[int]
    
    class Config:
        from_attributes = True


# ==================== 供应商审核记录 ====================

class SupplierAuditCreate(BaseModel):
    """供应商审核记录创建"""
    audit_plan_id: Optional[int] = Field(None, description="审核计划ID")
    supplier_id: int = Field(..., description="供应商ID")
    audit_type: str = Field(..., description="审核类型")
    audit_date: datetime = Field(..., description="审核日期")
    auditor_id: int = Field(..., description="主审核员ID")
    audit_team: Optional[Dict[str, Any]] = Field(None, description="审核组成员")
    audit_result: str = Field(..., description="审核结果")
    score: Optional[int] = Field(None, ge=0, le=100, description="审核得分")
    nc_major_count: int = Field(0, ge=0, description="严重不符合项数量")
    nc_minor_count: int = Field(0, ge=0, description="一般不符合项数量")
    nc_observation_count: int = Field(0, ge=0, description="观察项数量")
    audit_report_path: Optional[str] = Field(None, description="审核报告路径")
    summary: Optional[str] = Field(None, description="审核总结")
    
    @field_validator('audit_type')
    @classmethod
    def validate_audit_type(cls, v):
        allowed = ['system', 'process', 'product', 'qualification']
        if v not in allowed:
            raise ValueError(f'audit_type must be one of {allowed}')
        return v
    
    @field_validator('audit_result')
    @classmethod
    def validate_audit_result(cls, v):
        allowed = ['passed', 'conditional_passed', 'failed']
        if v not in allowed:
            raise ValueError(f'audit_result must be one of {allowed}')
        return v


class SupplierAuditResponse(BaseModel):
    """供应商审核记录响应"""
    id: int
    audit_plan_id: Optional[int]
    supplier_id: int
    audit_number: str
    audit_type: str
    audit_date: datetime
    auditor_id: int
    audit_team: Optional[Dict[str, Any]]
    audit_result: str
    score: Optional[int]
    nc_major_count: int
    nc_minor_count: int
    nc_observation_count: int
    audit_report_path: Optional[str]
    summary: Optional[str]
    status: str
    created_at: datetime
    updated_at: datetime
    created_by: Optional[int]
    
    class Config:
        from_attributes = True


# ==================== 供应商审核不符合项 (NC) ====================

class SupplierAuditNCCreate(BaseModel):
    """供应商审核不符合项创建"""
    audit_id: int = Field(..., description="审核记录ID")
    nc_type: str = Field(..., description="NC类型")
    nc_item: str = Field(..., description="不符合条款")
    nc_description: str = Field(..., description="不符合描述")
    evidence_photos: Optional[Dict[str, Any]] = Field(None, description="证据照片")
    responsible_dept: Optional[str] = Field(None, description="责任部门")
    assigned_to: Optional[int] = Field(None, description="指派给")
    deadline: Optional[datetime] = Field(None, description="整改期限")
    
    @field_validator('nc_type')
    @classmethod
    def validate_nc_type(cls, v):
        allowed = ['major', 'minor', 'observation']
        if v not in allowed:
            raise ValueError(f'nc_type must be one of {allowed}')
        return v


class SupplierAuditNCUpdate(BaseModel):
    """供应商审核不符合项更新"""
    assigned_to: Optional[int] = Field(None, description="指派给")
    root_cause: Optional[str] = Field(None, description="根本原因")
    corrective_action: Optional[str] = Field(None, description="纠正措施")
    corrective_evidence: Optional[Dict[str, Any]] = Field(None, description="整改证据")
    verification_status: Optional[str] = Field(None, description="验证状态")
    verification_comment: Optional[str] = Field(None, description="验证意见")
    
    @field_validator('verification_status')
    @classmethod
    def validate_verification_status(cls, v):
        if v is not None:
            allowed = ['open', 'submitted', 'verified', 'closed']
            if v not in allowed:
                raise ValueError(f'verification_status must be one of {allowed}')
        return v


class SupplierAuditNCResponse(BaseModel):
    """供应商审核不符合项响应"""
    id: int
    audit_id: int
    nc_number: str
    nc_type: str
    nc_item: str
    nc_description: str
    evidence_photos: Optional[Dict[str, Any]]
    responsible_dept: Optional[str]
    assigned_to: Optional[int]
    root_cause: Optional[str]
    corrective_action: Optional[str]
    corrective_evidence: Optional[Dict[str, Any]]
    verification_status: str
    verified_by: Optional[int]
    verified_at: Optional[datetime]
    verification_comment: Optional[str]
    deadline: Optional[datetime]
    closed_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime
    created_by: Optional[int]
    
    class Config:
        from_attributes = True


# ==================== 证书到期预警 ====================

class CertificateExpiryWarning(BaseModel):
    """证书到期预警"""
    supplier_id: int
    supplier_name: str
    document_id: int
    document_type: str
    document_name: str
    expiry_date: datetime
    days_until_expiry: int
    warning_level: str  # critical, warning, info
    
    class Config:
        from_attributes = True
