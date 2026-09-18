from __future__ import annotations

from datetime import datetime
from enum import Enum

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, JSON, String
from sqlalchemy.dialects.postgresql import ARRAY as PG_ARRAY
from sqlalchemy.orm import relationship

from app.models.base import Base


class ActionType(str, Enum):
    SEND_EMAIL = "send_email"
    SEND_NOTIFICATION = "send_notification"
    SEND_WEBHOOK = "send_webhook"


class NotificationRule(Base):
    __tablename__ = "notification_rules"

    id = Column(Integer, primary_key=True, index=True, comment="Rule id")

    rule_name = Column(String(200), nullable=False, comment="Rule name")
    business_object = Column(
        String(100),
        nullable=False,
        index=True,
        comment="Business object, for example scar / ppap / audit / complaint",
    )

    trigger_condition = Column(
        JSON,
        nullable=False,
        comment='Trigger condition JSON, for example {"field": "status", "operator": "equals", "value": "rejected"}',
    )

    action_type = Column(
        String(50),
        nullable=False,
        comment="Action type: send_email / send_notification / send_webhook",
    )
    action_config = Column(
        JSON,
        nullable=False,
        comment='Action config JSON, for example {"recipients": ["user_id"], "template": "rejection_notice"}',
    )

    escalation_enabled = Column(
        Boolean,
        default=False,
        nullable=False,
        comment="Whether timeout escalation is enabled",
    )
    escalation_hours = Column(
        Integer,
        nullable=True,
        comment="Escalation trigger threshold in hours",
    )
    # Keep PostgreSQL native array semantics in runtime environments while allowing
    # SQLite-based tests to create metadata successfully via a JSON fallback.
    escalation_recipients = Column(
        JSON().with_variant(PG_ARRAY(Integer), "postgresql"),
        nullable=True,
        comment="Escalation recipient user id list",
    )

    is_active = Column(
        Boolean,
        default=True,
        nullable=False,
        index=True,
        comment="Whether the rule is active",
    )

    created_at = Column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
        comment="Created at",
    )
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
        comment="Updated at",
    )
    created_by = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        comment="Creator user id",
    )

    creator = relationship("User", foreign_keys=[created_by])

    def __repr__(self) -> str:
        return (
            f"<NotificationRule(id={self.id}, name={self.rule_name}, "
            f"object={self.business_object}, active={self.is_active})>"
        )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "rule_name": self.rule_name,
            "business_object": self.business_object,
            "trigger_condition": self.trigger_condition,
            "action_type": self.action_type,
            "action_config": self.action_config,
            "escalation_enabled": self.escalation_enabled,
            "escalation_hours": self.escalation_hours,
            "escalation_recipients": self.escalation_recipients,
            "is_active": self.is_active,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "created_by": self.created_by,
        }
