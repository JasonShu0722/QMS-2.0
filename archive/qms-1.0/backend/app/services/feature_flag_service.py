from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.feature_flag import FeatureFlag, FeatureFlagEnvironment, FeatureFlagScope


class FeatureFlagService:
    DEFAULT_FLAGS = [
        {
            "feature_key": "foundation.workbench.metrics",
            "feature_name": "Workbench Metrics",
            "description": "Controls the foundation metrics block on the workbench.",
            "environment": FeatureFlagEnvironment.STABLE,
            "is_enabled": False,
        },
        {
            "feature_key": "foundation.workbench.metrics",
            "feature_name": "Workbench Metrics",
            "description": "Controls the foundation metrics block on the workbench.",
            "environment": FeatureFlagEnvironment.PREVIEW,
            "is_enabled": False,
        },
        {
            "feature_key": "foundation.workbench.announcements",
            "feature_name": "Workbench Announcements",
            "description": "Controls the announcements block on the workbench.",
            "environment": FeatureFlagEnvironment.STABLE,
            "is_enabled": False,
        },
        {
            "feature_key": "foundation.workbench.announcements",
            "feature_name": "Workbench Announcements",
            "description": "Controls the announcements block on the workbench.",
            "environment": FeatureFlagEnvironment.PREVIEW,
            "is_enabled": False,
        },
        {
            "feature_key": "instruments.management",
            "feature_name": "Instruments Management",
            "description": "Reserved entry for instruments management.",
            "environment": FeatureFlagEnvironment.PREVIEW,
            "is_enabled": False,
        },
        {
            "feature_key": "quality_costs.management",
            "feature_name": "Quality Costs Management",
            "description": "Reserved entry for quality costs management.",
            "environment": FeatureFlagEnvironment.PREVIEW,
            "is_enabled": False,
        },
    ]

    @staticmethod
    def _normalize_environment(
        environment: Optional[str | FeatureFlagEnvironment],
    ) -> FeatureFlagEnvironment:
        if isinstance(environment, FeatureFlagEnvironment):
            return environment
        if environment:
            if environment in {item.value for item in FeatureFlagEnvironment}:
                return FeatureFlagEnvironment(environment)
            return FeatureFlagEnvironment.STABLE
        default_environment = settings.ENVIRONMENT
        if default_environment not in {item.value for item in FeatureFlagEnvironment}:
            default_environment = FeatureFlagEnvironment.STABLE.value
        return FeatureFlagEnvironment(default_environment)

    @staticmethod
    def _normalize_scope(scope: str | FeatureFlagScope) -> FeatureFlagScope:
        return scope if isinstance(scope, FeatureFlagScope) else FeatureFlagScope(scope)

    @staticmethod
    async def ensure_default_feature_flags(db: AsyncSession) -> None:
        result = await db.execute(select(FeatureFlag.feature_key, FeatureFlag.environment))
        existing = {(feature_key, environment) for feature_key, environment in result.all()}

        created = False
        for flag in FeatureFlagService.DEFAULT_FLAGS:
            key = (flag["feature_key"], flag["environment"])
            if key in existing:
                continue

            db.add(
                FeatureFlag(
                    feature_key=flag["feature_key"],
                    feature_name=flag["feature_name"],
                    description=flag["description"],
                    is_enabled=flag["is_enabled"],
                    scope=FeatureFlagScope.GLOBAL,
                    whitelist_user_ids=[],
                    whitelist_supplier_ids=[],
                    environment=flag["environment"],
                )
            )
            created = True

        if created:
            await db.commit()

    @staticmethod
    async def _get_flag_by_key(
        db: AsyncSession,
        feature_key: str,
        environment: Optional[str | FeatureFlagEnvironment] = None,
    ) -> Optional[FeatureFlag]:
        normalized_environment = FeatureFlagService._normalize_environment(environment)
        result = await db.execute(
            select(FeatureFlag).where(
                FeatureFlag.feature_key == feature_key,
                FeatureFlag.environment == normalized_environment,
            )
        )
        return result.scalar_one_or_none()

    @staticmethod
    async def is_feature_enabled(
        db: AsyncSession,
        feature_key: str,
        user_id: Optional[int] = None,
        supplier_id: Optional[int] = None,
        environment: Optional[str] = None,
    ) -> bool:
        await FeatureFlagService.ensure_default_feature_flags(db)

        flag = await FeatureFlagService._get_flag_by_key(db, feature_key, environment)
        if not flag or not flag.is_enabled:
            return False

        if flag.scope == FeatureFlagScope.GLOBAL:
            return True

        if user_id and user_id in (flag.whitelist_user_ids or []):
            return True

        if supplier_id and supplier_id in (flag.whitelist_supplier_ids or []):
            return True

        return False

    @staticmethod
    async def update_feature_flag(
        db: AsyncSession,
        feature_key: str,
        is_enabled: bool,
        scope: str = "global",
        whitelist_user_ids: Optional[list[int]] = None,
        whitelist_supplier_ids: Optional[list[int]] = None,
        environment: Optional[str] = None,
        updated_by: Optional[int] = None,
    ) -> FeatureFlag:
        await FeatureFlagService.ensure_default_feature_flags(db)

        flag = await FeatureFlagService._get_flag_by_key(db, feature_key, environment)
        if not flag:
            raise ValueError(f"功能开关不存在: {feature_key}")

        flag.is_enabled = is_enabled
        flag.scope = FeatureFlagService._normalize_scope(scope)
        flag.whitelist_user_ids = whitelist_user_ids or []
        flag.whitelist_supplier_ids = whitelist_supplier_ids or []
        flag.updated_at = datetime.utcnow()

        if updated_by is not None and flag.created_by is None:
            flag.created_by = updated_by

        await db.commit()
        await db.refresh(flag)
        return flag

    @staticmethod
    async def get_all_feature_flags(
        db: AsyncSession,
        environment: Optional[str] = None,
    ) -> list[FeatureFlag]:
        await FeatureFlagService.ensure_default_feature_flags(db)

        query = select(FeatureFlag)
        if environment:
            query = query.where(FeatureFlag.environment == FeatureFlagService._normalize_environment(environment))

        query = query.order_by(FeatureFlag.environment.asc(), FeatureFlag.feature_key.asc())
        result = await db.execute(query)
        return list(result.scalars().all())

    @staticmethod
    async def get_user_enabled_features(
        db: AsyncSession,
        user_id: int,
        supplier_id: Optional[int] = None,
        environment: Optional[str] = None,
    ) -> list[str]:
        flags = await FeatureFlagService.get_all_feature_flags(db, environment)
        enabled: list[str] = []

        for flag in flags:
            if await FeatureFlagService.is_feature_enabled(
                db=db,
                feature_key=flag.feature_key,
                user_id=user_id,
                supplier_id=supplier_id,
                environment=flag.environment.value,
            ):
                enabled.append(flag.feature_key)

        return enabled

    @staticmethod
    async def create_feature_flag(
        db: AsyncSession,
        feature_key: str,
        feature_name: str,
        description: Optional[str] = None,
        is_enabled: bool = False,
        scope: str = "global",
        whitelist_user_ids: Optional[list[int]] = None,
        whitelist_supplier_ids: Optional[list[int]] = None,
        environment: str = "stable",
        created_by: Optional[int] = None,
    ) -> FeatureFlag:
        normalized_environment = FeatureFlagService._normalize_environment(environment)
        existing = await FeatureFlagService._get_flag_by_key(db, feature_key, normalized_environment)
        if existing:
            raise ValueError(f"功能开关已存在: {feature_key} ({normalized_environment.value})")

        flag = FeatureFlag(
            feature_key=feature_key,
            feature_name=feature_name,
            description=description,
            is_enabled=is_enabled,
            scope=FeatureFlagService._normalize_scope(scope),
            whitelist_user_ids=whitelist_user_ids or [],
            whitelist_supplier_ids=whitelist_supplier_ids or [],
            environment=normalized_environment,
            created_by=created_by,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )

        db.add(flag)
        await db.commit()
        await db.refresh(flag)
        return flag


feature_flag_service = FeatureFlagService()
