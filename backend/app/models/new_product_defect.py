"""New product defect source ledger."""

from __future__ import annotations

from datetime import date, datetime
import enum
from typing import Optional

from sqlalchemy import Date, DateTime, Enum as SQLEnum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class NewProductDefectSourceType(str, enum.Enum):
    TRIAL_DEFECT = "trial_defect"
    CUSTOMER_COMPLAINT = "customer_complaint"


class NewProductDefectStatus(str, enum.Enum):
    REGISTERED = "registered"
    PROMOTED = "promoted"
    CLOSED = "closed"


class NewProductDefect(Base):
    """Simple NPD source record for new-product trial defects and new-product complaints."""

    __tablename__ = "new_product_defects"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    defect_number: Mapped[str] = mapped_column(String(50), nullable=False, unique=True, index=True)
    source_type: Mapped[NewProductDefectSourceType] = mapped_column(
        SQLEnum(NewProductDefectSourceType, native_enum=False, length=30),
        nullable=False,
        index=True,
    )
    status: Mapped[NewProductDefectStatus] = mapped_column(
        SQLEnum(NewProductDefectStatus, native_enum=False, length=30),
        nullable=False,
        default=NewProductDefectStatus.REGISTERED,
        index=True,
    )

    defect_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    project_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("new_product_projects.id", ondelete="SET NULL"), nullable=True, index=True)
    trial_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("trial_productions.id", ondelete="SET NULL"), nullable=True, index=True)
    customer_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True, index=True)
    customer_complaint_number: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    product_code: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    product_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    defect_type: Mapped[str] = mapped_column(String(200), nullable=False)
    defect_description: Mapped[str] = mapped_column(Text, nullable=False)
    defect_qty: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    responsible_dept: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    recorded_by: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True)
    problem_report_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("problem_reports.id", ondelete="SET NULL"), nullable=True, index=True)
    remarks: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
