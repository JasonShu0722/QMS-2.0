"""
供应商资质文件模型
Supplier Document Model - 供应商资质文件管理
"""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, Integer, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class SupplierDocument(Base):
    """
    供应商资质文件模型
    存储供应商上传的各类资质文件（ISO证书、营业执照等）
    """
    __tablename__ = "supplier_documents"
    
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
    
    # 文件信息
    document_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        comment="文件类型: iso9001, iatf16949, business_license, other"
    )
    document_name: Mapped[str] = mapped_column(String(255), nullable=False, comment="文件名称")
    file_path: Mapped[str] = mapped_column(String(500), nullable=False, comment="文件存储路径")
    file_size: Mapped[Optional[int]] = mapped_column(comment="文件大小(字节)")
    
    # 有效期信息
    issue_date: Mapped[Optional[datetime]] = mapped_column(DateTime, comment="签发日期")
    expiry_date: Mapped[Optional[datetime]] = mapped_column(DateTime, index=True, comment="到期日期")
    
    # 审核状态
    review_status: Mapped[str] = mapped_column(
        String(20),
        default="pending",
        nullable=False,
        comment="审核状态: pending, approved, rejected"
    )
    review_comment: Mapped[Optional[str]] = mapped_column(Text, comment="审核意见")
    reviewed_by: Mapped[Optional[int]] = mapped_column(comment="审核人ID")
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, comment="审核时间")
    
    # 审计字段
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, comment="创建时间")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False, comment="更新时间")
    uploaded_by: Mapped[Optional[int]] = mapped_column(comment="上传人ID")
    
    def __repr__(self) -> str:
        return f"<SupplierDocument(id={self.id}, supplier_id={self.supplier_id}, type='{self.document_type}')>"
    
    def to_dict(self) -> dict:
        """转换为字典格式"""
        return {
            "id": self.id,
            "supplier_id": self.supplier_id,
            "document_type": self.document_type,
            "document_name": self.document_name,
            "file_path": self.file_path,
            "file_size": self.file_size,
            "issue_date": self.issue_date.isoformat() if self.issue_date else None,
            "expiry_date": self.expiry_date.isoformat() if self.expiry_date else None,
            "review_status": self.review_status,
            "review_comment": self.review_comment,
            "reviewed_by": self.reviewed_by,
            "reviewed_at": self.reviewed_at.isoformat() if self.reviewed_at else None,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "uploaded_by": self.uploaded_by,
        }
