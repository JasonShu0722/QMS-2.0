"""Formal cross-module problem report models."""

from __future__ import annotations

from datetime import datetime
import enum
from typing import Optional

from sqlalchemy import Boolean, DateTime, Enum as SQLEnum, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class ProblemRiskLevel(str, enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class ProblemReportStatus(str, enum.Enum):
    OPEN = "open"
    ASSIGNED = "assigned"
    RESPONDING = "responding"
    PENDING_REVIEW = "pending_review"
    VERIFYING = "verifying"
    APPROVED = "approved"
    CLOSED = "closed"
    REJECTED = "rejected"


class ProblemReport(Base):
    """Formal problem follow-up record shared by all source ledgers."""

    __tablename__ = "problem_reports"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    problem_number: Mapped[str] = mapped_column(String(50), nullable=False, unique=True, index=True)
    eight_d_number: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, unique=True, index=True)

    module_key: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    problem_category_key: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    problem_category_label: Mapped[str] = mapped_column(String(100), nullable=False)

    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    risk_level: Mapped[ProblemRiskLevel] = mapped_column(
        SQLEnum(ProblemRiskLevel, native_enum=False, length=20),
        nullable=False,
        default=ProblemRiskLevel.MEDIUM,
        index=True,
    )
    response_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="brief", index=True)
    status: Mapped[ProblemReportStatus] = mapped_column(
        SQLEnum(ProblemReportStatus, native_enum=False, length=30),
        nullable=False,
        default=ProblemReportStatus.OPEN,
        index=True,
    )

    responsible_dept: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    assigned_to: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    action_owner_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    owner_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_by: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    verified_by: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    closed_by: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    brief_response: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    eight_d_payload: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    due_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, index=True)
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    closed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    rejected_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    reopened_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    sources: Mapped[list["ProblemReportSource"]] = relationship(
        "ProblemReportSource",
        back_populates="problem_report",
        cascade="all, delete-orphan",
    )


class ProblemReportSource(Base):
    """Source-ledger mapping for one formal problem report."""

    __tablename__ = "problem_report_sources"
    __table_args__ = (
        UniqueConstraint("source_type", "source_id", "problem_report_id", name="uq_problem_report_source"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    problem_report_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("problem_reports.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    source_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    source_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    source_parent_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)
    source_number: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)

    problem_report: Mapped[ProblemReport] = relationship("ProblemReport", back_populates="sources")
