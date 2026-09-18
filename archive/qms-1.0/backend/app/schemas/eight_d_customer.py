"""
8D Customer Report Schemas
客诉8D报告数据校验模型
"""
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
from enum import Enum


class EightDStatusEnum(str, Enum):
    """8D报告状态枚举"""
    DRAFT = "draft"
    D0_D3_COMPLETED = "d0_d3_completed"
    D4_D7_IN_PROGRESS = "d4_d7_in_progress"
    D4_D7_COMPLETED = "d4_d7_completed"
    D8_IN_PROGRESS = "d8_in_progress"
    IN_REVIEW = "in_review"
    APPROVED = "approved"
    REJECTED = "rejected"
    CLOSED = "closed"


class ApprovalLevelEnum(str, Enum):
    """审批级别枚举"""
    SECTION_MANAGER = "section_manager"
    DEPARTMENT_HEAD = "department_head"
    NONE = "none"


# ==================== D4-D7 阶段请求模型 ====================

class CorrectiveAction(BaseModel):
    """纠正措施"""
    action: str = Field(..., min_length=10, description="措施描述")
    responsible: str = Field(..., description="责任人")
    deadline: str = Field(..., description="完成期限（YYYY-MM-DD）")


class D4RootCauseAnalysis(BaseModel):
    """D4: 根本原因分析"""
    analysis_method: str = Field(..., description="分析方法：5Why/鱼骨图/FTA/流程分析")
    root_cause: str = Field(..., min_length=20, description="根本原因描述")
    evidence_files: List[str] = Field(default_factory=list, description="证据文件路径列表")


class D6Verification(BaseModel):
    """D6: 验证有效性"""
    verification_report: str = Field(..., description="验证报告文件路径")
    test_data: Optional[str] = Field(None, description="测试数据文件路径")
    result: str = Field(..., min_length=10, description="验证结果描述")


class D7Standardization(BaseModel):
    """D7: 标准化"""
    document_modified: bool = Field(..., description="是否涉及文件修改")
    modified_files: List[str] = Field(default_factory=list, description="修改的文件列表（如PFMEA/CP/SOP）")
    attachment_paths: List[str] = Field(default_factory=list, description="附件路径列表")


class D4D7Request(BaseModel):
    """责任板块填写D4-D7请求模型"""
    d4_root_cause: D4RootCauseAnalysis = Field(..., description="D4: 根本原因分析")
    d5_corrective_actions: List[CorrectiveAction] = Field(..., min_items=1, description="D5: 纠正措施列表")
    d6_verification: D6Verification = Field(..., description="D6: 验证有效性")
    d7_standardization: D7Standardization = Field(..., description="D7: 标准化")
    
    class Config:
        json_schema_extra = {
            "example": {
                "d4_root_cause": {
                    "analysis_method": "5Why",
                    "root_cause": "电源模块设计裕量不足，未考虑极端温度下的电流冲击",
                    "evidence_files": ["/uploads/8d/root_cause_analysis.pdf", "/uploads/8d/simulation_result.xlsx"]
                },
                "d5_corrective_actions": [
                    {
                        "action": "重新设计电源模块，增加20%裕量",
                        "responsible": "张工",
                        "deadline": "2024-02-15"
                    },
                    {
                        "action": "更新设计规范，增加极端温度测试要求",
                        "responsible": "李工",
                        "deadline": "2024-02-20"
                    }
                ],
                "d6_verification": {
                    "verification_report": "/uploads/8d/verification_report.pdf",
                    "test_data": "/uploads/8d/test_data.xlsx",
                    "result": "经过100次极端温度循环测试，未出现失效"
                },
                "d7_standardization": {
                    "document_modified": True,
                    "modified_files": ["PFMEA-MCU-V2.1", "CP-MCU-V2.1", "SOP-电源测试-V1.2"],
                    "attachment_paths": ["/uploads/8d/pfmea_v2.1.pdf", "/uploads/8d/cp_v2.1.pdf"]
                }
            }
        }


# ==================== D8 阶段请求模型 ====================

class HorizontalDeployment(BaseModel):
    """水平展开项"""
    product: str = Field(..., description="类似产品名称")
    action: str = Field(..., description="推送的对策")
    status: str = Field(default="pending", description="状态：pending/completed")


class LessonLearnedData(BaseModel):
    """经验教训数据"""
    should_archive: bool = Field(..., description="是否沉淀为经验教训")
    lesson_title: Optional[str] = Field(None, description="经验教训标题")
    lesson_content: Optional[str] = Field(None, description="经验教训内容")
    preventive_action: Optional[str] = Field(None, description="预防措施")


class D8Request(BaseModel):
    """D8水平展开与经验教训请求模型"""
    horizontal_deployment: List[HorizontalDeployment] = Field(default_factory=list, description="水平展开列表")
    lesson_learned: LessonLearnedData = Field(..., description="经验教训数据")
    
    class Config:
        json_schema_extra = {
            "example": {
                "horizontal_deployment": [
                    {
                        "product": "类似产品A（MCU-V2）",
                        "action": "应用新的电源模块设计",
                        "status": "completed"
                    },
                    {
                        "product": "类似产品B（MCU-V3）",
                        "action": "应用新的电源模块设计",
                        "status": "pending"
                    }
                ],
                "lesson_learned": {
                    "should_archive": True,
                    "lesson_title": "电源模块设计裕量不足导致失效",
                    "lesson_content": "在极端温度环境下，电源模块设计裕量不足会导致电流冲击失效",
                    "preventive_action": "所有新品设计必须进行极端温度循环测试，电源模块裕量至少20%"
                }
            }
        }


# ==================== 审核请求模型 ====================

class EightDReviewRequest(BaseModel):
    """8D报告审核请求模型"""
    approved: bool = Field(..., description="是否批准")
    review_comments: str = Field(..., min_length=10, description="审核意见")
    
    class Config:
        json_schema_extra = {
            "example": {
                "approved": True,
                "review_comments": "根本原因分析充分，纠正措施有效，验证数据完整，同意批准"
            }
        }


# ==================== 响应模型 ====================

class EightDComplaintLinkSummary(BaseModel):
    """Related complaint summary for a customer 8D report."""

    complaint_id: int
    complaint_number: str
    complaint_type: Optional[str] = None
    customer_code: str
    customer_name: Optional[str] = None
    is_primary: bool = False


class EightDBatchInitRequest(BaseModel):
    """Initialize one customer 8D report from one or more complaints."""

    complaint_ids: List[int] = Field(..., min_length=1, description="Complaint ids to include in the 8D report")
    primary_complaint_id: Optional[int] = Field(None, ge=1, description="Primary complaint id for the report")


class EightDScopeAppendRequest(BaseModel):
    """Append one or more complaint ledger records into an existing customer 8D scope."""

    complaint_ids: List[int] = Field(..., min_length=1, description="Complaint ids to append into the 8D report")


class EightDPrimaryComplaintSwitchRequest(BaseModel):
    """Switch the primary complaint anchor within an existing customer 8D scope."""

    primary_complaint_id: int = Field(..., ge=1, description="Complaint id to promote as the primary source record")


class EightDCustomerResponse(BaseModel):
    """8D报告响应模型"""
    id: int
    complaint_id: int
    report_number: Optional[str] = None
    status: EightDStatusEnum
    approval_level: ApprovalLevelEnum
    related_complaints: List[EightDComplaintLinkSummary] = Field(default_factory=list)
    
    # D0-D3数据
    d0_d3_cqe: Optional[dict] = None
    
    # D4-D7数据
    d4_d7_responsible: Optional[dict] = None
    
    # D8数据
    d8_horizontal: Optional[dict] = None
    
    # 审计字段
    submitted_at: Optional[datetime] = None
    reviewed_at: Optional[datetime] = None
    reviewed_by: Optional[int] = None
    review_comments: Optional[str] = None
    
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class EightDCustomerListItemResponse(BaseModel):
    """客户问题跟进清单摘要模型，兼容客诉简报和客诉 8D。"""

    id: int
    complaint_id: int
    problem_report_id: Optional[int] = None
    eight_d_report_id: Optional[int] = None
    report_number: str
    problem_number: Optional[str] = None
    eight_d_number: Optional[str] = None
    response_mode: str = "eight_d"
    risk_level: Optional[str] = None
    primary_complaint_number: Optional[str] = None
    complaint_type: Optional[str] = None
    customer_code: Optional[str] = None
    customer_name: Optional[str] = None
    end_customer_name: Optional[str] = None
    product_type: Optional[str] = None
    related_complaint_count: int = 0
    status: str
    approval_level: ApprovalLevelEnum
    created_at: datetime
    updated_at: datetime
    submitted_at: Optional[datetime] = None
    reviewed_at: Optional[datetime] = None


class EightDCustomerListResponse(BaseModel):
    """客户 8D 清单分页响应"""

    total: int
    items: List[EightDCustomerListItemResponse]
    page: int
    page_size: int


class SLAStatus(BaseModel):
    """SLA时效状态"""
    complaint_id: int
    complaint_number: str
    eight_d_status: EightDStatusEnum
    
    # 时效计算
    days_since_creation: int = Field(..., description="自创建以来的天数")
    submission_deadline: int = Field(7, description="提交期限（工作日）")
    archive_deadline: int = Field(10, description="归档期限（工作日）")
    
    # 状态判断
    is_submission_overdue: bool = Field(..., description="是否提交超期")
    is_archive_overdue: bool = Field(..., description="是否归档超期")
    remaining_days: int = Field(..., description="剩余天数（负数表示超期）")
    
    class Config:
        json_schema_extra = {
            "example": {
                "complaint_id": 1,
                "complaint_number": "CC-20240115-001",
                "eight_d_status": "d4_d7_in_progress",
                "days_since_creation": 5,
                "submission_deadline": 7,
                "archive_deadline": 10,
                "is_submission_overdue": False,
                "is_archive_overdue": False,
                "remaining_days": 2
            }
        }
