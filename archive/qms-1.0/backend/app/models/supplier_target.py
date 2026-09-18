"""
供应商质量目标数据模型
Supplier Target - 供应商质量目标设定与签署
"""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Integer, Float, DateTime, Boolean, Enum as SQLEnum, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
import enum

from .base import Base


class TargetType(str, enum.Enum):
    """目标类型枚举"""
    INCOMING_PASS_RATE = "incoming_pass_rate"  # 来料批次合格率
    MATERIAL_PPM = "material_ppm"              # 物料上线不良PPM
    PROCESS_DEFECT_RATE = "process_defect_rate"  # 制程不合格率
    ZERO_KM_PPM = "zero_km_ppm"                # 0KM不良PPM
    MIS_3_PPM = "mis_3_ppm"                    # 3MIS售后不良PPM
    MIS_12_PPM = "mis_12_ppm"                  # 12MIS售后不良PPM


class SupplierTarget(Base):
    """
    供应商质量目标模型
    用于记录供应商年度质量目标的设定与签署
    支持批量设定和单独设定，优先级：单独设定 > 批量设定 > 全局默认值
    """
    __tablename__ = "supplier_targets"
    
    # 主键
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    
    # 供应商信息
    supplier_id: Mapped[int] = mapped_column(ForeignKey("suppliers.id"), nullable=False, index=True, comment="供应商ID")
    
    # 目标年份
    year: Mapped[int] = mapped_column(Integer, nullable=False, index=True, comment="目标年份")
    
    # 目标类型
    target_type: Mapped[str] = mapped_column(
        SQLEnum(TargetType, native_enum=False, length=30),
        nullable=False,
        index=True,
        comment="目标类型"
    )
    
    # 目标值
    target_value: Mapped[float] = mapped_column(Float, nullable=False, comment="目标值")
    
    # 是否为单独设定（区分批量设定和单独设定）
    is_individual: Mapped[bool] = mapped_column(default=False, nullable=False, comment="是否单独设定")
    
    # 签署状态
    is_signed: Mapped[bool] = mapped_column(default=False, nullable=False, index=True, comment="是否已签署")
    signed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, comment="签署时间")
    signed_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), comment="签署人ID（供应商用户）")
    
    # 审批状态
    is_approved: Mapped[bool] = mapped_column(default=False, nullable=False, comment="是否已审批")
    approved_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), comment="审批人ID（质量经理）")
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, comment="审批时间")
    
    # 历史参考数据（辅助决策）
    previous_year_actual: Mapped[Optional[float]] = mapped_column(Float, comment="上一年实际达成值")
    
    # 审计字段
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, comment="创建时间")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False, comment="更新时间")
    created_by: Mapped[Optional[int]] = mapped_column(comment="创建人ID（SQE）")
    updated_by: Mapped[Optional[int]] = mapped_column(comment="更新人ID")
    
    # 唯一约束：每个供应商每年每种目标类型只能有一条记录
    __table_args__ = (
        {"comment": "供应商质量目标设定表"},
    )
    
    # 关系映射
    # supplier: Mapped["Supplier"] = relationship("Supplier", back_populates="targets")
    # signer: Mapped["User"] = relationship("User", foreign_keys=[signed_by])
    # approver: Mapped["User"] = relationship("User", foreign_keys=[approved_by])
    
    def __repr__(self) -> str:
        return f"<SupplierTarget(id={self.id}, supplier_id={self.supplier_id}, year={self.year}, type='{self.target_type}', value={self.target_value})>"
    
    def to_dict(self) -> dict:
        """转换为字典格式"""
        return {
            "id": self.id,
            "supplier_id": self.supplier_id,
            "year": self.year,
            "target_type": self.target_type,
            "target_value": self.target_value,
            "is_individual": self.is_individual,
            "is_signed": self.is_signed,
            "signed_at": self.signed_at.isoformat() if self.signed_at else None,
            "signed_by": self.signed_by,
            "is_approved": self.is_approved,
            "approved_by": self.approved_by,
            "approved_at": self.approved_at.isoformat() if self.approved_at else None,
            "previous_year_actual": self.previous_year_actual,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }
