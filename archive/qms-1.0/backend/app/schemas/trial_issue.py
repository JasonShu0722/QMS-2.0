"""
Trial Issue Schemas
试产问题数据校验模型
"""
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
from enum import Enum


class IssueTypeEnum(str, Enum):
    """问题类型枚举"""
    DESIGN = "design"
    TOOLING = "tooling"
    PROCESS = "process"
    MATERIAL = "material"
    EQUIPMENT = "equipment"
    OTHER = "other"


class IssueStatusEnum(str, Enum):
    """问题状态枚举"""
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    RESOLVED = "resolved"
    CLOSED = "closed"
    ESCALATED = "escalated"


class LegacyApprovalStatusEnum(str, Enum):
    """带病量产审批状态枚举"""
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class TrialIssueCreate(BaseModel):
    """创建试产问题请求模型"""
    trial_id: int = Field(..., description="试产记录ID")
    issue_description: str = Field(..., min_length=1, description="问题描述")
    issue_type: IssueTypeEnum = Field(..., description="问题类型")
    assigned_to: Optional[int] = Field(None, description="责任人ID")
    assigned_dept: Optional[str] = Field(None, max_length=100, description="责任部门")
    deadline: Optional[datetime] = Field(None, description="要求完成时间")

    class Config:
        json_schema_extra = {
            "example": {
                "trial_id": 1,
                "issue_description": "试产过程中发现产品外观有划痕",
                "issue_type": "process",
                "assigned_to": 5,
                "assigned_dept": "制造工程部",
                "deadline": "2026-02-20T18:00:00"
            }
        }


class TrialIssueUpdate(BaseModel):
    """更新试产问题请求模型"""
    issue_description: Optional[str] = Field(None, min_length=1, description="问题描述")
    issue_type: Optional[IssueTypeEnum] = Field(None, description="问题类型")
    assigned_to: Optional[int] = Field(None, description="责任人ID")
    assigned_dept: Optional[str] = Field(None, max_length=100, description="责任部门")
    root_cause: Optional[str] = Field(None, description="根本原因")
    solution: Optional[str] = Field(None, description="解决方案")
    verification_method: Optional[str] = Field(None, description="验证方法")
    verification_result: Optional[str] = Field(None, description="验证结果")
    status: Optional[IssueStatusEnum] = Field(None, description="问题状态")
    deadline: Optional[datetime] = Field(None, description="要求完成时间")

    class Config:
        json_schema_extra = {
            "example": {
                "root_cause": "工装夹具设计不合理，导致产品表面与夹具接触产生划痕",
                "solution": "重新设计夹具，增加软质保护垫",
                "verification_method": "使用新夹具生产10件产品，检查外观",
                "verification_result": "passed",
                "status": "resolved"
            }
        }


class TrialIssueAssign(BaseModel):
    """指派试产问题请求模型"""
    assigned_to: int = Field(..., description="责任人ID")
    assigned_dept: Optional[str] = Field(None, max_length=100, description="责任部门")
    deadline: Optional[datetime] = Field(None, description="要求完成时间")

    class Config:
        json_schema_extra = {
            "example": {
                "assigned_to": 5,
                "assigned_dept": "制造工程部",
                "deadline": "2026-02-20T18:00:00"
            }
        }


class TrialIssueSolution(BaseModel):
    """提交解决方案请求模型"""
    root_cause: str = Field(..., min_length=1, description="根本原因")
    solution: str = Field(..., min_length=1, description="解决方案")
    verification_method: Optional[str] = Field(None, description="验证方法")

    class Config:
        json_schema_extra = {
            "example": {
                "root_cause": "工装夹具设计不合理，导致产品表面与夹具接触产生划痕",
                "solution": "重新设计夹具，增加软质保护垫",
                "verification_method": "使用新夹具生产10件产品，检查外观"
            }
        }


class TrialIssueVerification(BaseModel):
    """验证解决方案请求模型"""
    verification_result: str = Field(..., pattern="^(passed|failed)$", description="验证结果：passed/failed")
    verification_comments: Optional[str] = Field(None, description="验证备注")

    class Config:
        json_schema_extra = {
            "example": {
                "verification_result": "passed",
                "verification_comments": "使用新夹具生产10件产品，外观检查全部合格"
            }
        }


class TrialIssueEscalate(BaseModel):
    """升级为8D报告请求模型"""
    escalation_reason: str = Field(..., min_length=1, description="升级原因")

    class Config:
        json_schema_extra = {
            "example": {
                "escalation_reason": "问题复杂，涉及多个部门，需要进行深度分析"
            }
        }


class LegacyIssueApproval(BaseModel):
    """带病量产特批请求模型"""
    approval_status: LegacyApprovalStatusEnum = Field(..., description="审批状态")
    approval_comments: Optional[str] = Field(None, description="审批意见")

    class Config:
        json_schema_extra = {
            "example": {
                "approval_status": "approved",
                "approval_comments": "问题影响较小，可带病量产，但需在量产后1个月内完成整改"
            }
        }


class TrialIssueResponse(BaseModel):
    """试产问题响应模型"""
    id: int
    problem_report_id: Optional[int] = None
    problem_number: Optional[str] = None
    eight_d_number: Optional[str] = None
    risk_level: Optional[str] = None
    response_mode: Optional[str] = None
    trial_id: int
    issue_number: Optional[str]
    issue_description: str
    issue_type: str
    assigned_to: Optional[int]
    assigned_dept: Optional[str]
    root_cause: Optional[str]
    solution: Optional[str]
    solution_file_path: Optional[str]
    verification_method: Optional[str]
    verification_result: Optional[str]
    verified_by: Optional[int]
    verified_at: Optional[datetime]
    status: str
    is_escalated_to_8d: bool
    eight_d_id: Optional[int]
    escalated_at: Optional[datetime]
    escalation_reason: Optional[str]
    is_legacy_issue: bool
    legacy_approval_status: Optional[str]
    legacy_approval_by: Optional[int]
    legacy_approval_at: Optional[datetime]
    risk_acknowledgement_path: Optional[str]
    deadline: Optional[datetime]
    resolved_at: Optional[datetime]
    closed_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
        json_schema_extra = {
            "example": {
                "id": 1,
                "trial_id": 1,
                "issue_number": "TI-2026-001",
                "issue_description": "试产过程中发现产品外观有划痕",
                "issue_type": "process",
                "assigned_to": 5,
                "assigned_dept": "制造工程部",
                "root_cause": "工装夹具设计不合理",
                "solution": "重新设计夹具，增加软质保护垫",
                "status": "resolved",
                "is_escalated_to_8d": False,
                "is_legacy_issue": False,
                "deadline": "2026-02-20T18:00:00",
                "resolved_at": "2026-02-19T16:00:00",
                "created_at": "2026-02-14T10:00:00",
                "updated_at": "2026-02-19T16:00:00"
            }
        }


class TrialIssueStatistics(BaseModel):
    """试产问题统计模型"""
    total_issues: int = Field(..., description="问题总数")
    open_issues: int = Field(..., description="待处理问题数")
    in_progress_issues: int = Field(..., description="处理中问题数")
    resolved_issues: int = Field(..., description="已解决问题数")
    closed_issues: int = Field(..., description="已关闭问题数")
    escalated_issues: int = Field(..., description="已升级为8D问题数")
    legacy_issues: int = Field(..., description="遗留问题数")
    issues_by_type: dict = Field(..., description="按类型统计")

    class Config:
        json_schema_extra = {
            "example": {
                "total_issues": 10,
                "open_issues": 2,
                "in_progress_issues": 3,
                "resolved_issues": 4,
                "closed_issues": 1,
                "escalated_issues": 1,
                "legacy_issues": 2,
                "issues_by_type": {
                    "design": 2,
                    "tooling": 3,
                    "process": 4,
                    "material": 1
                }
            }
        }
