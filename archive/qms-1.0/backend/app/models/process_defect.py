"""
过程质量不良品数据模型
ProcessDefect Model - 制程不合格品记录
"""
from datetime import date, datetime
from typing import Optional
from sqlalchemy import String, DateTime, Integer, Date, ForeignKey, Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column
import enum

from .base import Base


class ResponsibilityCategory(str, enum.Enum):
    """责任类别枚举"""
    MATERIAL_DEFECT = "material_defect"  # 物料不良
    OPERATION_DEFECT = "operation_defect"  # 作业不良
    EQUIPMENT_DEFECT = "equipment_defect"  # 设备不良
    PROCESS_DEFECT = "process_defect"  # 工艺不良
    DESIGN_DEFECT = "design_defect"  # 设计不良


class ProcessDefect(Base):
    """
    制程不良品模型
    记录生产过程中发现的不合格品数据，支持责任分类统计
    """
    __tablename__ = "process_defects"
    
    # 主键
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    defect_number: Mapped[Optional[str]] = mapped_column(
        String(50),
        unique=True,
        nullable=True,
        index=True,
        comment="defect source number",
    )
    
    # 不良发生日期
    defect_date: Mapped[date] = mapped_column(
        Date,
        nullable=False,
        index=True,
        comment="不良发生日期"
    )
    
    # 工单号
    work_order: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        index=True,
        comment="工单号"
    )
    
    # 工序ID
    process_id: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        index=True,
        comment="工序ID"
    )
    
    # 产线ID
    line_id: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        index=True,
        comment="产线ID"
    )
    
    # 不良类型/失效模式
    defect_type: Mapped[str] = mapped_column(
        String(200),
        nullable=False,
        comment="不良类型/失效模式"
    )
    
    # 不良数量
    defect_qty: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment="不良数量"
    )
    
    # 责任类别
    responsibility_category: Mapped[str] = mapped_column(
        SQLEnum(ResponsibilityCategory, native_enum=False, length=50),
        nullable=False,
        index=True,
        comment="责任类别"
    )
    
    # 操作员ID（可选）
    operator_id: Mapped[Optional[int]] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        comment="操作员ID"
    )
    
    # 记录人ID
    recorded_by: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        comment="记录人ID"
    )
    
    # 物料编码（当责任类别为物料不良时填写）
    material_code: Mapped[Optional[str]] = mapped_column(
        String(100),
        index=True,
        comment="物料编码"
    )
    
    # 供应商ID（当责任类别为物料不良时关联）
    supplier_id: Mapped[Optional[int]] = mapped_column(
        Integer,
        ForeignKey("suppliers.id", ondelete="SET NULL"),
        index=True,
        comment="供应商ID"
    )
    
    # 备注
    remarks: Mapped[Optional[str]] = mapped_column(
        String(500),
        comment="备注"
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
            f"<ProcessDefect(id={self.id}, "
            f"work_order='{self.work_order}', "
            f"defect_type='{self.defect_type}', "
            f"defect_qty={self.defect_qty}, "
            f"responsibility_category='{self.responsibility_category}')>"
        )
    
    def to_dict(self) -> dict:
        """转换为字典格式"""
        return {
            "id": self.id,
            "defect_number": self.defect_number,
            "defect_date": self.defect_date.isoformat(),
            "work_order": self.work_order,
            "process_id": self.process_id,
            "line_id": self.line_id,
            "defect_type": self.defect_type,
            "defect_qty": self.defect_qty,
            "responsibility_category": self.responsibility_category,
            "operator_id": self.operator_id,
            "recorded_by": self.recorded_by,
            "material_code": self.material_code,
            "supplier_id": self.supplier_id,
            "remarks": self.remarks,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }
