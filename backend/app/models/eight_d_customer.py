"""Customer 8D report models."""

from datetime import datetime
import enum

from sqlalchemy import Boolean, Column, DateTime, Enum as SQLEnum, ForeignKey, Integer, JSON, String, Text, UniqueConstraint, inspect
from sqlalchemy.orm import relationship

from .base import Base


class EightDStatus(str, enum.Enum):
    """Customer 8D report lifecycle status."""

    DRAFT = "draft"
    D0_D3_COMPLETED = "d0_d3_completed"
    D4_D7_IN_PROGRESS = "d4_d7_in_progress"
    D4_D7_COMPLETED = "d4_d7_completed"
    D8_IN_PROGRESS = "d8_in_progress"
    IN_REVIEW = "in_review"
    APPROVED = "approved"
    REJECTED = "rejected"
    CLOSED = "closed"


class ApprovalLevel(str, enum.Enum):
    """Approval level for customer 8D reports."""

    SECTION_MANAGER = "section_manager"
    DEPARTMENT_HEAD = "department_head"
    NONE = "none"


class EightDCustomerComplaintLink(Base):
    """Link one customer 8D report to one or more complaint ledger records."""

    __tablename__ = "eight_d_customer_complaint_links"
    __table_args__ = (
        UniqueConstraint("report_id", "complaint_id", name="uq_eight_d_customer_complaint_link"),
    )

    id = Column(Integer, primary_key=True, index=True)
    report_id = Column(Integer, ForeignKey("eight_d_customer.id"), nullable=False, index=True, comment="8D report id")
    complaint_id = Column(Integer, ForeignKey("customer_complaints.id"), nullable=False, index=True, comment="Complaint id")
    is_primary = Column(Boolean, nullable=False, default=False, comment="Whether this complaint is the primary source record")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, comment="Created at")

    report = relationship("EightDCustomer", back_populates="complaint_links")
    complaint = relationship("CustomerComplaint", back_populates="eight_d_links")

    def __repr__(self) -> str:
        return (
            f"<EightDCustomerComplaintLink(report_id={self.report_id}, "
            f"complaint_id={self.complaint_id}, is_primary={self.is_primary})>"
        )


class EightDCustomer(Base):
    """Customer 8D report."""

    __tablename__ = "eight_d_customer"

    id = Column(Integer, primary_key=True, index=True)
    complaint_id = Column(
        Integer,
        ForeignKey("customer_complaints.id"),
        nullable=False,
        unique=True,
        comment="Primary complaint id",
    )
    report_number = Column(String(30), nullable=True, unique=True, index=True, comment="8D report number")

    d0_d3_cqe = Column(JSON, nullable=True, comment="D0-D3 data maintained by CQE")
    d4_d7_responsible = Column(JSON, nullable=True, comment="D4-D7 data maintained by responsible function")
    d8_horizontal = Column(JSON, nullable=True, comment="D8 data for horizontal deployment and lessons learned")

    status = Column(SQLEnum(EightDStatus), nullable=False, default=EightDStatus.DRAFT, comment="8D report status")
    approval_level = Column(SQLEnum(ApprovalLevel), nullable=False, default=ApprovalLevel.NONE, comment="Approval level")

    submitted_at = Column(DateTime, nullable=True, comment="Submitted at")
    reviewed_at = Column(DateTime, nullable=True, comment="Reviewed at")
    reviewed_by = Column(Integer, ForeignKey("users.id"), nullable=True, comment="Reviewer id")
    review_comments = Column(Text, nullable=True, comment="Review comments")

    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, comment="Created at")
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow, comment="Updated at")

    complaint = relationship("CustomerComplaint", back_populates="eight_d_report")
    complaint_links = relationship(
        "EightDCustomerComplaintLink",
        back_populates="report",
        cascade="all, delete-orphan",
    )
    reviewer = relationship("User", foreign_keys=[reviewed_by], backref="reviewed_customer_8d")

    def _get_primary_complaint(self):
        state = inspect(self)
        if "complaint_links" not in state.unloaded:
            for link in self.complaint_links or []:
                if link.is_primary and link.complaint is not None:
                    return link.complaint

        if "complaint" not in state.unloaded and self.complaint is not None:
            return self.complaint

        return None

    @property
    def related_complaints(self) -> list[dict]:
        """Return related complaint summaries for API serialization."""

        state = inspect(self)
        if "complaint_links" not in state.unloaded and self.complaint_links:
            related: list[dict] = []
            seen_complaint_ids: set[int] = set()
            for link in sorted(self.complaint_links, key=lambda item: (not item.is_primary, item.complaint_id)):
                complaint = link.complaint
                if complaint is None or complaint.id in seen_complaint_ids:
                    continue
                seen_complaint_ids.add(complaint.id)
                related.append(
                    {
                        "complaint_id": complaint.id,
                        "complaint_number": complaint.complaint_number,
                        "complaint_type": complaint.complaint_type.value if complaint.complaint_type else None,
                        "customer_code": complaint.customer_code,
                        "customer_name": complaint.customer_name,
                        "is_primary": bool(link.is_primary),
                    }
                )
            if related:
                return related

        if "complaint" not in state.unloaded and self.complaint:
            return [
                {
                    "complaint_id": self.complaint.id,
                    "complaint_number": self.complaint.complaint_number,
                    "complaint_type": self.complaint.complaint_type.value if self.complaint.complaint_type else None,
                    "customer_code": self.complaint.customer_code,
                    "customer_name": self.complaint.customer_name,
                    "is_primary": True,
                }
            ]

        return []

    @property
    def primary_complaint_number(self) -> str | None:
        complaint = self._get_primary_complaint()
        return complaint.complaint_number if complaint is not None else None

    @property
    def complaint_type(self) -> str | None:
        complaint = self._get_primary_complaint()
        if complaint is None or complaint.complaint_type is None:
            return None
        return complaint.complaint_type.value

    @property
    def customer_code(self) -> str | None:
        complaint = self._get_primary_complaint()
        return complaint.customer_code if complaint is not None else None

    @property
    def customer_name(self) -> str | None:
        complaint = self._get_primary_complaint()
        return complaint.customer_name if complaint is not None else None

    @property
    def end_customer_name(self) -> str | None:
        complaint = self._get_primary_complaint()
        return complaint.end_customer_name if complaint is not None else None

    @property
    def product_type(self) -> str | None:
        complaint = self._get_primary_complaint()
        return complaint.product_type if complaint is not None else None

    @property
    def related_complaint_count(self) -> int:
        return len(self.related_complaints)

    def __repr__(self) -> str:
        return (
            f"<EightDCustomer(id={self.id}, report_number={self.report_number}, "
            f"complaint_id={self.complaint_id}, status={self.status})>"
        )
