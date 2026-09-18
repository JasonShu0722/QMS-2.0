"""
Helpers for building stable user/session API payloads.
"""
from __future__ import annotations

from collections.abc import Iterable
from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.platform_admin import is_platform_admin
from app.models.role_tag import RoleTag
from app.models.supplier import Supplier
from app.models.user import User
from app.models.user_role_assignment import UserRoleAssignment
from app.schemas.role_tag import RoleTagSummarySchema
from app.schemas.user import UserResponseSchema


async def _load_supplier_names(db: AsyncSession, users: Iterable[User]) -> dict[int, str]:
    supplier_ids = sorted({user.supplier_id for user in users if user.supplier_id})
    if not supplier_ids:
        return {}

    result = await db.execute(
        select(Supplier.id, Supplier.name).where(Supplier.id.in_(supplier_ids))
    )
    return {supplier_id: name for supplier_id, name in result.all()}


def _serialize_user(user: User, supplier_name: str | None = None) -> UserResponseSchema:
    return _serialize_user_with_roles(user, supplier_name=supplier_name, role_tags=[])


def _serialize_role_tag(role_tag: RoleTag) -> RoleTagSummarySchema:
    return RoleTagSummarySchema(
        id=role_tag.id,
        role_key=role_tag.role_key,
        role_name=role_tag.role_name,
        description=role_tag.description,
        applicable_user_type=role_tag.applicable_user_type,
        is_active=role_tag.is_active,
        created_at=role_tag.created_at,
        updated_at=role_tag.updated_at,
    )


def _serialize_user_with_roles(
    user: User,
    *,
    supplier_name: str | None = None,
    role_tags: list[RoleTagSummarySchema],
) -> UserResponseSchema:
    return UserResponseSchema(
        id=user.id,
        username=user.username,
        full_name=user.full_name,
        email=user.email,
        phone=user.phone,
        user_type=user.user_type,
        status=user.status,
        department=user.department,
        position=user.position,
        supplier_id=user.supplier_id,
        supplier_name=supplier_name,
        avatar_image_path=user.avatar_image_path,
        signature_image_path=user.digital_signature,
        digital_signature=user.digital_signature,
        allowed_environments=user.allowed_environments,
        is_platform_admin=is_platform_admin(user),
        role_tags=role_tags,
        last_login_at=user.last_login_at,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


async def build_user_response(db: AsyncSession, user: User) -> UserResponseSchema:
    responses = await build_user_responses(db, [user])
    return responses[0]


async def build_user_responses(db: AsyncSession, users: Iterable[User]) -> list[UserResponseSchema]:
    user_list = list(users)
    supplier_name_map = await _load_supplier_names(db, user_list)
    user_ids = [user.id for user in user_list]
    role_map: dict[int, list[RoleTagSummarySchema]] = defaultdict(list)

    if user_ids:
        result = await db.execute(
            select(UserRoleAssignment.user_id, RoleTag)
            .join(RoleTag, RoleTag.id == UserRoleAssignment.role_tag_id)
            .where(UserRoleAssignment.user_id.in_(user_ids))
            .order_by(RoleTag.role_name.asc())
        )
        for user_id, role_tag in result.all():
            role_map[user_id].append(_serialize_role_tag(role_tag))

    return [
        _serialize_user_with_roles(
            user,
            supplier_name=supplier_name_map.get(user.supplier_id),
            role_tags=role_map.get(user.id, []),
        )
        for user in user_list
    ]
