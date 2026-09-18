"""
Requirements panel status model.

Stores server-side status overrides for the requirements dashboard so the
online panel can be shared by multiple users instead of relying on browser
localStorage.
"""
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class RequirementsPanelStatus(Base):
    """Persisted status override for a single requirements item."""

    __tablename__ = "requirements_panel_statuses"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    item_id: Mapped[str] = mapped_column(
        String(120),
        nullable=False,
        unique=True,
        index=True,
        comment="Requirement item identifier",
    )
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        index=True,
        comment="Requirement status value",
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
        comment="Last updated time",
    )
    updated_by: Mapped[Optional[int]] = mapped_column(
        Integer,
        ForeignKey("requirements_panel_users.id", ondelete="SET NULL"),
        nullable=True,
        comment="Panel user ID who last updated the status",
    )

    __table_args__ = (
        UniqueConstraint("item_id", name="uq_requirements_panel_item_id"),
    )

    def __repr__(self) -> str:
        return f"<RequirementsPanelStatus(item_id='{self.item_id}', status='{self.status}')>"
