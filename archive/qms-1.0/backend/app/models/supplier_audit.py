"""
供应商审核模型
Supplier Audit Model - 供应商审核计划与记录管理
"""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, Integer, ForeignKey, Text, JSON, Date
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class SupplierAuditPlan(Base):
    """
    供应商审核计划模型
    管理年度供应商审核计划
    """
    __tablename__ = "supplier_audit_plans"
    
    # 主键
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    
    # 关联供应商
    supplier_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("suppliers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="供应商ID"
    )
    
    # 审核信息
    audit_year: Mapped[int] = mapped_column(nullable=False, index=True, comment="审核年度")
    audit_month: Mapped[int] = mapped_column(nullable=False, comment="计划审核月份")
    audit_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        comment="审核类型: system, process, product, qualification"
    )
    
    # 责任人
    auditor_id: Mapped[int] = mapped_column(nullable=False, comment="审核员ID(SQE)")
    
    # 状态
    status: Mapped[str] = mapped_column(
        String(20),
        default="planned",
        nullable=False,
        index=True,
        comment="状态: planned, in_progress, completed, postponed, cancelled"
    )
    
    # 备注
    notes: Mapped[Optional[str]] = mapped_column(Text, comment="备注")
    
    # 审计字段
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, comment="创建时间")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False, comment="更新时间")
    created_by: Mapped[Optional[int]] = mapped_column(comment="创建人ID")
    
    def __repr__(self) -> str:
        return f"<SupplierAuditPlan(id={self.id}, supplier_id={self.supplier_id}, year={self.audit_year}, month={self.audit_month})>"
    
    def to_dict(self) -> dict:
        """转换为字典格式"""
        return {
            "id": self.id,
            "supplier_id": self.supplier_id,
            "audit_year": self.audit_year,
            "audit_month": self.audit_month,
            "audit_type": self.audit_type,
            "auditor_id": self.auditor_id,
            "status": self.status,
            "notes": self.notes,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "created_by": self.created_by,
        }


class SupplierAudit(Base):
    """
    供应商审核记录模型
    存储实际执行的审核记录和结果
    """
    __tablename__ = "supplier_audits"
    
    # 主键
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    
    # 关联审核计划（可选）
    audit_plan_id: Mapped[Optional[int]] = mapped_column(
        Integer,
        ForeignKey("supplier_audit_plans.id", ondelete="SET NULL"),
        index=True,
        comment="审核计划ID"
    )
    
    # 关联供应商
    supplier_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("suppliers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="供应商ID"
    )
    
    # 审核信息
    audit_number: Mapped[str] = mapped_column(
        String(50),
        unique=True,
        nullable=False,
        index=True,
        comment="审核编号"
    )
    audit_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        comment="审核类型: system, process, product, qualification"
    )
    audit_date: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True, comment="审核日期")
    
    # 审核人员
    auditor_id: Mapped[int] = mapped_column(nullable=False, comment="主审核员ID")
    audit_team: Mapped[Optional[dict]] = mapped_column(JSON, comment="审核组成员")
    
    # 审核结果
    audit_result: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        comment="审核结果: passed, conditional_passed, failed"
    )
    score: Mapped[Optional[int]] = mapped_column(comment="审核得分")
    
    # 不符合项统计
    nc_major_count: Mapped[int] = mapped_column(default=0, nullable=False, comment="严重不符合项数量")
    nc_minor_count: Mapped[int] = mapped_column(default=0, nullable=False, comment="一般不符合项数量")
    nc_observation_count: Mapped[int] = mapped_column(default=0, nullable=False, comment="观察项数量")
    
    # 审核报告
    audit_report_path: Mapped[Optional[str]] = mapped_column(String(500), comment="审核报告路径")
    summary: Mapped[Optional[str]] = mapped_column(Text, comment="审核总结")
    
    # 状态
    status: Mapped[str] = mapped_column(
        String(20),
        default="completed",
        nullable=False,
        comment="状态: completed, nc_open, nc_closed"
    )
    
    # 审计字段
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, comment="创建时间")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False, comment="更新时间")
    created_by: Mapped[Optional[int]] = mapped_column(comment="创建人ID")
    
    def __repr__(self) -> str:
        return f"<SupplierAudit(id={self.id}, audit_number='{self.audit_number}', result='{self.audit_result}')>"
    
    def to_dict(self) -> dict:
        """转换为字典格式"""
        return {
            "id": self.id,
            "audit_plan_id": self.audit_plan_id,
            "supplier_id": self.supplier_id,
            "audit_number": self.audit_number,
            "audit_type": self.audit_type,
            "audit_date": self.audit_date.isoformat(),
            "auditor_id": self.auditor_id,
            "audit_team": self.audit_team,
            "audit_result": self.audit_result,
            "score": self.score,
            "nc_major_count": self.nc_major_count,
            "nc_minor_count": self.nc_minor_count,
            "nc_observation_count": self.nc_observation_count,
            "audit_report_path": self.audit_report_path,
            "summary": self.summary,
            "status": self.status,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "created_by": self.created_by,
        }


class SupplierAuditNC(Base):
    """
    供应商审核不符合项模型
    管理审核中发现的不符合项及整改跟踪
    """
    __tablename__ = "supplier_audit_ncs"
    
    # 主键
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    
    # 关联审核记录
    audit_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("supplier_audits.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="审核记录ID"
    )
    
    # NC信息
    nc_number: Mapped[str] = mapped_column(
        String(50),
        unique=True,
        nullable=False,
        index=True,
        comment="NC编号"
    )
    nc_type: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        comment="NC类型: major, minor, observation"
    )
    nc_item: Mapped[str] = mapped_column(String(255), nullable=False, comment="不符合条款")
    nc_description: Mapped[str] = mapped_column(Text, nullable=False, comment="不符合描述")
    
    # 证据
    evidence_photos: Mapped[Optional[dict]] = mapped_column(JSON, comment="证据照片列表")
    
    # 责任部门
    responsible_dept: Mapped[Optional[str]] = mapped_column(String(100), comment="责任部门")
    assigned_to: Mapped[Optional[int]] = mapped_column(index=True, comment="指派给(用户ID)")
    
    # 整改信息
    root_cause: Mapped[Optional[str]] = mapped_column(Text, comment="根本原因")
    corrective_action: Mapped[Optional[str]] = mapped_column(Text, comment="纠正措施")
    corrective_evidence: Mapped[Optional[dict]] = mapped_column(JSON, comment="整改证据")
    
    # 验证
    verification_status: Mapped[str] = mapped_column(
        String(20),
        default="open",
        nullable=False,
        index=True,
        comment="验证状态: open, submitted, verified, closed"
    )
    verified_by: Mapped[Optional[int]] = mapped_column(comment="验证人ID")
    verified_at: Mapped[Optional[datetime]] = mapped_column(DateTime, comment="验证时间")
    verification_comment: Mapped[Optional[str]] = mapped_column(Text, comment="验证意见")
    
    # 期限
    deadline: Mapped[Optional[datetime]] = mapped_column(DateTime, index=True, comment="整改期限")
    closed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, comment="关闭时间")
    
    # 审计字段
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, comment="创建时间")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False, comment="更新时间")
    created_by: Mapped[Optional[int]] = mapped_column(comment="创建人ID")
    
    def __repr__(self) -> str:
        return f"<SupplierAuditNC(id={self.id}, nc_number='{self.nc_number}', status='{self.verification_status}')>"
    
    def to_dict(self) -> dict:
        """转换为字典格式"""
        return {
            "id": self.id,
            "audit_id": self.audit_id,
            "nc_number": self.nc_number,
            "nc_type": self.nc_type,
            "nc_item": self.nc_item,
            "nc_description": self.nc_description,
            "evidence_photos": self.evidence_photos,
            "responsible_dept": self.responsible_dept,
            "assigned_to": self.assigned_to,
            "root_cause": self.root_cause,
            "corrective_action": self.corrective_action,
            "corrective_evidence": self.corrective_evidence,
            "verification_status": self.verification_status,
            "verified_by": self.verified_by,
            "verified_at": self.verified_at.isoformat() if self.verified_at else None,
            "verification_comment": self.verification_comment,
            "deadline": self.deadline.isoformat() if self.deadline else None,
            "closed_at": self.closed_at.isoformat() if self.closed_at else None,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "created_by": self.created_by,
        }
