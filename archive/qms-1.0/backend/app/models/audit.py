"""
审核管理模型
Audit Management Models - 内部审核计划、模板、执行记录及不符合项管理
"""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, Integer, ForeignKey, Text, JSON, Date
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class AuditPlan(Base):
    """
    审核计划模型
    管理年度审核计划（体系审核、过程审核、产品审核、客户审核）
    """
    __tablename__ = "audit_plans"
    
    # 主键
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    
    # 审核信息
    audit_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        index=True,
        comment="审核类型: system_audit (IATF16949), process_audit (VDA6.3), product_audit (VDA6.5), customer_audit"
    )
    audit_name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        comment="审核名称"
    )
    
    # 计划日期
    planned_date: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        index=True,
        comment="计划审核日期"
    )
    
    # 审核人员
    auditor_id: Mapped[int] = mapped_column(
        nullable=False,
        index=True,
        comment="主审核员ID"
    )
    
    # 被审核部门
    auditee_dept: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        comment="被审核部门"
    )
    
    # 状态
    status: Mapped[str] = mapped_column(
        String(20),
        default="planned",
        nullable=False,
        index=True,
        comment="状态: planned, in_progress, completed, postponed, cancelled"
    )
    
    # 延期信息
    postpone_reason: Mapped[Optional[str]] = mapped_column(Text, comment="延期原因")
    postpone_approved_by: Mapped[Optional[int]] = mapped_column(comment="延期批准人ID")
    postpone_approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, comment="延期批准时间")
    
    # 备注
    notes: Mapped[Optional[str]] = mapped_column(Text, comment="备注")
    
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
    created_by: Mapped[Optional[int]] = mapped_column(comment="创建人ID")
    
    def __repr__(self) -> str:
        return f"<AuditPlan(id={self.id}, audit_name='{self.audit_name}', type='{self.audit_type}')>"
    
    def to_dict(self) -> dict:
        """转换为字典格式"""
        return {
            "id": self.id,
            "audit_type": self.audit_type,
            "audit_name": self.audit_name,
            "planned_date": self.planned_date.isoformat(),
            "auditor_id": self.auditor_id,
            "auditee_dept": self.auditee_dept,
            "status": self.status,
            "postpone_reason": self.postpone_reason,
            "postpone_approved_by": self.postpone_approved_by,
            "postpone_approved_at": self.postpone_approved_at.isoformat() if self.postpone_approved_at else None,
            "notes": self.notes,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "created_by": self.created_by,
        }


class AuditTemplate(Base):
    """
    审核模板模型
    存储审核检查表模板（VDA 6.3, VDA 6.5, IATF16949等标准模板及自定义模板）
    """
    __tablename__ = "audit_templates"
    
    # 主键
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    
    # 模板信息
    template_name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        unique=True,
        index=True,
        comment="模板名称"
    )
    audit_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        index=True,
        comment="适用审核类型: system_audit, process_audit, product_audit, custom"
    )
    
    # 检查表条款
    checklist_items: Mapped[dict] = mapped_column(
        JSON,
        nullable=False,
        comment="检查表条款列表 (JSON格式，包含条款编号、描述、评分标准等)"
    )
    
    # 评分规则
    scoring_rules: Mapped[dict] = mapped_column(
        JSON,
        nullable=False,
        comment="评分规则 (JSON格式，包含评分方法、等级划分、降级规则等)"
    )
    
    # 模板描述
    description: Mapped[Optional[str]] = mapped_column(Text, comment="模板描述")
    
    # 是否为系统内置模板
    is_builtin: Mapped[bool] = mapped_column(
        default=False,
        nullable=False,
        comment="是否为系统内置模板"
    )
    
    # 状态
    is_active: Mapped[bool] = mapped_column(
        default=True,
        nullable=False,
        index=True,
        comment="是否启用"
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
    created_by: Mapped[Optional[int]] = mapped_column(comment="创建人ID")
    
    def __repr__(self) -> str:
        return f"<AuditTemplate(id={self.id}, template_name='{self.template_name}', type='{self.audit_type}')>"
    
    def to_dict(self) -> dict:
        """转换为字典格式"""
        return {
            "id": self.id,
            "template_name": self.template_name,
            "audit_type": self.audit_type,
            "checklist_items": self.checklist_items,
            "scoring_rules": self.scoring_rules,
            "description": self.description,
            "is_builtin": self.is_builtin,
            "is_active": self.is_active,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "created_by": self.created_by,
        }


class AuditExecution(Base):
    """
    审核执行记录模型
    存储实际执行的审核记录、检查结果和最终得分
    """
    __tablename__ = "audit_executions"
    
    # 主键
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    
    # 关联审核计划
    audit_plan_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("audit_plans.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="审核计划ID"
    )
    
    # 关联审核模板
    template_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("audit_templates.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
        comment="审核模板ID"
    )
    
    # 审核执行信息
    audit_date: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        index=True,
        comment="实际审核日期"
    )
    auditor_id: Mapped[int] = mapped_column(
        nullable=False,
        index=True,
        comment="主审核员ID"
    )
    
    # 审核组成员
    audit_team: Mapped[Optional[dict]] = mapped_column(
        JSON,
        comment="审核组成员列表 (JSON格式)"
    )
    
    # 检查结果
    checklist_results: Mapped[dict] = mapped_column(
        JSON,
        nullable=False,
        comment="检查表结果 (JSON格式，包含每个条款的评分、证据照片等)"
    )
    
    # 最终得分和等级
    final_score: Mapped[Optional[int]] = mapped_column(
        comment="最终得分 (百分制)"
    )
    grade: Mapped[Optional[str]] = mapped_column(
        String(10),
        comment="等级评定 (A/B/C/D)"
    )
    
    # 审核报告
    audit_report_path: Mapped[Optional[str]] = mapped_column(
        String(500),
        comment="审核报告文件路径"
    )
    summary: Mapped[Optional[str]] = mapped_column(
        Text,
        comment="审核总结"
    )
    
    # 状态
    status: Mapped[str] = mapped_column(
        String(20),
        default="draft",
        nullable=False,
        index=True,
        comment="状态: draft, completed, nc_open, nc_closed"
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
    created_by: Mapped[Optional[int]] = mapped_column(comment="创建人ID")
    
    def __repr__(self) -> str:
        return f"<AuditExecution(id={self.id}, audit_plan_id={self.audit_plan_id}, score={self.final_score})>"
    
    def to_dict(self) -> dict:
        """转换为字典格式"""
        return {
            "id": self.id,
            "audit_plan_id": self.audit_plan_id,
            "template_id": self.template_id,
            "audit_date": self.audit_date.isoformat(),
            "auditor_id": self.auditor_id,
            "audit_team": self.audit_team,
            "checklist_results": self.checklist_results,
            "final_score": self.final_score,
            "grade": self.grade,
            "audit_report_path": self.audit_report_path,
            "summary": self.summary,
            "status": self.status,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "created_by": self.created_by,
        }


class AuditNC(Base):
    """
    审核不符合项模型
    管理审核中发现的不符合项及整改跟踪
    """
    __tablename__ = "audit_ncs"
    
    # 主键
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    
    # 关联审核执行记录
    audit_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("audit_executions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="审核执行记录ID"
    )
    
    # NC信息
    nc_item: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        comment="不符合条款"
    )
    nc_description: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        comment="不符合描述"
    )
    
    # 证据照片
    evidence_photo_path: Mapped[Optional[str]] = mapped_column(
        String(500),
        comment="证据照片路径 (多个照片用逗号分隔或JSON格式)"
    )
    
    # 责任部门
    responsible_dept: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        comment="责任部门"
    )
    assigned_to: Mapped[Optional[int]] = mapped_column(
        index=True,
        comment="指派给(用户ID)"
    )
    
    # 整改信息
    root_cause: Mapped[Optional[str]] = mapped_column(
        Text,
        comment="根本原因"
    )
    corrective_action: Mapped[Optional[str]] = mapped_column(
        Text,
        comment="纠正措施"
    )
    corrective_evidence: Mapped[Optional[str]] = mapped_column(
        String(500),
        comment="整改证据文件路径"
    )
    
    # 验证状态
    verification_status: Mapped[str] = mapped_column(
        String(20),
        default="open",
        nullable=False,
        index=True,
        comment="验证状态: open, submitted, verified, closed, rejected"
    )
    verified_by: Mapped[Optional[int]] = mapped_column(comment="验证人ID")
    verified_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime,
        comment="验证时间"
    )
    verification_comment: Mapped[Optional[str]] = mapped_column(
        Text,
        comment="验证意见"
    )
    
    # 期限
    deadline: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        index=True,
        comment="整改期限"
    )
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
    created_by: Mapped[Optional[int]] = mapped_column(comment="创建人ID")
    
    def __repr__(self) -> str:
        return f"<AuditNC(id={self.id}, audit_id={self.audit_id}, status='{self.verification_status}')>"
    
    def to_dict(self) -> dict:
        """转换为字典格式"""
        return {
            "id": self.id,
            "audit_id": self.audit_id,
            "nc_item": self.nc_item,
            "nc_description": self.nc_description,
            "evidence_photo_path": self.evidence_photo_path,
            "responsible_dept": self.responsible_dept,
            "assigned_to": self.assigned_to,
            "root_cause": self.root_cause,
            "corrective_action": self.corrective_action,
            "corrective_evidence": self.corrective_evidence,
            "verification_status": self.verification_status,
            "verified_by": self.verified_by,
            "verified_at": self.verified_at.isoformat() if self.verified_at else None,
            "verification_comment": self.verification_comment,
            "deadline": self.deadline.isoformat(),
            "closed_at": self.closed_at.isoformat() if self.closed_at else None,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "created_by": self.created_by,
        }


class CustomerAudit(Base):
    """
    客户审核模型
    管理客户来厂审核的台账和问题跟踪
    """
    __tablename__ = "customer_audits"
    
    # 主键
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    
    # 客户信息
    customer_name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        index=True,
        comment="客户名称"
    )
    
    # 审核信息
    audit_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        comment="审核类型: system, process, product, qualification, potential_supplier"
    )
    audit_date: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        index=True,
        comment="审核日期"
    )
    
    # 审核结果
    final_result: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        comment="最终结果: passed, conditional_passed, failed, pending"
    )
    score: Mapped[Optional[int]] = mapped_column(
        comment="审核得分 (如果客户提供)"
    )
    
    # 外部问题清单
    external_issue_list_path: Mapped[Optional[str]] = mapped_column(
        String(500),
        comment="客户提供的问题整改清单文件路径 (Excel等)"
    )
    
    # 内部接待人员
    internal_contact: Mapped[Optional[str]] = mapped_column(
        String(255),
        comment="内部接待人员"
    )
    
    # 审核报告
    audit_report_path: Mapped[Optional[str]] = mapped_column(
        String(500),
        comment="审核报告文件路径"
    )
    summary: Mapped[Optional[str]] = mapped_column(
        Text,
        comment="审核总结"
    )
    
    # 状态
    status: Mapped[str] = mapped_column(
        String(20),
        default="completed",
        nullable=False,
        index=True,
        comment="状态: completed, issue_open, issue_closed"
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
    created_by: Mapped[Optional[int]] = mapped_column(comment="创建人ID")
    
    def __repr__(self) -> str:
        return f"<CustomerAudit(id={self.id}, customer_name='{self.customer_name}', result='{self.final_result}')>"
    
    def to_dict(self) -> dict:
        """转换为字典格式"""
        return {
            "id": self.id,
            "customer_name": self.customer_name,
            "audit_type": self.audit_type,
            "audit_date": self.audit_date.isoformat(),
            "final_result": self.final_result,
            "score": self.score,
            "external_issue_list_path": self.external_issue_list_path,
            "internal_contact": self.internal_contact,
            "audit_report_path": self.audit_report_path,
            "summary": self.summary,
            "status": self.status,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "created_by": self.created_by,
        }
