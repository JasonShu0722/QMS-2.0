"""
制程质量问题单 Pydantic 模型
ProcessIssue Schemas - 数据校验与序列化
"""
from datetime import date, datetime
from typing import Optional, List
from pydantic import BaseModel, Field, field_validator

from ..models.process_issue import ProcessIssueStatus
from ..models.process_defect import ResponsibilityCategory


# ==================== 创建问题单 ====================

class ProcessIssueCreate(BaseModel):
    """创建制程问题单请求模型"""
    issue_description: str = Field(
        ...,
        min_length=10,
        max_length=2000,
        description="问题描述"
    )
    responsibility_category: ResponsibilityCategory = Field(
        ...,
        description="责任类别"
    )
    assigned_to: int = Field(
        ...,
        gt=0,
        description="指派给的用户ID"
    )
    related_defect_ids: Optional[List[int]] = Field(
        default=None,
        description="关联的不良品记录ID列表"
    )
    
    class Config:
        json_schema_extra = {
            "example": {
                "issue_description": "产线A连续3天出现焊接不良，不良率超过2%，需要立即分析原因并制定对策",
                "responsibility_category": "equipment_defect",
                "assigned_to": 15,
                "related_defect_ids": [101, 102, 103]
            }
        }


# ==================== 响应问题单（填写分析和对策）====================

class ProcessIssueResponse(BaseModel):
    """责任板块填写分析和对策请求模型"""
    root_cause: str = Field(
        ...,
        min_length=20,
        max_length=2000,
        description="根本原因分析"
    )
    containment_action: str = Field(
        ...,
        min_length=10,
        max_length=1000,
        description="围堵措施"
    )
    corrective_action: str = Field(
        ...,
        min_length=20,
        max_length=2000,
        description="纠正措施"
    )
    verification_period: int = Field(
        ...,
        ge=1,
        le=90,
        description="验证期（天数）"
    )
    evidence_files: Optional[List[str]] = Field(
        default=None,
        description="改善证据附件路径列表"
    )
    
    class Config:
        json_schema_extra = {
            "example": {
                "root_cause": "焊接设备温度控制模块老化，导致温度波动超过±5℃，影响焊接质量",
                "containment_action": "1. 立即更换温度控制模块\n2. 加强首件检验\n3. 增加巡检频次至每小时一次",
                "corrective_action": "1. 建立设备温度监控系统，实时预警\n2. 制定设备预防性维护计划\n3. 更新作业指导书，增加温度确认步骤",
                "verification_period": 7,
                "evidence_files": [
                    "/uploads/evidence/temp_control_replacement.jpg",
                    "/uploads/evidence/updated_sop.pdf"
                ]
            }
        }


# ==================== 验证对策有效性 ====================

class ProcessIssueVerification(BaseModel):
    """PQE 验证对策有效性请求模型"""
    verification_result: bool = Field(
        ...,
        description="验证结果（True: 有效, False: 无效）"
    )
    verification_comments: Optional[str] = Field(
        default=None,
        max_length=1000,
        description="验证意见"
    )
    
    class Config:
        json_schema_extra = {
            "example": {
                "verification_result": True,
                "verification_comments": "验证期内（7天）未再发生焊接不良，温度监控系统运行正常，对策有效"
            }
        }


# ==================== 关闭问题单 ====================

class ProcessIssueClose(BaseModel):
    """关闭问题单请求模型"""
    close_comments: Optional[str] = Field(
        default=None,
        max_length=500,
        description="关闭备注"
    )
    
    class Config:
        json_schema_extra = {
            "example": {
                "close_comments": "对策验证通过，问题已彻底解决，可以关闭"
            }
        }


# ==================== 查询过滤器 ====================

class ProcessIssueFilter(BaseModel):
    """制程问题单查询过滤器"""
    status: Optional[ProcessIssueStatus] = Field(
        default=None,
        description="问题单状态"
    )
    responsibility_category: Optional[ResponsibilityCategory] = Field(
        default=None,
        description="责任类别"
    )
    assigned_to: Optional[int] = Field(
        default=None,
        description="当前处理人ID"
    )
    created_by: Optional[int] = Field(
        default=None,
        description="发起人ID"
    )
    is_overdue: Optional[bool] = Field(
        default=None,
        description="是否逾期"
    )
    start_date: Optional[date] = Field(
        default=None,
        description="创建开始日期"
    )
    end_date: Optional[date] = Field(
        default=None,
        description="创建结束日期"
    )
    page: int = Field(
        default=1,
        ge=1,
        description="页码"
    )
    page_size: int = Field(
        default=20,
        ge=1,
        le=100,
        description="每页数量"
    )


# ==================== 响应模型 ====================

class ProcessIssueDetail(BaseModel):
    """制程问题单详情响应模型"""
    id: int
    problem_report_id: Optional[int] = None
    problem_number: Optional[str] = None
    eight_d_number: Optional[str] = None
    risk_level: Optional[str] = None
    response_mode: Optional[str] = None
    issue_number: str
    issue_description: str
    responsibility_category: str
    assigned_to: int
    root_cause: Optional[str]
    containment_action: Optional[str]
    corrective_action: Optional[str]
    verification_period: Optional[int]
    verification_start_date: Optional[date]
    verification_end_date: Optional[date]
    status: str
    related_defect_ids: Optional[str]
    evidence_files: Optional[str]
    created_by: int
    verified_by: Optional[int]
    closed_by: Optional[int]
    closed_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime
    is_overdue: bool = Field(
        default=False,
        description="是否逾期"
    )
    
    class Config:
        from_attributes = True


class ProcessIssueListResponse(BaseModel):
    """制程问题单列表响应模型"""
    total: int = Field(..., description="总记录数")
    page: int = Field(..., description="当前页码")
    page_size: int = Field(..., description="每页数量")
    items: List[ProcessIssueDetail] = Field(..., description="问题单列表")


class ProcessIssueCreateResponse(BaseModel):
    """创建问题单响应模型"""
    id: int
    issue_number: str
    problem_report_id: Optional[int] = None
    problem_number: Optional[str] = None
    eight_d_number: Optional[str] = None
    risk_level: Optional[str] = None
    response_mode: Optional[str] = None
    message: str = Field(default="制程问题单创建成功")
    
    class Config:
        json_schema_extra = {
            "example": {
                "id": 1,
                "issue_number": "PQI-20260214-0001",
                "message": "制程问题单创建成功"
            }
        }


class ProcessIssueOperationResponse(BaseModel):
    """问题单操作响应模型"""
    success: bool
    message: str
    issue_number: str
    
    class Config:
        json_schema_extra = {
            "example": {
                "success": True,
                "message": "对策验证通过",
                "issue_number": "PQI-20260214-0001"
            }
        }
