"""
SCAR 数据模型
Supplier Corrective Action Request - 供应商纠正措施请求
"""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Integer, Text, DateTime, Enum as SQLEnum, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
import enum

from .base import Base


class SCARSeverity(str, enum.Enum):
    """SCAR 严重度枚举"""
    LOW = "low"          # 低
    MEDIUM = "medium"    # 中
    HIGH = "high"        # 高
    CRITICAL = "critical"  # 严重


class SCARStatus(str, enum.Enum):
    """SCAR 状态枚举"""
    OPEN = "open"                    # 已开立
    SUPPLIER_RESPONDING = "supplier_responding"  # 供应商回复中
    UNDER_REVIEW = "under_review"    # 审核中
    REJECTED = "rejected"            # 已驳回
    APPROVED = "approved"            # 已批准
    CLOSED = "closed"                # 已关闭


class SCAR(Base):
    """
    SCAR 模型 - 供应商纠正措施请求
    用于记录供应商质量问题及整改要求
    """
    __tablename__ = "scars"
    
    # 主键
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    
    # SCAR 编号（自动生成，格式：SCAR-YYYYMMDD-XXXX）
    scar_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True, comment="SCAR 单号")
    
    # 供应商信息
    supplier_id: Mapped[int] = mapped_column(ForeignKey("suppliers.id"), nullable=False, index=True, comment="供应商ID")
    
    # 物料信息
    material_code: Mapped[str] = mapped_column(String(100), nullable=False, index=True, comment="物料编码")
    material_category: Mapped[Optional[str]] = mapped_column(String(20), nullable=True, index=True, comment="来料分类：structure/electronic")
    
    # 缺陷描述
    defect_description: Mapped[str] = mapped_column(Text, nullable=False, comment="缺陷描述")
    defect_qty: Mapped[int] = mapped_column(Integer, nullable=False, comment="不良数量")
    
    # 严重度
    severity: Mapped[str] = mapped_column(
        SQLEnum(SCARSeverity, native_enum=False, length=20),
        nullable=False,
        index=True,
        comment="严重度"
    )
    
    # 状态
    status: Mapped[str] = mapped_column(
        SQLEnum(SCARStatus, native_enum=False, length=30),
        default=SCARStatus.OPEN,
        nullable=False,
        index=True,
        comment="状态"
    )
    
    # 当前处理人
    current_handler_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), index=True, comment="当前处理人ID")
    
    # 截止日期
    deadline: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True, comment="截止日期")
    
    # 审计字段
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, comment="创建时间")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False, comment="更新时间")
    created_by: Mapped[Optional[int]] = mapped_column(comment="创建人ID")
    updated_by: Mapped[Optional[int]] = mapped_column(comment="更新人ID")
    
    # 关系映射
    # supplier: Mapped["Supplier"] = relationship("Supplier", back_populates="scars")
    # current_handler: Mapped["User"] = relationship("User", foreign_keys=[current_handler_id])
    # eight_d_report: Mapped["EightD"] = relationship("EightD", back_populates="scar", uselist=False)
    
    def __repr__(self) -> str:
        return f"<SCAR(id={self.id}, scar_number='{self.scar_number}', supplier_id={self.supplier_id}, status='{self.status}')>"
    
    def to_dict(self) -> dict:
        """转换为字典格式"""
        return {
            "id": self.id,
            "scar_number": self.scar_number,
            "supplier_id": self.supplier_id,
            "material_code": self.material_code,
            "material_category": self.material_category,
            "defect_description": self.defect_description,
            "defect_qty": self.defect_qty,
            "severity": self.severity,
            "status": self.status,
            "current_handler_id": self.current_handler_id,
            "deadline": self.deadline.isoformat(),
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }
