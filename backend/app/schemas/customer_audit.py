"""
客户审核管理 Schemas
Customer Audit Management Schemas - 客户来厂审核台账和问题跟踪
"""
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field


# ==================== 客户审核创建 ====================

class CustomerAuditCreate(BaseModel):
    """创建客户审核台账"""
    customer_name: str = Field(..., min_length=1, max_length=255, description="客户名称")
    audit_type: str = Field(
        ...,
        description="审核类型: system, process, product, qualification, potential_supplier"
    )
    audit_date: datetime = Field(..., description="审核日期")
    final_result: str = Field(
        ...,
        description="最终结果: passed, conditional_passed, failed, pending"
    )
    score: Optional[int] = Field(None, ge=0, le=100, description="审核得分")
    external_issue_list_path: Optional[str] = Field(
        None,
        max_length=500,
        description="客户提供的问题整改清单文件路径"
    )
    internal_contact: Optional[str] = Field(None, max_length=255, description="内部接待人员")
    audit_report_path: Optional[str] = Field(None, max_length=500, description="审核报告文件路径")
    summary: Optional[str] = Field(None, description="审核总结")

    class Config:
        json_schema_extra = {
            "example": {
                "customer_name": "某汽车主机厂",
                "audit_type": "system",
                "audit_date": "2024-01-15T09:00:00",
                "final_result": "conditional_passed",
                "score": 85,
                "external_issue_list_path": "/uploads/customer_audits/issues_20240115.xlsx",
                "internal_contact": "张三",
                "audit_report_path": "/uploads/customer_audits/report_20240115.pdf",
                "summary": "客户对体系运行基本满意，发现3项不符合项需整改"
            }
        }


# ==================== 客户审核更新 ====================

class CustomerAuditUpdate(BaseModel):
    """更新客户审核台账"""
    customer_name: Optional[str] = Field(None, min_length=1, max_length=255)
    audit_type: Optional[str] = None
    audit_date: Optional[datetime] = None
    final_result: Optional[str] = None
    score: Optional[int] = Field(None, ge=0, le=100)
    external_issue_list_path: Optional[str] = Field(None, max_length=500)
    internal_contact: Optional[str] = Field(None, max_length=255)
    audit_report_path: Optional[str] = Field(None, max_length=500)
    summary: Optional[str] = None
    status: Optional[str] = Field(
        None,
        description="状态: completed, issue_open, issue_closed"
    )


# ==================== 客户审核响应 ====================

class CustomerAuditResponse(BaseModel):
    """客户审核台账响应"""
    id: int
    customer_name: str
    audit_type: str
    audit_date: datetime
    final_result: str
    score: Optional[int]
    external_issue_list_path: Optional[str]
    internal_contact: Optional[str]
    audit_report_path: Optional[str]
    summary: Optional[str]
    status: str
    created_at: datetime
    updated_at: datetime
    created_by: Optional[int]

    class Config:
        from_attributes = True


# ==================== 客户审核列表响应 ====================

class CustomerAuditListResponse(BaseModel):
    """客户审核列表响应"""
    total: int = Field(..., description="总记录数")
    items: List[CustomerAuditResponse] = Field(..., description="客户审核列表")


# ==================== 客户审核问题任务创建 ====================

class CustomerAuditIssueTaskCreate(BaseModel):
    """从客户问题清单创建内部闭环任务"""
    customer_audit_id: int = Field(..., description="客户审核ID")
    issue_description: str = Field(..., min_length=1, description="问题描述")
    responsible_dept: str = Field(..., min_length=1, max_length=100, description="责任部门")
    assigned_to: Optional[int] = Field(None, description="指派给(用户ID)")
    deadline: datetime = Field(..., description="整改期限")
    priority: str = Field(
        default="medium",
        description="优先级: low, medium, high, critical"
    )
    response_mode: str = Field(default="brief", description="brief or eight_d")

    class Config:
        json_schema_extra = {
            "example": {
                "customer_audit_id": 1,
                "issue_description": "生产现场5S管理不到位，工具摆放混乱",
                "responsible_dept": "生产部",
                "assigned_to": 10,
                "deadline": "2024-02-15T17:00:00",
                "priority": "high"
            }
        }


# ==================== 客户审核问题任务响应 ====================

class CustomerAuditIssueTaskResponse(BaseModel):
    """客户审核问题任务响应"""
    id: int
    customer_audit_id: int
    issue_description: str
    responsible_dept: str
    assigned_to: Optional[int]
    deadline: datetime
    priority: Optional[str] = None
    status: str
    root_cause: Optional[str]
    corrective_action: Optional[str]
    corrective_evidence: Optional[str]
    verified_by: Optional[int]
    verified_at: Optional[datetime]
    verification_comment: Optional[str]
    closed_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime
    created_by: Optional[int]
    problem_category_key: Optional[str] = None
    problem_category_label: Optional[str] = None
    problem_report_id: Optional[int] = None
    problem_number: Optional[str] = None
    eight_d_number: Optional[str] = None
    response_mode: Optional[str] = None

    class Config:
        from_attributes = True


# ==================== 客户审核查询参数 ====================

class CustomerAuditQuery(BaseModel):
    """客户审核查询参数"""
    customer_name: Optional[str] = Field(None, description="客户名称（模糊搜索）")
    audit_type: Optional[str] = Field(None, description="审核类型")
    final_result: Optional[str] = Field(None, description="最终结果")
    status: Optional[str] = Field(None, description="状态")
    start_date: Optional[datetime] = Field(None, description="开始日期")
    end_date: Optional[datetime] = Field(None, description="结束日期")
    page: int = Field(1, ge=1, description="页码")
    page_size: int = Field(20, ge=1, le=100, description="每页数量")
