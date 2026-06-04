"""
制程质量问题单模型
ProcessIssue Model - 制程质量问题发单与闭环管理
"""
from datetime import date, datetime
from typing import Optional
from sqlalchemy import String, DateTime, Integer, Date, Text, ForeignKey, Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column
import enum

from .base import Base
from .process_defect import ResponsibilityCategory


class ProcessIssueStatus(str, enum.Enum):
    """制程问题单状态枚举"""
    OPEN = "open"  # 已开立
    IN_ANALYSIS = "in_analysis"  # 分析中
    IN_VERIFICATION = "in_verification"  # 验证中
    CLOSED = "closed"  # 已关闭
    CANCELLED = "cancelled"  # 已取消


class ProcessIssue(Base):
    """
    制程质量问题单模型
    用于跟踪制程质量异常的闭环管理
    """
    __tablename__ = "process_issues"
    
    # 主键
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    problem_report_id: Mapped[Optional[int]] = mapped_column(
        Integer,
        ForeignKey("problem_reports.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        comment="formal problem report id",
    )
    
    # 问题单编号（自动生成，格式：PQI-YYYYMMDD-XXXX）
    issue_number: Mapped[str] = mapped_column(
        String(50),
        unique=True,
        nullable=False,
        index=True,
        comment="问题单编号"
    )
    
    # 问题描述
    issue_description: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        comment="问题描述"
    )
    
    # 责任类别
    responsibility_category: Mapped[str] = mapped_column(
        SQLEnum(ResponsibilityCategory, native_enum=False, length=50),
        nullable=False,
        index=True,
        comment="责任类别"
    )
    
    # 当前处理人ID
    assigned_to: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
        comment="当前处理人ID"
    )
    
    # 根本原因分析
    root_cause: Mapped[Optional[str]] = mapped_column(
        Text,
        comment="根本原因分析"
    )
    
    # 围堵措施
    containment_action: Mapped[Optional[str]] = mapped_column(
        Text,
        comment="围堵措施"
    )
    
    # 纠正措施
    corrective_action: Mapped[Optional[str]] = mapped_column(
        Text,
        comment="纠正措施"
    )
    
    # 验证期（天数）
    verification_period: Mapped[Optional[int]] = mapped_column(
        Integer,
        comment="验证期（天数）"
    )
    
    # 验证开始日期
    verification_start_date: Mapped[Optional[date]] = mapped_column(
        Date,
        comment="验证开始日期"
    )
    
    # 验证结束日期
    verification_end_date: Mapped[Optional[date]] = mapped_column(
        Date,
        comment="验证结束日期"
    )
    
    # 状态
    status: Mapped[str] = mapped_column(
        SQLEnum(ProcessIssueStatus, native_enum=False, length=50),
        nullable=False,
        default=ProcessIssueStatus.OPEN,
        index=True,
        comment="问题单状态"
    )
    
    # 关联的不良品记录ID（可多个，用逗号分隔）
    related_defect_ids: Mapped[Optional[str]] = mapped_column(
        String(500),
        comment="关联的不良品记录ID"
    )
    
    # 改善证据附件路径（可多个，JSON格式）
    evidence_files: Mapped[Optional[str]] = mapped_column(
        Text,
        comment="改善证据附件路径（JSON格式）"
    )
    
    # 发起人ID
    created_by: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        comment="发起人ID"
    )
    
    # 验证人ID
    verified_by: Mapped[Optional[int]] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        comment="验证人ID"
    )
    
    # 关闭人ID
    closed_by: Mapped[Optional[int]] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        comment="关闭人ID"
    )
    
    # 关闭时间
    closed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime,
        comment="关闭时间"
    )
    
    # 审计字段
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
        comment="创建时间"
    )
    
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
        comment="更新时间"
    )
    
    def __repr__(self) -> str:
        return (
            f"<ProcessIssue(id={self.id}, "
            f"issue_number='{self.issue_number}', "
            f"responsibility_category='{self.responsibility_category}', "
            f"status='{self.status}')>"
        )
    
    def to_dict(self) -> dict:
        """转换为字典格式"""
        return {
            "id": self.id,
            "problem_report_id": self.problem_report_id,
            "issue_number": self.issue_number,
            "issue_description": self.issue_description,
            "responsibility_category": self.responsibility_category,
            "assigned_to": self.assigned_to,
            "root_cause": self.root_cause,
            "containment_action": self.containment_action,
            "corrective_action": self.corrective_action,
            "verification_period": self.verification_period,
            "verification_start_date": self.verification_start_date.isoformat() if self.verification_start_date else None,
            "verification_end_date": self.verification_end_date.isoformat() if self.verification_end_date else None,
            "status": self.status,
            "related_defect_ids": self.related_defect_ids,
            "evidence_files": self.evidence_files,
            "created_by": self.created_by,
            "verified_by": self.verified_by,
            "closed_by": self.closed_by,
            "closed_at": self.closed_at.isoformat() if self.closed_at else None,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }
    
    def is_overdue(self) -> bool:
        """
        判断问题单是否逾期
        Returns:
            True: 已逾期
            False: 未逾期或已关闭
        """
        if self.status in [ProcessIssueStatus.CLOSED, ProcessIssueStatus.CANCELLED]:
            return False
        
        if self.verification_end_date and datetime.now().date() > self.verification_end_date:
            return True
        
        return False
