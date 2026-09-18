"""
Trial Issue Model
试产问题模型 - 试产过程中发现的问题跟进
"""
from sqlalchemy import Column, Integer, String, Text, DateTime, Enum as SQLEnum, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime
import enum

from .base import Base


class IssueType(str, enum.Enum):
    """问题类型枚举"""
    DESIGN = "design"  # 设计问题
    TOOLING = "tooling"  # 模具问题
    PROCESS = "process"  # 工艺问题
    MATERIAL = "material"  # 物料问题
    EQUIPMENT = "equipment"  # 设备问题
    OTHER = "other"  # 其他


class IssueStatus(str, enum.Enum):
    """问题状态枚举"""
    OPEN = "open"  # 待处理
    IN_PROGRESS = "in_progress"  # 处理中
    RESOLVED = "resolved"  # 已解决
    CLOSED = "closed"  # 已关闭
    ESCALATED = "escalated"  # 已升级为8D


class TrialIssue(Base):
    """
    试产问题模型
    实现2.8.4试产问题跟进
    采用敏捷的清单式管理，支持升级为8D报告
    """
    __tablename__ = "trial_issues"

    id = Column(Integer, primary_key=True, index=True)
    problem_report_id = Column(Integer, ForeignKey("problem_reports.id"), nullable=True, index=True, comment="formal problem report id")
    
    # 关联试产记录
    trial_id = Column(Integer, ForeignKey("trial_productions.id"), nullable=False, index=True, comment="试产记录ID")
    
    # 问题描述
    issue_number = Column(String(50), nullable=True, index=True, comment="问题编号")
    issue_description = Column(Text, nullable=False, comment="问题描述")
    issue_type = Column(
        SQLEnum(IssueType, native_enum=False, length=20),
        nullable=False,
        comment="问题类型"
    )
    
    # 责任与处理
    assigned_to = Column(Integer, nullable=True, comment="责任人ID")
    assigned_dept = Column(String(100), nullable=True, comment="责任部门")
    
    # 解决方案
    root_cause = Column(Text, nullable=True, comment="根本原因")
    solution = Column(Text, nullable=True, comment="解决方案")
    solution_file_path = Column(String(500), nullable=True, comment="对策附件路径")
    
    # 验证信息
    verification_method = Column(Text, nullable=True, comment="验证方法")
    verification_result = Column(String(20), nullable=True, comment="验证结果：passed/failed")
    verified_by = Column(Integer, nullable=True, comment="验证人ID")
    verified_at = Column(DateTime, nullable=True, comment="验证时间")
    
    # 问题状态
    status = Column(
        SQLEnum(IssueStatus, native_enum=False, length=20),
        nullable=False,
        default=IssueStatus.OPEN,
        index=True,
        comment="问题状态"
    )
    
    # 升级为8D
    is_escalated_to_8d = Column(Boolean, nullable=False, default=False, comment="是否已升级为8D报告")
    eight_d_id = Column(Integer, nullable=True, comment="关联的8D报告ID")
    escalated_at = Column(DateTime, nullable=True, comment="升级时间")
    escalation_reason = Column(Text, nullable=True, comment="升级原因")
    
    # 遗留问题管理（SOP节点未关闭问题）
    is_legacy_issue = Column(Boolean, nullable=False, default=False, comment="是否为遗留问题")
    legacy_approval_status = Column(String(20), nullable=True, comment="带病量产审批状态：pending/approved/rejected")
    legacy_approval_by = Column(Integer, nullable=True, comment="特批人ID")
    legacy_approval_at = Column(DateTime, nullable=True, comment="特批时间")
    risk_acknowledgement_path = Column(String(500), nullable=True, comment="风险告知书路径")
    
    # 时间节点
    deadline = Column(DateTime, nullable=True, comment="要求完成时间")
    resolved_at = Column(DateTime, nullable=True, comment="解决时间")
    closed_at = Column(DateTime, nullable=True, comment="关闭时间")
    
    # 审计字段
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, comment="创建时间")
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow, comment="更新时间")
    created_by = Column(Integer, nullable=True, comment="创建人ID")
    
    # 关系映射
    trial_production = relationship("TrialProduction", back_populates="trial_issues")
    
    def __repr__(self):
        return f"<TrialIssue(id={self.id}, trial_id={self.trial_id}, type='{self.issue_type}', status='{self.status}')>"
    
    def to_dict(self) -> dict:
        """转换为字典格式"""
        return {
            "id": self.id,
            "problem_report_id": self.problem_report_id,
            "trial_id": self.trial_id,
            "issue_number": self.issue_number,
            "issue_description": self.issue_description,
            "issue_type": self.issue_type,
            "assigned_to": self.assigned_to,
            "assigned_dept": self.assigned_dept,
            "root_cause": self.root_cause,
            "solution": self.solution,
            "solution_file_path": self.solution_file_path,
            "verification_method": self.verification_method,
            "verification_result": self.verification_result,
            "verified_by": self.verified_by,
            "verified_at": self.verified_at.isoformat() if self.verified_at else None,
            "status": self.status,
            "is_escalated_to_8d": self.is_escalated_to_8d,
            "eight_d_id": self.eight_d_id,
            "escalated_at": self.escalated_at.isoformat() if self.escalated_at else None,
            "escalation_reason": self.escalation_reason,
            "is_legacy_issue": self.is_legacy_issue,
            "legacy_approval_status": self.legacy_approval_status,
            "legacy_approval_by": self.legacy_approval_by,
            "legacy_approval_at": self.legacy_approval_at.isoformat() if self.legacy_approval_at else None,
            "risk_acknowledgement_path": self.risk_acknowledgement_path,
            "deadline": self.deadline.isoformat() if self.deadline else None,
            "resolved_at": self.resolved_at.isoformat() if self.resolved_at else None,
            "closed_at": self.closed_at.isoformat() if self.closed_at else None,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }
