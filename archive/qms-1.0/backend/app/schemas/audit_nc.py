"""
Audit NC schemas.
"""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class AuditNCAssign(BaseModel):
    """Assign an audit NC to a responsible user."""

    assigned_to: int = Field(..., description="指派给的用户 ID")
    deadline: datetime = Field(..., description="整改期限")
    comment: Optional[str] = Field(None, description="指派说明")


class AuditNCResponse(BaseModel):
    """Response payload for root cause and corrective action."""

    root_cause: str = Field(..., description="根本原因", min_length=10)
    corrective_action: str = Field(..., description="纠正措施", min_length=10)
    corrective_evidence: Optional[str] = Field(None, description="整改证据文件路径")


class AuditNCVerify(BaseModel):
    """Verification payload from the auditor."""

    is_approved: bool = Field(..., description="是否验证通过")
    verification_comment: str = Field(..., description="验证意见", min_length=5)


class AuditNCClose(BaseModel):
    """Close payload for an audit NC."""

    closing_comment: Optional[str] = Field(None, description="关闭备注")


class AuditNCQuery(BaseModel):
    """Audit NC list query parameters."""

    audit_id: Optional[int] = Field(None, description="审核执行记录 ID")
    assigned_to: Optional[int] = Field(None, description="指派给的用户 ID")
    responsible_dept: Optional[str] = Field(None, description="责任部门")
    problem_category_key: Optional[str] = Field(None, description="问题分类")
    verification_status: Optional[str] = Field(None, description="验证状态")
    is_overdue: Optional[bool] = Field(None, description="是否逾期")
    page: int = Field(1, ge=1, description="页码")
    page_size: int = Field(20, ge=1, le=100, description="每页记录数")


class AuditNCDetail(BaseModel):
    """Audit NC detail payload."""

    id: int
    audit_id: int
    audit_type: Optional[str] = None
    problem_category_key: Optional[str] = None
    problem_category_label: Optional[str] = None
    nc_item: str
    nc_description: str
    evidence_photo_path: Optional[str]
    responsible_dept: str
    assigned_to: Optional[int]
    root_cause: Optional[str]
    corrective_action: Optional[str]
    corrective_evidence: Optional[str]
    verification_status: str
    verified_by: Optional[int]
    verified_at: Optional[datetime]
    verification_comment: Optional[str]
    deadline: datetime
    closed_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime
    created_by: Optional[int]
    is_overdue: bool = Field(default=False, description="是否逾期")
    remaining_hours: Optional[float] = Field(None, description="剩余小时数")

    class Config:
        from_attributes = True


class AuditNCListResponse(BaseModel):
    """Audit NC paginated list payload."""

    items: List[AuditNCDetail]
    total: int
    page: int
    page_size: int
    total_pages: int
