"""
供应商绩效评价数据模型
Supplier Performance - 供应商月度绩效评分与等级评定
"""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Integer, Float, DateTime, Boolean, Enum as SQLEnum, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column
import enum

from .base import Base


class PerformanceGrade(str, enum.Enum):
    """绩效等级枚举"""
    A = "A"  # 得分 > 95
    B = "B"  # 80 ≤ 得分 ≤ 95
    C = "C"  # 70 ≤ 得分 < 80
    D = "D"  # 得分 < 70


class CooperationLevel(str, enum.Enum):
    """配合度等级枚举"""
    HIGH = "high"    # 高（扣0分）
    MEDIUM = "medium"  # 中（扣5分）
    LOW = "low"      # 低（扣10分）


class SupplierPerformance(Base):
    """
    供应商绩效评价模型
    采用60分制扣分模型，按100分满分折算百分制
    每月1日自动计算，对比2.5.4中签署的目标值
    """
    __tablename__ = "supplier_performances"
    
    # 主键
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    
    # 供应商信息
    supplier_id: Mapped[int] = mapped_column(
        ForeignKey("suppliers.id"),
        nullable=False,
        index=True,
        comment="供应商ID"
    )
    
    # 评价周期
    year: Mapped[int] = mapped_column(Integer, nullable=False, index=True, comment="年份")
    month: Mapped[int] = mapped_column(Integer, nullable=False, index=True, comment="月份")
    
    # 扣分明细（60分制）
    incoming_quality_deduction: Mapped[float] = mapped_column(
        Float,
        default=0.0,
        nullable=False,
        comment="来料质量扣分"
    )
    
    process_quality_deduction: Mapped[float] = mapped_column(
        Float,
        default=0.0,
        nullable=False,
        comment="制程质量扣分"
    )
    
    cooperation_deduction: Mapped[float] = mapped_column(
        Float,
        default=0.0,
        nullable=False,
        comment="配合度扣分"
    )
    
    zero_km_deduction: Mapped[float] = mapped_column(
        Float,
        default=0.0,
        nullable=False,
        comment="0公里/售后质量扣分"
    )
    
    # 总扣分
    total_deduction: Mapped[float] = mapped_column(
        Float,
        default=0.0,
        nullable=False,
        comment="总扣分"
    )
    
    # 最终得分（60分制扣分后按100分满分折算）
    final_score: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        comment="最终得分（百分制）"
    )
    
    # 等级评定
    grade: Mapped[str] = mapped_column(
        SQLEnum(PerformanceGrade, native_enum=False, length=10),
        nullable=False,
        index=True,
        comment="绩效等级"
    )
    
    # 配合度评价（SQE人工评价）
    cooperation_level: Mapped[Optional[str]] = mapped_column(
        SQLEnum(CooperationLevel, native_enum=False, length=20),
        comment="配合度等级"
    )
    
    cooperation_comment: Mapped[Optional[str]] = mapped_column(
        Text,
        comment="配合度评价说明"
    )
    
    # SQE人工校核
    is_reviewed: Mapped[bool] = mapped_column(
        default=False,
        nullable=False,
        comment="是否已人工校核"
    )
    
    reviewed_by: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id"),
        comment="校核人ID（SQE）"
    )
    
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime,
        comment="校核时间"
    )
    
    review_comment: Mapped[Optional[str]] = mapped_column(
        Text,
        comment="校核说明（如核减理由）"
    )
    
    # 校核后调整
    manual_adjustment: Mapped[float] = mapped_column(
        Float,
        default=0.0,
        nullable=False,
        comment="人工调整分数（正数为加分，负数为扣分）"
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
    
    # 唯一约束：每个供应商每月只能有一条绩效记录
    __table_args__ = (
        {"comment": "供应商绩效评价表"},
    )
    
    def __repr__(self) -> str:
        return (
            f"<SupplierPerformance(id={self.id}, "
            f"supplier_id={self.supplier_id}, "
            f"year={self.year}, month={self.month}, "
            f"grade='{self.grade}', score={self.final_score})>"
        )
    
    def to_dict(self) -> dict:
        """转换为字典格式"""
        return {
            "id": self.id,
            "supplier_id": self.supplier_id,
            "year": self.year,
            "month": self.month,
            "incoming_quality_deduction": self.incoming_quality_deduction,
            "process_quality_deduction": self.process_quality_deduction,
            "cooperation_deduction": self.cooperation_deduction,
            "zero_km_deduction": self.zero_km_deduction,
            "total_deduction": self.total_deduction,
            "final_score": self.final_score,
            "grade": self.grade,
            "cooperation_level": self.cooperation_level,
            "cooperation_comment": self.cooperation_comment,
            "is_reviewed": self.is_reviewed,
            "reviewed_by": self.reviewed_by,
            "reviewed_at": self.reviewed_at.isoformat() if self.reviewed_at else None,
            "review_comment": self.review_comment,
            "manual_adjustment": self.manual_adjustment,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }
