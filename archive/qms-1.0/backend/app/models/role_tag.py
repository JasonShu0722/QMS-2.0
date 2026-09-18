"""
角色标签模型
RoleTag Model - 用于统一定义可分配给用户的角色标签
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Enum as SQLEnum, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base
from .user import UserType


class RoleTag(Base):
    """
    角色标签模型

    角色标签用于统一承载一组权限，再由管理员将角色标签分配给账号，
    从而避免逐个用户维护权限。
    """

    __tablename__ = "role_tags"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    role_key: Mapped[str] = mapped_column(
        String(100),
        unique=True,
        nullable=False,
        index=True,
        comment="角色唯一键"
    )
    role_name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        comment="角色名称"
    )
    description: Mapped[Optional[str]] = mapped_column(
        String(255),
        comment="角色描述"
    )
    applicable_user_type: Mapped[Optional[str]] = mapped_column(
        SQLEnum(UserType, native_enum=False, length=20),
        nullable=True,
        index=True,
        comment="适用用户类型，为空表示全部"
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
        index=True,
        comment="是否启用"
    )
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
    created_by: Mapped[Optional[int]] = mapped_column(Integer, comment="创建人ID")
    updated_by: Mapped[Optional[int]] = mapped_column(Integer, comment="更新人ID")

    role_permissions: Mapped[list["RolePermission"]] = relationship(
        "RolePermission",
        back_populates="role_tag",
        cascade="all, delete-orphan"
    )
    user_assignments: Mapped[list["UserRoleAssignment"]] = relationship(
        "UserRoleAssignment",
        back_populates="role_tag",
        cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<RoleTag(id={self.id}, role_key='{self.role_key}', active={self.is_active})>"
