"""
Admin permissions API tests aligned to the role-tag based matrix contract.
"""
from datetime import datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_strategy import LocalAuthStrategy
from app.core.config import settings
from app.models.permission import OperationType, Permission
from app.models.role_permission import RolePermission
from app.models.role_tag import RoleTag
from app.models.supplier import Supplier, SupplierStatus
from app.models.user import User, UserStatus, UserType
from app.models.user_role_assignment import UserRoleAssignment
from app.services.role_template_service import DEFAULT_ROLE_TEMPLATES

pytestmark = pytest.mark.foundation_smoke


async def _create_user(
    db_session: AsyncSession,
    *,
    username: str,
    password: str = "TestPass123!",
    full_name: str = "Test User",
    email: str | None = None,
    user_type: UserType = UserType.INTERNAL,
    status: UserStatus = UserStatus.ACTIVE,
    department: str | None = "Quality",
    position: str | None = "SQE",
    supplier_id: int | None = None,
) -> User:
    user = User(
        username=username,
        password_hash=LocalAuthStrategy().hash_password(password),
        full_name=full_name,
        email=email or f"{username}@example.com",
        user_type=user_type,
        status=status,
        department=department if user_type == UserType.INTERNAL else None,
        position=position,
        supplier_id=supplier_id,
        password_changed_at=datetime.utcnow(),
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


async def _create_supplier(
    db_session: AsyncSession,
    *,
    name: str,
    code: str,
) -> Supplier:
    supplier = Supplier(
        name=name,
        code=code,
        status=SupplierStatus.ACTIVE,
    )
    db_session.add(supplier)
    await db_session.commit()
    await db_session.refresh(supplier)
    return supplier


async def _create_role_tag(
    db_session: AsyncSession,
    *,
    role_key: str,
    role_name: str,
    applicable_user_type: UserType | None = UserType.INTERNAL,
    is_active: bool = True,
) -> RoleTag:
    role_tag = RoleTag(
        role_key=role_key,
        role_name=role_name,
        applicable_user_type=applicable_user_type,
        is_active=is_active,
    )
    db_session.add(role_tag)
    await db_session.commit()
    await db_session.refresh(role_tag)
    return role_tag


def _auth_headers(user: User) -> dict[str, str]:
    token = LocalAuthStrategy().create_access_token(user.id)
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_get_permission_matrix_returns_role_rows(
    async_client: AsyncClient, db_session: AsyncSession
):
    admin_username = settings.PLATFORM_ADMIN_USERNAMES.split(",")[0].strip() or "admin"
    admin_user = await _create_user(
        db_session,
        username=admin_username,
        password="AdminPass123!",
        full_name="Permission Admin",
    )
    role_tag = await _create_role_tag(
        db_session,
        role_key="quality.process.engineer",
        role_name="制程质量工程师",
    )
    db_session.add(
        RolePermission(
            role_tag_id=role_tag.id,
            module_path="quality.process",
            operation_type=OperationType.READ,
            is_granted=True,
            created_by=admin_user.id,
        )
    )
    await db_session.commit()

    response = await async_client.get(
        "/api/v1/admin/permissions/matrix",
        headers=_auth_headers(admin_user),
    )

    assert response.status_code == 200
    data = response.json()
    assert sorted(data.keys()) == ["modules", "rows"]
    assert any(module["module_path"] == "system.permissions" for module in data["modules"])

    role_row = next(row for row in data["rows"] if row["role"]["role_key"] == "quality.process.engineer")
    assert role_row["permissions"]["quality.process.read"] is True
    assert role_row["role"]["role_name"] == "制程质量工程师"


@pytest.mark.asyncio
async def test_permission_matrix_requires_platform_admin(
    async_client: AsyncClient, db_session: AsyncSession
):
    regular_user = await _create_user(
        db_session,
        username="permission_viewer",
        password="ViewerPass123!",
    )

    response = await async_client.get(
        "/api/v1/admin/permissions/matrix",
        headers=_auth_headers(regular_user),
    )

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_initialize_role_templates_bootstraps_defaults_and_assigns_super_admin(
    async_client: AsyncClient, db_session: AsyncSession
):
    admin_username = settings.PLATFORM_ADMIN_USERNAMES.split(",")[0].strip() or "admin"
    admin_user = await _create_user(
        db_session,
        username=admin_username,
        password="SeedAdmin123!",
        full_name="Seed Admin",
    )

    response = await async_client.post(
        "/api/v1/admin/permissions/initialize-role-templates",
        headers=_auth_headers(admin_user),
    )

    assert response.status_code == 200
    data = response.json()
    assert data["created_roles"] == len(DEFAULT_ROLE_TEMPLATES)
    assert "sys.super_admin" in data["role_keys"]

    super_admin_role = (
        await db_session.execute(select(RoleTag).where(RoleTag.role_key == "sys.super_admin"))
    ).scalar_one()
    super_admin_assignment = (
        await db_session.execute(
            select(UserRoleAssignment).where(
                UserRoleAssignment.user_id == admin_user.id,
                UserRoleAssignment.role_tag_id == super_admin_role.id,
            )
        )
    ).scalar_one()
    assert super_admin_assignment.assigned_by == admin_user.id

    seeded_permission = (
        await db_session.execute(
            select(RolePermission).where(
                RolePermission.role_tag_id == super_admin_role.id,
                RolePermission.module_path == "system.permissions",
                RolePermission.operation_type == OperationType.UPDATE,
            )
        )
    ).scalar_one()
    assert seeded_permission.is_granted is True


@pytest.mark.asyncio
async def test_role_tag_crud_and_permission_update(
    async_client: AsyncClient, db_session: AsyncSession
):
    admin_username = settings.PLATFORM_ADMIN_USERNAMES.split(",")[0].strip() or "admin"
    admin_user = await _create_user(
        db_session,
        username=admin_username,
        password="RoleAdmin123!",
    )

    create_response = await async_client.post(
        "/api/v1/admin/permissions/roles",
        headers=_auth_headers(admin_user),
        json={
            "role_key": "quality.customer.engineer",
            "role_name": "客户质量工程师",
            "applicable_user_type": "internal",
            "is_active": True,
        },
    )
    assert create_response.status_code == 200
    role_id = create_response.json()["id"]

    update_perm_response = await async_client.put(
        f"/api/v1/admin/permissions/roles/{role_id}/permissions",
        headers=_auth_headers(admin_user),
        json={
            "permissions": [
                {
                    "module_path": "quality.customer",
                    "operation_type": "read",
                    "is_granted": True,
                },
                {
                    "module_path": "quality.customer",
                    "operation_type": "update",
                    "is_granted": True,
                },
            ]
        },
    )
    assert update_perm_response.status_code == 200
    assert update_perm_response.json()["affected_permissions"] == 2

    role_permissions = (
        await db_session.execute(select(RolePermission).where(RolePermission.role_tag_id == role_id))
    ).scalars().all()
    assert len(role_permissions) == 2

    update_role_response = await async_client.put(
        f"/api/v1/admin/permissions/roles/{role_id}",
        headers=_auth_headers(admin_user),
        json={
            "role_name": "客户质量工程师-更新",
            "description": "测试更新",
            "applicable_user_type": "internal",
            "is_active": False,
        },
    )
    assert update_role_response.status_code == 200
    assert update_role_response.json()["is_active"] is False


@pytest.mark.asyncio
async def test_delete_role_tag_rejected_when_assigned(
    async_client: AsyncClient, db_session: AsyncSession
):
    admin_username = settings.PLATFORM_ADMIN_USERNAMES.split(",")[0].strip() or "admin"
    admin_user = await _create_user(
        db_session,
        username=admin_username,
        password="RoleDeleteAdmin123!",
    )
    role_tag = await _create_role_tag(
        db_session,
        role_key="quality.supplier.engineer",
        role_name="供应商质量工程师",
    )
    target_user = await _create_user(
        db_session,
        username="assigned_role_user",
        password="AssignedRole123!",
    )
    db_session.add(
        UserRoleAssignment(
            user_id=target_user.id,
            role_tag_id=role_tag.id,
            assigned_by=admin_user.id,
        )
    )
    await db_session.commit()

    response = await async_client.delete(
        f"/api/v1/admin/permissions/roles/{role_tag.id}",
        headers=_auth_headers(admin_user),
    )

    assert response.status_code == 400
    assert "请先解除分配" in response.json()["detail"]


@pytest.mark.asyncio
async def test_grant_and_revoke_direct_permissions_still_supported(
    async_client: AsyncClient, db_session: AsyncSession
):
    admin_username = settings.PLATFORM_ADMIN_USERNAMES.split(",")[0].strip() or "admin"
    admin_user = await _create_user(
        db_session,
        username=admin_username,
        password="GrantAdmin123!",
    )
    target_user = await _create_user(
        db_session,
        username="grant_target_user",
        password="GrantTarget123!",
    )
    supplier = await _create_supplier(
        db_session,
        name="Direct Permission Supplier",
        code="SUP-DIRECT-001",
    )
    supplier_user = await _create_user(
        db_session,
        username="direct_permission_supplier",
        user_type=UserType.SUPPLIER,
        supplier_id=supplier.id,
        full_name="Direct Supplier",
    )

    grant_response = await async_client.put(
        "/api/v1/admin/permissions/grant",
        headers=_auth_headers(admin_user),
        json={
            "user_ids": [target_user.id, supplier_user.id],
            "permissions": [
                {"module_path": "supplier.management", "operation_type": "read"},
            ],
        },
    )
    assert grant_response.status_code == 200
    assert grant_response.json()["affected_permissions"] == 2

    revoke_response = await async_client.put(
        "/api/v1/admin/permissions/revoke",
        headers=_auth_headers(admin_user),
        json={
            "user_ids": [target_user.id],
            "permissions": [
                {"module_path": "supplier.management", "operation_type": "read"},
            ],
        },
    )
    assert revoke_response.status_code == 200

    permission = (
        await db_session.execute(
            select(Permission).where(
                Permission.user_id == target_user.id,
                Permission.module_path == "supplier.management",
            )
        )
    ).scalar_one()
    assert permission.is_granted is False
