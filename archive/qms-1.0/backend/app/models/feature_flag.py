from __future__ import annotations

from datetime import datetime
from typing import Optional
import enum

from sqlalchemy import Boolean, DateTime, Enum as SQLEnum, Integer, JSON, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class FeatureFlagScope(str, enum.Enum):
    GLOBAL = "global"
    WHITELIST = "whitelist"


class FeatureFlagEnvironment(str, enum.Enum):
    STABLE = "stable"
    PREVIEW = "preview"


class FeatureFlag(Base):
    __tablename__ = "feature_flags"
    __table_args__ = (
        UniqueConstraint("feature_key", "environment", name="uq_feature_flags_key_environment"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)

    feature_key: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        index=True,
        comment="Feature flag key",
    )
    feature_name: Mapped[str] = mapped_column(String(200), nullable=False, comment="Feature flag name")
    description: Mapped[Optional[str]] = mapped_column(String(500), comment="Feature flag description")

    is_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, comment="Enabled status")
    scope: Mapped[FeatureFlagScope] = mapped_column(
        SQLEnum(FeatureFlagScope, native_enum=False, length=20),
        default=FeatureFlagScope.GLOBAL,
        nullable=False,
        comment="Exposure scope",
    )

    whitelist_user_ids: Mapped[list[int]] = mapped_column(
        JSON,
        default=list,
        nullable=False,
        comment="Allowed user ids",
    )
    whitelist_supplier_ids: Mapped[list[int]] = mapped_column(
        JSON,
        default=list,
        nullable=False,
        comment="Allowed supplier ids",
    )

    environment: Mapped[FeatureFlagEnvironment] = mapped_column(
        SQLEnum(FeatureFlagEnvironment, native_enum=False, length=20),
        default=FeatureFlagEnvironment.STABLE,
        nullable=False,
        index=True,
        comment="Target environment",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
        comment="Created at",
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
        comment="Updated at",
    )
    created_by: Mapped[Optional[int]] = mapped_column(Integer, comment="Created by user id")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "feature_key": self.feature_key,
            "feature_name": self.feature_name,
            "description": self.description,
            "is_enabled": self.is_enabled,
            "scope": self.scope.value if isinstance(self.scope, FeatureFlagScope) else self.scope,
            "whitelist_user_ids": self.whitelist_user_ids or [],
            "whitelist_supplier_ids": self.whitelist_supplier_ids or [],
            "environment": self.environment.value
            if isinstance(self.environment, FeatureFlagEnvironment)
            else self.environment,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "created_by": self.created_by,
        }

    def is_enabled_for_user(self, user_id: int) -> bool:
        if not self.is_enabled:
            return False
        if self.scope == FeatureFlagScope.GLOBAL:
            return True
        return user_id in (self.whitelist_user_ids or [])

    def is_enabled_for_supplier(self, supplier_id: int) -> bool:
        if not self.is_enabled:
            return False
        if self.scope == FeatureFlagScope.GLOBAL:
            return True
        return supplier_id in (self.whitelist_supplier_ids or [])
