"""
PPAP Pydantic 模型
Production Part Approval Process - 生产件批准程序
"""
from datetime import date, datetime
from typing import Optional, Dict, List
from pydantic import BaseModel, Field, field_validator


# ==================== 18项标准文件清单 ====================
# 根据 AIAG PPAP 第4版标准定义
PPAP_STANDARD_DOCUMENTS = {
    "psw": {"name": "Part Submission Warrant (PSW)", "name_cn": "零件提交保证书", "required": True},
    "design_records": {"name": "Design Records", "name_cn": "设计记录", "required": False},
    "engineering_change": {"name": "Engineering Change Documents", "name_cn": "工程更改文件", "required": False},
    "customer_approval": {"name": "Customer Engineering Approval", "name_cn": "客户工程批准", "required": False},
    "dfmea": {"name": "Design FMEA", "name_cn": "设计FMEA", "required": False},
    "process_flow": {"name": "Process Flow Diagram", "name_cn": "过程流程图", "required": True},
    "pfmea": {"name": "Process FMEA", "name_cn": "过程FMEA", "required": True},
    "control_plan": {"name": "Control Plan", "name_cn": "控制计划", "required": True},
    "msa": {"name": "Measurement System Analysis", "name_cn": "测量系统分析", "required": True},
    "dimensional_results": {"name": "Dimensional Results", "name_cn": "尺寸测量结果", "required": True},
    "material_test": {"name": "Material/Performance Test Results", "name_cn": "材料/性能测试结果", "required": True},
    "initial_process": {"name": "Initial Process Studies", "name_cn": "初始过程研究", "required": True},
    "qualified_lab": {"name": "Qualified Laboratory Documentation", "name_cn": "合格实验室文件", "required": False},
    "appearance_approval": {"name": "Appearance Approval Report", "name_cn": "外观批准报告", "required": False},
    "sample_products": {"name": "Sample Production Parts", "name_cn": "样品生产件", "required": True},
    "master_sample": {"name": "Master Sample", "name_cn": "标准样品", "required": False},
    "checking_aids": {"name": "Checking Aids", "name_cn": "检查辅具", "required": False},
    "customer_specific": {"name": "Customer-Specific Requirements", "name_cn": "客户特殊要求", "required": False}
}


class PPAPDocumentItem(BaseModel):
    """PPAP 单个文件项"""
    document_key: str = Field(..., description="文件键名（如：psw, pfmea）")
    document_name: str = Field(..., description="文件名称")
    document_name_cn: str = Field(..., description="文件中文名称")
    required: bool = Field(default=False, description="是否必需")
    uploaded: bool = Field(default=False, description="是否已上传")
    file_path: Optional[str] = Field(None, description="文件路径")
    uploaded_at: Optional[datetime] = Field(None, description="上传时间")
    uploaded_by: Optional[int] = Field(None, description="上传人ID")
    review_status: Optional[str] = Field(None, description="审核状态：pending/approved/rejected")
    review_comments: Optional[str] = Field(None, description="审核意见")
    reviewed_at: Optional[datetime] = Field(None, description="审核时间")
    reviewed_by: Optional[int] = Field(None, description="审核人ID")


class PPAPCreate(BaseModel):
    """创建 PPAP 提交任务"""
    supplier_id: int = Field(..., description="供应商ID", gt=0)
    material_code: str = Field(..., description="物料编码", min_length=1, max_length=100)
    ppap_level: str = Field(default="level_3", description="PPAP等级：level_1/level_2/level_3/level_4/level_5")
    required_documents: Optional[List[str]] = Field(
        None,
        description="要求提交的文件清单（文件键名列表），如不指定则根据等级自动生成"
    )
    submission_deadline: Optional[date] = Field(None, description="提交截止日期")
    notes: Optional[str] = Field(None, description="备注说明", max_length=1000)
    
    @field_validator("ppap_level")
    @classmethod
    def validate_ppap_level(cls, v: str) -> str:
        """验证 PPAP 等级"""
        valid_levels = ["level_1", "level_2", "level_3", "level_4", "level_5"]
        if v not in valid_levels:
            raise ValueError(f"PPAP等级必须是以下之一: {', '.join(valid_levels)}")
        return v


class PPAPUpdate(BaseModel):
    """更新 PPAP 基本信息"""
    ppap_level: Optional[str] = Field(None, description="PPAP等级")
    submission_deadline: Optional[date] = Field(None, description="提交截止日期")
    notes: Optional[str] = Field(None, description="备注说明", max_length=1000)
    
    @field_validator("ppap_level")
    @classmethod
    def validate_ppap_level(cls, v: Optional[str]) -> Optional[str]:
        """验证 PPAP 等级"""
        if v is not None:
            valid_levels = ["level_1", "level_2", "level_3", "level_4", "level_5"]
            if v not in valid_levels:
                raise ValueError(f"PPAP等级必须是以下之一: {', '.join(valid_levels)}")
        return v


class PPAPDocumentUpload(BaseModel):
    """供应商上传文件"""
    document_key: str = Field(..., description="文件键名（如：psw, pfmea）")
    file_path: str = Field(..., description="文件路径", min_length=1, max_length=500)
    
    @field_validator("document_key")
    @classmethod
    def validate_document_key(cls, v: str) -> str:
        """验证文件键名"""
        if v not in PPAP_STANDARD_DOCUMENTS:
            raise ValueError(f"无效的文件键名: {v}，必须是标准18项文件之一")
        return v


class PPAPDocumentReview(BaseModel):
    """SQE 审核单个文件"""
    document_key: str = Field(..., description="文件键名")
    review_status: str = Field(..., description="审核状态：approved/rejected")
    review_comments: Optional[str] = Field(None, description="审核意见", max_length=500)
    
    @field_validator("document_key")
    @classmethod
    def validate_document_key(cls, v: str) -> str:
        """验证文件键名"""
        if v not in PPAP_STANDARD_DOCUMENTS:
            raise ValueError(f"无效的文件键名: {v}")
        return v
    
    @field_validator("review_status")
    @classmethod
    def validate_review_status(cls, v: str) -> str:
        """验证审核状态"""
        if v not in ["approved", "rejected"]:
            raise ValueError("审核状态必须是 approved 或 rejected")
        return v


class PPAPBatchReview(BaseModel):
    """批量审核文件"""
    reviews: List[PPAPDocumentReview] = Field(..., description="审核列表")
    overall_decision: str = Field(..., description="整体决策：approve/reject")
    overall_comments: Optional[str] = Field(None, description="整体审核意见", max_length=1000)
    
    @field_validator("overall_decision")
    @classmethod
    def validate_overall_decision(cls, v: str) -> str:
        """验证整体决策"""
        if v not in ["approve", "reject"]:
            raise ValueError("整体决策必须是 approve 或 reject")
        return v


class PPAPResponse(BaseModel):
    """PPAP 响应模型"""
    id: int
    supplier_id: int
    material_code: str
    ppap_level: str
    submission_date: Optional[date]
    status: str
    documents: Optional[Dict]
    reviewer_id: Optional[int]
    review_comments: Optional[str]
    approved_at: Optional[datetime]
    revalidation_due_date: Optional[date]
    created_at: datetime
    updated_at: datetime
    created_by: Optional[int]
    
    # 扩展字段
    supplier_name: Optional[str] = None
    reviewer_name: Optional[str] = None
    days_until_deadline: Optional[int] = None
    completion_rate: Optional[float] = None  # 文件完成率
    
    class Config:
        from_attributes = True


class PPAPListResponse(BaseModel):
    """PPAP 列表响应"""
    total: int = Field(..., description="总记录数")
    items: List[PPAPResponse] = Field(..., description="PPAP列表")
    page: int = Field(..., description="当前页码")
    page_size: int = Field(..., description="每页记录数")


class PPAPStatistics(BaseModel):
    """PPAP 统计数据"""
    total_submissions: int = Field(0, description="总提交数")
    pending_submissions: int = Field(0, description="待提交数")
    under_review: int = Field(0, description="审核中数量")
    approved: int = Field(0, description="已批准数量")
    rejected: int = Field(0, description="已驳回数量")
    expired: int = Field(0, description="已过期数量（需再鉴定）")
    overdue_submissions: int = Field(0, description="逾期未提交数量")
    avg_completion_rate: float = Field(0.0, description="平均文件完成率")
    
    # 按供应商统计
    by_supplier: Optional[List[Dict]] = Field(None, description="按供应商统计")
    
    # 按月份统计
    by_month: Optional[List[Dict]] = Field(None, description="按月份统计")


class PPAPRevalidationReminder(BaseModel):
    """年度再鉴定提醒"""
    ppap_id: int
    supplier_id: int
    supplier_name: str
    material_code: str
    approved_at: datetime
    revalidation_due_date: date
    days_until_due: int
    status: str  # "upcoming" / "overdue"
