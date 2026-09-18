"""
客户主数据模型
Customer Master Model - 系统管理下维护的客户基础信息
"""
from datetime import datetime
from typing import Optional
from sqlalchemy import DateTime, Enum as SQLEnum, String
from sqlalchemy.orm import Mapped, mapped_column
import enum

from .base import Base


class CustomerStatus(str, enum.Enum):
    """客户主数据状态枚举"""

    ACTIVE = "active"
    SUSPENDED = "suspended"


class CustomerMaster(Base):
    """
    客户主数据
    用于客户质量、出货数据、索赔等模块共享统一客户口径。
    """

    __tablename__ = "customers"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)

    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True, comment="客户代码")
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True, comment="客户名称")

    contact_person: Mapped[Optional[str]] = mapped_column(String(100), comment="联系人")
    contact_email: Mapped[Optional[str]] = mapped_column(String(100), comment="联系邮箱")
    contact_phone: Mapped[Optional[str]] = mapped_column(String(20), comment="联系电话")

    status: Mapped[str] = mapped_column(
        SQLEnum(CustomerStatus, native_enum=False, length=20),
        default=CustomerStatus.ACTIVE,
        nullable=False,
        index=True,
        comment="客户状态",
    )

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, comment="创建时间")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
        comment="更新时间",
    )
    created_by: Mapped[Optional[int]] = mapped_column(comment="创建人ID")
    updated_by: Mapped[Optional[int]] = mapped_column(comment="更新人ID")

    def __repr__(self) -> str:
        return f"<CustomerMaster(id={self.id}, code='{self.code}', name='{self.name}', status='{self.status}')>"
