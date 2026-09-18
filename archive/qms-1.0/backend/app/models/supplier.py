"""
供应商数据模型
Supplier Model - 供应商基础信息与资质管理
"""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
import enum

from .base import Base


class SupplierStatus(str, enum.Enum):
    """供应商状态枚举"""
    PENDING = "pending"      # 待审核
    ACTIVE = "active"        # 正常
    SUSPENDED = "suspended"  # 暂停合作


class Supplier(Base):
    """
    供应商模型
    存储供应商基础信息、联系方式、资质证书等
    """
    __tablename__ = "suppliers"
    
    # 主键
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    
    # 基础信息
    name: Mapped[str] = mapped_column(String(200), nullable=False, comment="供应商名称")
    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True, comment="供应商代码")
    
    # 联系信息
    contact_person: Mapped[Optional[str]] = mapped_column(String(100), comment="联系人")
    contact_email: Mapped[Optional[str]] = mapped_column(String(100), comment="联系邮箱")
    contact_phone: Mapped[Optional[str]] = mapped_column(String(20), comment="联系电话")
    
    # 资质证书信息
    iso9001_cert: Mapped[Optional[str]] = mapped_column(String(255), comment="ISO9001 证书路径")
    iso9001_expiry: Mapped[Optional[datetime]] = mapped_column(DateTime, comment="ISO9001 到期日期")
    iatf16949_cert: Mapped[Optional[str]] = mapped_column(String(255), comment="IATF16949 证书路径")
    iatf16949_expiry: Mapped[Optional[datetime]] = mapped_column(DateTime, comment="IATF16949 到期日期")
    
    # 状态
    status: Mapped[str] = mapped_column(
        SQLEnum(SupplierStatus, native_enum=False, length=20),
        default=SupplierStatus.PENDING,
        nullable=False,
        index=True,
        comment="供应商状态"
    )
    
    # 审计字段
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, comment="创建时间")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False, comment="更新时间")
    created_by: Mapped[Optional[int]] = mapped_column(comment="创建人ID")
    updated_by: Mapped[Optional[int]] = mapped_column(comment="更新人ID")
    
    # 关系映射
    # users: Mapped[list["User"]] = relationship("User", back_populates="supplier")
    
    def __repr__(self) -> str:
        return f"<Supplier(id={self.id}, name='{self.name}', code='{self.code}', status='{self.status}')>"
    
    def to_dict(self) -> dict:
        """转换为字典格式"""
        return {
            "id": self.id,
            "name": self.name,
            "code": self.code,
            "contact_person": self.contact_person,
            "contact_email": self.contact_email,
            "contact_phone": self.contact_phone,
            "iso9001_cert": self.iso9001_cert,
            "iso9001_expiry": self.iso9001_expiry.isoformat() if self.iso9001_expiry else None,
            "iatf16949_cert": self.iatf16949_cert,
            "iatf16949_expiry": self.iatf16949_expiry.isoformat() if self.iatf16949_expiry else None,
            "status": self.status,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }
