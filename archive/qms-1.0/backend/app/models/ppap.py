"""
PPAP 数据模型
Production Part Approval Process - 生产件批准程序
"""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Integer, Date, DateTime, Enum as SQLEnum, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
import enum

from .base import Base


class PPAPLevel(str, enum.Enum):
    """PPAP 提交等级枚举"""
    LEVEL_1 = "level_1"  # Level 1: 仅提交 PSW
    LEVEL_2 = "level_2"  # Level 2: PSW + 样品
    LEVEL_3 = "level_3"  # Level 3: PSW + 样品 + 部分支持文件
    LEVEL_4 = "level_4"  # Level 4: PSW + 样品 + 全部支持文件
    LEVEL_5 = "level_5"  # Level 5: PSW + 样品 + 全部支持文件 + 现场评审


class PPAPStatus(str, enum.Enum):
    """PPAP 状态枚举"""
    PENDING = "pending"          # 待提交
    SUBMITTED = "submitted"      # 已提交
    UNDER_REVIEW = "under_review"  # 审核中
    REJECTED = "rejected"        # 已驳回
    APPROVED = "approved"        # 已批准
    EXPIRED = "expired"          # 已过期（需年度再鉴定）


class PPAP(Base):
    """
    PPAP 模型
    用于记录供应商 PPAP 提交、审核和批准过程
    """
    __tablename__ = "ppap_submissions"
    
    # 主键
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    
    # 供应商信息
    supplier_id: Mapped[int] = mapped_column(ForeignKey("suppliers.id"), nullable=False, index=True, comment="供应商ID")
    
    # 物料信息
    material_code: Mapped[str] = mapped_column(String(100), nullable=False, index=True, comment="物料编码")
    
    # PPAP 等级
    ppap_level: Mapped[str] = mapped_column(
        SQLEnum(PPAPLevel, native_enum=False, length=10),
        default=PPAPLevel.LEVEL_3,
        nullable=False,
        comment="PPAP 提交等级"
    )
    
    # 提交日期
    submission_date: Mapped[Optional[datetime]] = mapped_column(Date, index=True, comment="提交日期")
    
    # 状态
    status: Mapped[str] = mapped_column(
        SQLEnum(PPAPStatus, native_enum=False, length=20),
        default=PPAPStatus.PENDING,
        nullable=False,
        index=True,
        comment="状态"
    )
    
    # 文件清单（JSON 格式存储）
    # 包含：18项标准文件的上传状态、文件路径、审核结果等
    # 示例：{"psw": {"uploaded": true, "path": "/uploads/...", "approved": true}, ...}
    documents: Mapped[Optional[dict]] = mapped_column(JSON, comment="文件清单")
    
    # 审核信息
    reviewer_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), comment="审核人ID（SQE）")
    review_comments: Mapped[Optional[str]] = mapped_column(String(1000), comment="审核意见")
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, comment="批准时间")
    
    # 年度再鉴定提醒日期（批准后1年）
    revalidation_due_date: Mapped[Optional[datetime]] = mapped_column(Date, index=True, comment="再鉴定到期日期")
    
    # 审计字段
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, comment="创建时间")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False, comment="更新时间")
    created_by: Mapped[Optional[int]] = mapped_column(comment="创建人ID（SQE）")
    updated_by: Mapped[Optional[int]] = mapped_column(comment="更新人ID")
    
    # 关系映射
    # supplier: Mapped["Supplier"] = relationship("Supplier", back_populates="ppap_submissions")
    # reviewer: Mapped["User"] = relationship("User", foreign_keys=[reviewer_id])
    
    def __repr__(self) -> str:
        return f"<PPAP(id={self.id}, supplier_id={self.supplier_id}, material_code='{self.material_code}', status='{self.status}')>"
    
    def to_dict(self) -> dict:
        """转换为字典格式"""
        return {
            "id": self.id,
            "supplier_id": self.supplier_id,
            "material_code": self.material_code,
            "ppap_level": self.ppap_level,
            "submission_date": self.submission_date.isoformat() if self.submission_date else None,
            "status": self.status,
            "documents": self.documents,
            "reviewer_id": self.reviewer_id,
            "review_comments": self.review_comments,
            "approved_at": self.approved_at.isoformat() if self.approved_at else None,
            "revalidation_due_date": self.revalidation_due_date.isoformat() if self.revalidation_due_date else None,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }
