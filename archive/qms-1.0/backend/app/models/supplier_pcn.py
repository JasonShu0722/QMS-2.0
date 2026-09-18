"""
供应商变更管理模型
Supplier PCN (Product Change Notification) Model - 供应商变更申请管理
"""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, Integer, ForeignKey, Text, JSON
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class SupplierPCN(Base):
    """
    供应商变更通知模型
    管理供应商提交的产品/工艺变更申请
    """
    __tablename__ = "supplier_pcns"
    
    # 主键
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    
    # PCN编号
    pcn_number: Mapped[str] = mapped_column(
        String(50),
        unique=True,
        nullable=False,
        index=True,
        comment="PCN编号"
    )
    
    # 关联供应商
    supplier_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("suppliers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="供应商ID"
    )
    
    # 变更信息
    change_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        comment="变更类型: material, process, equipment, location, design"
    )
    material_code: Mapped[Optional[str]] = mapped_column(String(100), comment="物料编码")
    change_description: Mapped[str] = mapped_column(Text, nullable=False, comment="变更描述")
    change_reason: Mapped[str] = mapped_column(Text, nullable=False, comment="变更原因")
    
    # 影响评估
    impact_assessment: Mapped[Optional[dict]] = mapped_column(JSON, comment="影响评估数据")
    risk_level: Mapped[Optional[str]] = mapped_column(
        String(20),
        comment="风险等级: low, medium, high"
    )
    
    # 计划时间
    planned_implementation_date: Mapped[Optional[datetime]] = mapped_column(
        DateTime,
        comment="计划实施日期"
    )
    actual_implementation_date: Mapped[Optional[datetime]] = mapped_column(
        DateTime,
        comment="实际实施日期"
    )
    
    # 断点信息
    cutoff_info: Mapped[Optional[dict]] = mapped_column(
        JSON,
        comment="断点信息: 旧料最后批次、新料首批次等"
    )
    
    # 审批流程
    status: Mapped[str] = mapped_column(
        String(20),
        default="submitted",
        nullable=False,
        index=True,
        comment="状态: submitted, under_review, approved, rejected, implemented"
    )
    current_reviewer_id: Mapped[Optional[int]] = mapped_column(comment="当前审核人ID")
    
    # 审核记录
    review_comments: Mapped[Optional[dict]] = mapped_column(
        JSON,
        comment="审核意见记录"
    )
    approved_by: Mapped[Optional[int]] = mapped_column(comment="批准人ID")
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, comment="批准时间")
    
    # 附件
    attachments: Mapped[Optional[dict]] = mapped_column(
        JSON,
        comment="附件列表: 变更前后对比、测试报告等"
    )
    
    # 审计字段
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, comment="创建时间")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False, comment="更新时间")
    submitted_by: Mapped[Optional[int]] = mapped_column(comment="提交人ID")
    
    def __repr__(self) -> str:
        return f"<SupplierPCN(id={self.id}, pcn_number='{self.pcn_number}', status='{self.status}')>"
    
    def to_dict(self) -> dict:
        """转换为字典格式"""
        return {
            "id": self.id,
            "pcn_number": self.pcn_number,
            "supplier_id": self.supplier_id,
            "change_type": self.change_type,
            "material_code": self.material_code,
            "change_description": self.change_description,
            "change_reason": self.change_reason,
            "impact_assessment": self.impact_assessment,
            "risk_level": self.risk_level,
            "planned_implementation_date": self.planned_implementation_date.isoformat() if self.planned_implementation_date else None,
            "actual_implementation_date": self.actual_implementation_date.isoformat() if self.actual_implementation_date else None,
            "cutoff_info": self.cutoff_info,
            "status": self.status,
            "current_reviewer_id": self.current_reviewer_id,
            "review_comments": self.review_comments,
            "approved_by": self.approved_by,
            "approved_at": self.approved_at.isoformat() if self.approved_at else None,
            "attachments": self.attachments,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "submitted_by": self.submitted_by,
        }
