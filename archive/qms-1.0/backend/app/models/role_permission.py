"""
角色权限模型
RolePermission Model - 用于为角色标签维护模块级操作权限
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Enum as SQLEnum, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base
from .permission import OperationType


class RolePermission(Base):
    """
    角色权限模型

    每个角色标签对每个模块操作最多保留一条权限记录。
    """

    __tablename__ = "role_permissions"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    role_tag_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("role_tags.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="角色标签ID"
    )
    module_path: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        index=True,
        comment="功能模块路径"
    )
    operation_type: Mapped[str] = mapped_column(
        SQLEnum(OperationType, native_enum=False, length=20),
        nullable=False,
        index=True,
        comment="操作类型"
    )
    is_granted: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
        comment="是否授予"
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

    __table_args__ = (
        UniqueConstraint("role_tag_id", "module_path", "operation_type", name="uq_role_module_operation"),
    )

    role_tag: Mapped["RoleTag"] = relationship("RoleTag", back_populates="role_permissions")

    @property
    def permission_key(self) -> str:
        op_value = self.operation_type.value if hasattr(self.operation_type, "value") else str(self.operation_type)
        return f"{self.module_path}.{op_value}"

    def __repr__(self) -> str:
        return (
            f"<RolePermission(id={self.id}, role_tag_id={self.role_tag_id}, "
            f"module='{self.module_path}', operation='{self.operation_type}', granted={self.is_granted})>"
        )
