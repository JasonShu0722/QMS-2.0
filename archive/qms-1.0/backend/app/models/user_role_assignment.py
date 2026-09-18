"""
用户角色分配模型
UserRoleAssignment Model - 用户与角色标签的多对多关联
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class UserRoleAssignment(Base):
    """
    用户角色分配模型

    支持同一个账号绑定多个角色标签。
    """

    __tablename__ = "user_role_assignments"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="用户ID"
    )
    role_tag_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("role_tags.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="角色标签ID"
    )
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
        comment="分配时间"
    )
    assigned_by: Mapped[Optional[int]] = mapped_column(Integer, comment="分配人ID")

    __table_args__ = (
        UniqueConstraint("user_id", "role_tag_id", name="uq_user_role_assignment"),
    )

    user: Mapped["User"] = relationship("User", back_populates="role_assignments")
    role_tag: Mapped["RoleTag"] = relationship("RoleTag", back_populates="user_assignments")

    def __repr__(self) -> str:
        return f"<UserRoleAssignment(id={self.id}, user_id={self.user_id}, role_tag_id={self.role_tag_id})>"
