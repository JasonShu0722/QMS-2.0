"""
8D 报告数据模型
8D Report - 8D 问题解决报告
"""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Text, DateTime, Enum as SQLEnum, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
import enum

from .base import Base


class EightDStatus(str, enum.Enum):
    """8D 报告状态枚举"""
    DRAFT = "draft"              # 草稿
    SUBMITTED = "submitted"      # 已提交
    UNDER_REVIEW = "under_review"  # 审核中
    REJECTED = "rejected"        # 已驳回
    APPROVED = "approved"        # 已批准
    CLOSED = "closed"            # 已关闭


class EightD(Base):
    """
    8D 报告模型
    用于记录供应商提交的 8D 问题解决报告
    """
    __tablename__ = "eight_d_reports"
    
    # 主键
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    
    # 关联 SCAR
    scar_id: Mapped[int] = mapped_column(ForeignKey("scars.id"), unique=True, nullable=False, index=True, comment="关联的 SCAR ID")
    
    # D0-D3 数据（JSON 格式存储）
    # 包含：问题描述、围堵措施、团队成员、根本原因初步分析等
    d0_d3_data: Mapped[Optional[dict]] = mapped_column(JSON, comment="D0-D3 阶段数据")
    
    # D4-D7 数据（JSON 格式存储）
    # 包含：根本原因分析、纠正措施、预防措施、验证结果等
    d4_d7_data: Mapped[Optional[dict]] = mapped_column(JSON, comment="D4-D7 阶段数据")
    
    # D8 数据（JSON 格式存储）
    # 包含：水平展开、经验教训、团队表彰等
    d8_data: Mapped[Optional[dict]] = mapped_column(JSON, comment="D8 阶段数据")
    
    # 状态
    status: Mapped[str] = mapped_column(
        SQLEnum(EightDStatus, native_enum=False, length=20),
        default=EightDStatus.DRAFT,
        nullable=False,
        index=True,
        comment="状态"
    )
    
    # 提交人
    submitted_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), comment="提交人ID")
    
    # 审核人
    reviewed_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), comment="审核人ID")
    
    # 审核意见
    review_comments: Mapped[Optional[str]] = mapped_column(Text, comment="审核意见")
    
    # 审计字段
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, comment="创建时间")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False, comment="更新时间")
    submitted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, comment="提交时间")
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, comment="审核时间")
    
    # 关系映射
    # scar: Mapped["SCAR"] = relationship("SCAR", back_populates="eight_d_report")
    # submitter: Mapped["User"] = relationship("User", foreign_keys=[submitted_by])
    # reviewer: Mapped["User"] = relationship("User", foreign_keys=[reviewed_by])
    
    def __repr__(self) -> str:
        return f"<EightD(id={self.id}, scar_id={self.scar_id}, status='{self.status}')>"
    
    def to_dict(self) -> dict:
        """转换为字典格式"""
        return {
            "id": self.id,
            "scar_id": self.scar_id,
            "d0_d3_data": self.d0_d3_data,
            "d4_d7_data": self.d4_d7_data,
            "d8_data": self.d8_data,
            "status": self.status,
            "submitted_by": self.submitted_by,
            "reviewed_by": self.reviewed_by,
            "review_comments": self.review_comments,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "submitted_at": self.submitted_at.isoformat() if self.submitted_at else None,
            "reviewed_at": self.reviewed_at.isoformat() if self.reviewed_at else None,
        }
