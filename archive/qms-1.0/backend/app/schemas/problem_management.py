"""
Shared schemas for cross-module problem management metadata and issue summaries.
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class ProblemCategoryItem(BaseModel):
    """Confirmed problem category definition."""

    key: str = Field(..., description="Category key, for example CQ1")
    category_code: str = Field(..., description="Category code")
    subcategory_code: str = Field(..., description="Subcategory code")
    module_key: str = Field(..., description="Owning module key")
    label: str = Field(..., description="Category label")


class NumberingRuleItem(BaseModel):
    """Unified numbering rule summary."""

    issue_prefix: str = Field(..., description="Problem issue prefix")
    report_prefix: str = Field(..., description="8D report prefix")
    issue_pattern: str = Field(..., description="Problem issue number pattern")
    report_pattern: str = Field(..., description="8D report number pattern")


class ProblemManagementCatalogResponse(BaseModel):
    """Shared problem-management catalog response."""

    response_modes: list[str] = Field(default_factory=list, description="Response modes")
    handling_levels: list[str] = Field(default_factory=list, description="Handling levels")
    categories: list[ProblemCategoryItem] = Field(default_factory=list, description="Category catalog")
    numbering_rule: NumberingRuleItem = Field(..., description="Unified numbering rule")


class InternalUserOption(BaseModel):
    """Shared internal user option for cross-module assignment dialogs."""

    id: int
    username: str
    full_name: str
    department: Optional[str] = None
    position: Optional[str] = None

    class Config:
        from_attributes = True


class UnifiedProblemStatus(str, Enum):
    OPEN = "open"
    ASSIGNED = "assigned"
    RESPONDING = "responding"
    PENDING_REVIEW = "pending_review"
    VERIFYING = "verifying"
    APPROVED = "approved"
    CLOSED = "closed"
    REJECTED = "rejected"


class ProblemRiskLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class ProblemReportSourceCreate(BaseModel):
    """Source mapping supplied when creating a formal problem report."""

    source_type: str = Field(..., description="Source entity type")
    source_id: int = Field(..., gt=0, description="Source entity id")
    source_parent_id: Optional[int] = Field(default=None, description="Parent source id when applicable")
    source_number: Optional[str] = Field(default=None, description="Source ledger number")
    is_primary: bool = Field(default=False, description="Whether this is the primary source")


class ProblemReportSourcesUpdate(BaseModel):
    """Replace the source range of a formal problem report."""

    sources: list[ProblemReportSourceCreate] = Field(..., min_length=1, description="Replacement source mappings")


class ProblemReportSourceResponse(BaseModel):
    id: int
    problem_report_id: Optional[int] = None
    source_type: str
    source_id: int
    source_parent_id: Optional[int] = None
    source_number: Optional[str] = None
    is_primary: bool = False
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ProblemReportCreate(BaseModel):
    """Create a formal cross-module problem report."""

    module_key: Optional[str] = Field(default=None, description="Module key; inferred from category if omitted")
    problem_category_key: str = Field(..., description="Problem category key")
    title: str = Field(..., min_length=1, max_length=500, description="Problem title")
    description: Optional[str] = Field(default=None, description="Problem description")
    risk_level: ProblemRiskLevel = Field(default=ProblemRiskLevel.MEDIUM, description="Risk level")
    response_mode: str = Field(default="brief", description="brief or eight_d")
    responsible_dept: Optional[str] = Field(default=None, description="Responsible department")
    assigned_to: Optional[int] = Field(default=None, description="Assigned user id")
    due_at: Optional[datetime] = Field(default=None, description="Due date/time")
    sources: list[ProblemReportSourceCreate] = Field(default_factory=list, description="Source mappings")


class ProblemReportBriefResponse(BaseModel):
    root_cause: Optional[str] = Field(default=None, description="Root cause")
    containment_action: Optional[str] = Field(default=None, description="Containment action")
    corrective_action: Optional[str] = Field(default=None, description="Corrective action")
    evidence_files: list[str] = Field(default_factory=list, description="Evidence file paths")


class ProblemReportReview(BaseModel):
    approved: bool = Field(..., description="Review result")
    review_comment: Optional[str] = Field(default=None, description="Review comment")


class ProblemReportClose(BaseModel):
    close_comment: Optional[str] = Field(default=None, description="Close comment")


class ProblemReportResponse(BaseModel):
    id: int
    problem_number: str
    eight_d_number: Optional[str] = None
    module_key: str
    problem_category_key: str
    problem_category_label: str
    title: str
    description: Optional[str] = None
    risk_level: str
    response_mode: str
    status: str
    responsible_dept: Optional[str] = None
    assigned_to: Optional[int] = None
    action_owner_id: Optional[int] = None
    owner_id: Optional[int] = None
    created_by: Optional[int] = None
    verified_by: Optional[int] = None
    closed_by: Optional[int] = None
    brief_response: Optional[dict] = None
    due_at: Optional[datetime] = None
    reviewed_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None
    rejected_reason: Optional[str] = None
    reopened_count: int = 0
    created_at: datetime
    updated_at: datetime
    sources: list[ProblemReportSourceResponse] = Field(default_factory=list)

    class Config:
        from_attributes = True


class ProblemIssueSummaryQuery(BaseModel):
    """Query filters for the first read-only unified problem list."""

    module_key: Optional[str] = Field(default=None, description="Module key filter")
    problem_category_key: Optional[str] = Field(default=None, description="Problem category filter")
    risk_level: Optional[str] = Field(default=None, description="Risk level filter")
    response_mode: Optional[str] = Field(default=None, description="Response mode filter")
    unified_status: Optional[UnifiedProblemStatus] = Field(default=None, description="Unified status filter")
    keyword: Optional[str] = Field(default=None, description="Keyword filter")
    only_assigned_to_me: bool = Field(default=False, description="Only include issues assigned to the current user")
    only_actionable_to_me: bool = Field(
        default=False,
        description="Only include issues that the current user can handle directly from the problem center",
    )
    only_created_by_me: bool = Field(default=False, description="Only include issues created by the current user")
    only_overdue: bool = Field(default=False, description="Only include overdue issues")
    formal_only: bool = Field(default=False, description="Only include formal ZXQ/ZX8D problem reports")
    page: int = Field(default=1, ge=1, description="Page number")
    page_size: int = Field(default=20, ge=1, le=100, description="Page size")


class ProblemIssueSummaryItem(BaseModel):
    """Normalized issue summary item for the unified problem center."""

    source_type: str = Field(..., description="Source entity type")
    source_id: int = Field(..., description="Source entity id")
    source_parent_id: Optional[int] = Field(default=None, description="Parent source entity id when applicable")
    source_label: str = Field(..., description="Source label")
    problem_report_id: Optional[int] = Field(default=None, description="Formal problem report id")
    problem_number: Optional[str] = Field(default=None, description="Formal ZXQ problem number")
    eight_d_number: Optional[str] = Field(default=None, description="Formal ZX8D report number")
    risk_level: Optional[str] = Field(default=None, description="Risk level")
    module_key: str = Field(..., description="Module key")
    problem_category_key: str = Field(..., description="Problem category key")
    problem_category_label: str = Field(..., description="Problem category label")
    source_category_label: Optional[str] = Field(default=None, description="Source category label")
    reference_no: Optional[str] = Field(default=None, description="Source reference number")
    title: str = Field(..., description="Summary title")
    cause_analysis: Optional[str] = Field(default=None, description="Cause analysis summary")
    improvement_plan: Optional[str] = Field(default=None, description="Improvement plan summary")
    responsibility_category: Optional[str] = Field(default=None, description="Responsibility category")
    responsibility_category_label: Optional[str] = Field(default=None, description="Responsibility category label")
    raw_status: str = Field(..., description="Original module status")
    unified_status: UnifiedProblemStatus = Field(..., description="Normalized unified status")
    responsible_dept: Optional[str] = Field(default=None, description="Responsible department")
    assigned_to: Optional[int] = Field(default=None, description="Current assignee")
    action_owner_id: Optional[int] = Field(
        default=None,
        description="Current action owner for the active stage in the unified center",
    )
    created_by_id: Optional[int] = Field(default=None, description="Original creator id")
    owner_id: Optional[int] = Field(default=None, description="Owner or creator id")
    verified_by: Optional[int] = Field(
        default=None,
        description="Verifier id when the source workflow has entered verification",
    )
    response_mode: Optional[str] = Field(default=None, description="Current response mode")
    customer_name: Optional[str] = Field(default=None, description="Customer name when applicable")
    requires_physical_analysis: Optional[bool] = Field(
        default=None,
        description="Whether the customer complaint requires physical analysis before disposition",
    )
    is_overdue: bool = Field(default=False, description="Whether the item is overdue")
    due_at: Optional[datetime] = Field(default=None, description="Due date/time")
    created_at: datetime = Field(..., description="Created at")
    updated_at: datetime = Field(..., description="Updated at")


class ProblemIssueSummaryListResponse(BaseModel):
    """Paginated unified problem summary list response."""

    total: int = Field(..., description="Total matching records")
    page: int = Field(..., description="Current page")
    page_size: int = Field(..., description="Current page size")
    module_counts: dict[str, int] = Field(
        default_factory=dict,
        description="Matching item counts grouped by module key before pagination",
    )
    items: list[ProblemIssueSummaryItem] = Field(default_factory=list, description="Summary items")
