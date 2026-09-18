"""
Foundation milestone API contract tests.
"""
from datetime import datetime
from datetime import timedelta
from io import BytesIO

import pytest
from httpx import AsyncClient
from PIL import Image, ImageDraw
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_strategy import LocalAuthStrategy
from app.core.config import settings
from app.models.feature_flag import FeatureFlag, FeatureFlagEnvironment, FeatureFlagScope
from app.models.permission import OperationType, Permission
from app.models.role_permission import RolePermission
from app.models.role_tag import RoleTag
from app.models.supplier import Supplier, SupplierStatus
from app.models.user import User, UserStatus, UserType
from app.models.user_role_assignment import UserRoleAssignment

pytestmark = pytest.mark.foundation_smoke


def _bearer_token_for(user: User) -> dict[str, str]:
    token = LocalAuthStrategy().create_access_token(user.id)
    return {"Authorization": f"Bearer {token}"}


def _png_bytes(*, color: str = "white", text: str | None = None) -> BytesIO:
    image = Image.new("RGB", (240, 120), color=color)
    if text:
        draw = ImageDraw.Draw(image)
        draw.text((20, 45), text, fill="black")
    img_bytes = BytesIO()
    image.save(img_bytes, format="PNG")
    img_bytes.seek(0)
    return img_bytes


async def _create_supplier(
    db_session: AsyncSession,
    *,
    name: str = "ACME Supplier",
    code: str = "SUP-001",
    status: SupplierStatus = SupplierStatus.ACTIVE,
) -> Supplier:
    supplier = Supplier(
        name=name,
        code=code,
        status=status,
        contact_person="Supplier Contact",
        contact_email="supplier@example.com",
        contact_phone="13800138001",
    )
    db_session.add(supplier)
    await db_session.commit()
    await db_session.refresh(supplier)
    return supplier


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
    position: str | None = "Engineer",
    supplier_id: int | None = None,
    allowed_environments: str = "stable",
    digital_signature: str | None = None,
    avatar_image_path: str | None = None,
) -> User:
    user = User(
        username=username,
        password_hash=LocalAuthStrategy().hash_password(password),
        full_name=full_name,
        email=email or f"{username}@example.com",
        phone="13800138000",
        user_type=user_type,
        status=status,
        department=department if user_type == UserType.INTERNAL else None,
        position=position,
        supplier_id=supplier_id,
        allowed_environments=allowed_environments,
        digital_signature=digital_signature,
        avatar_image_path=avatar_image_path,
        password_changed_at=datetime.utcnow(),
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


async def _create_feature_flag(
    db_session: AsyncSession,
    *,
    feature_key: str,
    feature_name: str,
    environment: FeatureFlagEnvironment,
    is_enabled: bool,
    scope: FeatureFlagScope = FeatureFlagScope.GLOBAL,
    whitelist_user_ids: list[int] | None = None,
    whitelist_supplier_ids: list[int] | None = None,
) -> FeatureFlag:
    flag = FeatureFlag(
        feature_key=feature_key,
        feature_name=feature_name,
        description=f"Test flag for {feature_key}",
        environment=environment,
        is_enabled=is_enabled,
        scope=scope,
        whitelist_user_ids=whitelist_user_ids or [],
        whitelist_supplier_ids=whitelist_supplier_ids or [],
    )
    db_session.add(flag)
    await db_session.commit()
    await db_session.refresh(flag)
    return flag


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


@pytest.mark.asyncio
async def test_register_approve_and_login_flow(async_client: AsyncClient, db_session: AsyncSession):
    admin_username = settings.PLATFORM_ADMIN_USERNAMES.split(",")[0].strip() or "admin"
    admin_user = await _create_user(
        db_session,
        username=admin_username,
        password="AdminPass123!",
        full_name="Platform Admin",
    )

    register_response = await async_client.post(
        "/api/v1/auth/register",
        json={
            "username": "new_employee",
            "password": "RegisterPass123!",
            "full_name": "New Employee",
            "email": "new_employee@ics-energy.com",
            "phone": "13900139000",
            "user_type": "internal",
            "department": "Quality",
            "position": "SQE",
        },
    )

    assert register_response.status_code == 201
    register_data = register_response.json()
    assert register_data["status"] == "pending"
    user_id = register_data["user_id"]

    blocked_login = await async_client.post(
        "/api/v1/auth/login",
        json={
            "username": "new_employee",
            "password": "RegisterPass123!",
            "user_type": "internal",
        },
    )
    assert blocked_login.status_code == 403

    approve_response = await async_client.post(
        f"/api/v1/admin/users/{user_id}/approve",
        headers=_bearer_token_for(admin_user),
    )
    assert approve_response.status_code == 200
    assert approve_response.json()["status"] == "active"

    login_response = await async_client.post(
        "/api/v1/auth/login",
        json={
            "username": "new_employee",
            "password": "RegisterPass123!",
            "user_type": "internal",
            "environment": "stable",
        },
    )

    assert login_response.status_code == 200
    login_data = login_response.json()
    assert login_data["environment"] == "stable"
    assert login_data["allowed_environments"] == ["stable"]
    assert login_data["password_expired"] is True
    assert login_data["user_info"]["username"] == "new_employee"
    assert login_data["user_info"]["is_platform_admin"] is False
    assert login_data["user_info"]["signature_image_path"] is None


@pytest.mark.asyncio
async def test_login_uses_runtime_environment_for_environment_gate(
    async_client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
):
    await _create_user(
        db_session,
        username="stable_only_user",
        password="StableOnly123!",
        allowed_environments="stable",
    )

    legacy_client_response = await async_client.post(
        "/api/v1/auth/login",
        json={
            "username": "stable_only_user",
            "password": "StableOnly123!",
            "user_type": "internal",
            "environment": "preview",
        },
    )

    assert legacy_client_response.status_code == 200
    assert legacy_client_response.json()["environment"] == "stable"

    monkeypatch.setattr(settings, "ENVIRONMENT", "preview")

    preview_response = await async_client.post(
        "/api/v1/auth/login",
        json={
            "username": "stable_only_user",
            "password": "StableOnly123!",
            "user_type": "internal",
        },
    )

    assert preview_response.status_code == 403
    assert "preview" in preview_response.json()["detail"]


@pytest.mark.asyncio
async def test_auth_me_returns_normalized_supplier_payload(
    async_client: AsyncClient, db_session: AsyncSession
):
    supplier = await _create_supplier(
        db_session,
        name="Northwind Components",
        code="SUP-200",
    )
    supplier_user = await _create_user(
        db_session,
        username="supplier_portal_user",
        user_type=UserType.SUPPLIER,
        supplier_id=supplier.id,
        allowed_environments="stable,preview",
        digital_signature="/uploads/signatures/supplier_portal_user.png",
        avatar_image_path="/uploads/avatars/supplier_portal_user.png",
    )

    response = await async_client.get(
        "/api/v1/auth/me",
        headers=_bearer_token_for(supplier_user),
    )

    assert response.status_code == 200
    data = response.json()
    assert data["username"] == "supplier_portal_user"
    assert data["user_type"] == "supplier"
    assert data["supplier_id"] == supplier.id
    assert data["supplier_name"] == "Northwind Components"
    assert data["signature_image_path"] == "/uploads/signatures/supplier_portal_user.png"
    assert data["digital_signature"] == "/uploads/signatures/supplier_portal_user.png"
    assert data["allowed_environments"] == "stable,preview"
    assert data["is_platform_admin"] is False


@pytest.mark.asyncio
async def test_auth_me_marks_platform_admin_case_insensitively(
    async_client: AsyncClient, db_session: AsyncSession
):
    admin_user = await _create_user(
        db_session,
        username="Admin",
        password="AdminPass123!",
        full_name="Platform Admin",
    )

    response = await async_client.get(
        "/api/v1/auth/me",
        headers=_bearer_token_for(admin_user),
    )

    assert response.status_code == 200
    assert response.json()["is_platform_admin"] is True


@pytest.mark.asyncio
async def test_permission_matrix_requires_platform_admin(
    async_client: AsyncClient, db_session: AsyncSession
):
    non_admin_user = await _create_user(
        db_session,
        username="matrix_viewer",
        password="MatrixPass123!",
    )

    response = await async_client.get(
        "/api/v1/admin/permissions/matrix",
        headers=_bearer_token_for(non_admin_user),
    )

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_permission_matrix_contract_and_mutations(
    async_client: AsyncClient, db_session: AsyncSession
):
    admin_username = settings.PLATFORM_ADMIN_USERNAMES.split(",")[0].strip() or "admin"
    admin_user = await _create_user(
        db_session,
        username=admin_username,
        password="AdminMatrix123!",
        full_name="Permission Admin",
    )
    target_user = await _create_user(
        db_session,
        username="permission_target",
        password="TargetPass123!",
        full_name="Permission Target",
    )
    supplier = await _create_supplier(
        db_session,
        name="Permission Supplier",
        code="SUP-300",
    )
    supplier_user = await _create_user(
        db_session,
        username="supplier_permission_user",
        user_type=UserType.SUPPLIER,
        supplier_id=supplier.id,
        full_name="Supplier Permission User",
    )
    internal_role = await _create_role_tag(
        db_session,
        role_key="quality.process.engineer",
        role_name="制程质量工程师",
        applicable_user_type=UserType.INTERNAL,
    )
    supplier_role = await _create_role_tag(
        db_session,
        role_key="supplier.portal.responder",
        role_name="供应商应答角色",
        applicable_user_type=UserType.SUPPLIER,
    )

    db_session.add_all(
        [
            UserRoleAssignment(
                user_id=target_user.id,
                role_tag_id=internal_role.id,
                assigned_by=admin_user.id,
            ),
            UserRoleAssignment(
                user_id=supplier_user.id,
                role_tag_id=supplier_role.id,
                assigned_by=admin_user.id,
            ),
        ]
    )
    seeded_permission = RolePermission(
        role_tag_id=internal_role.id,
        module_path="supplier.management",
        operation_type=OperationType.READ,
        is_granted=True,
        created_by=admin_user.id,
    )
    db_session.add(seeded_permission)
    await db_session.commit()

    matrix_response = await async_client.get(
        "/api/v1/admin/permissions/matrix",
        headers=_bearer_token_for(admin_user),
    )

    assert matrix_response.status_code == 200
    matrix_data = matrix_response.json()
    assert sorted(matrix_data.keys()) == ["modules", "rows"]
    assert any(
        module["module_path"] == "supplier.management"
        and set(module["operations"]) == {"create", "read", "update", "delete", "export"}
        for module in matrix_data["modules"]
    )

    target_row = next(
        row for row in matrix_data["rows"] if row["role"]["role_key"] == "quality.process.engineer"
    )
    supplier_row = next(
        row for row in matrix_data["rows"] if row["role"]["role_key"] == "supplier.portal.responder"
    )
    assert target_row["permissions"]["supplier.management.read"] is True
    assert target_row["role"]["assigned_user_count"] == 1
    assert supplier_row["role"]["applicable_user_type"] == "supplier"
    assert supplier_row["role"]["assigned_user_count"] == 1

    grant_response = await async_client.put(
        "/api/v1/admin/permissions/grant",
        headers=_bearer_token_for(admin_user),
        json={
            "user_ids": [target_user.id],
            "permissions": [
                {"module_path": "quality.incoming", "operation_type": "read"},
            ],
        },
    )
    assert grant_response.status_code == 200
    assert grant_response.json()["affected_permissions"] == 1

    revoke_response = await async_client.put(
        "/api/v1/admin/permissions/revoke",
        headers=_bearer_token_for(admin_user),
        json={
            "user_ids": [target_user.id],
            "permissions": [
                {"module_path": "quality.incoming", "operation_type": "read"},
            ],
        },
    )
    assert revoke_response.status_code == 200
    assert revoke_response.json()["affected_permissions"] == 1

    permission_result = await db_session.execute(
        select(Permission).where(
            Permission.user_id == target_user.id,
            Permission.module_path == "quality.incoming",
            Permission.operation_type == OperationType.READ,
        )
    )
    updated_permission = permission_result.scalar_one()
    assert updated_permission.is_granted is False


@pytest.mark.asyncio
async def test_internal_workbench_returns_foundation_tasks_and_feature_blocks(
    async_client: AsyncClient, db_session: AsyncSession
):
    admin_username = settings.PLATFORM_ADMIN_USERNAMES.split(",")[0].strip() or "admin"
    admin_user = await _create_user(
        db_session,
        username=admin_username,
        password="WorkbenchAdmin123!",
        full_name="Workbench Admin",
        allowed_environments="stable,preview",
        digital_signature="/uploads/signatures/admin.png",
    )
    await _create_user(
        db_session,
        username="pending_reviewer_target",
        password="PendingPass123!",
        full_name="Pending Reviewer",
        status=UserStatus.PENDING,
    )
    await _create_feature_flag(
        db_session,
        feature_key="foundation.workbench.metrics",
        feature_name="Workbench Metrics",
        environment=FeatureFlagEnvironment.STABLE,
        is_enabled=True,
    )
    await _create_feature_flag(
        db_session,
        feature_key="foundation.workbench.announcements",
        feature_name="Workbench Announcements",
        environment=FeatureFlagEnvironment.STABLE,
        is_enabled=False,
    )
    await _create_feature_flag(
        db_session,
        feature_key="foundation.preview.rollout",
        feature_name="Preview Rollout",
        environment=FeatureFlagEnvironment.PREVIEW,
        is_enabled=True,
    )

    response = await async_client.get(
        "/api/v1/workbench/dashboard",
        headers=_bearer_token_for(admin_user),
    )

    assert response.status_code == 200
    data = response.json()
    assert data["environment"] == settings.ENVIRONMENT
    assert data["user_info"]["is_platform_admin"] is True
    assert data["user_info"]["signature_image_path"] == "/uploads/signatures/admin.png"
    assert {action["title"] for action in data["quick_actions"]} >= {
        "个人中心",
        "用户管理",
        "权限矩阵",
        "功能开关",
    }
    assert data["feature_blocks"] == {
        "metrics": True,
        "announcements": False,
        "notifications": False,
    }
    assert data["todo_summary"] == {
        "total": 2,
        "overdue": 0,
        "due_soon": 2,
    }
    assert len(data["metrics"]) == 1
    assert {item["task_type"] for item in data["todos"]} == {
        "注册审批",
        "权限初始化",
    }


@pytest.mark.asyncio
async def test_my_features_only_returns_current_environment_flags(
    async_client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
):
    feature_user = await _create_user(
        db_session,
        username="feature_env_user",
        password="FeatureEnv123!",
        allowed_environments="stable,preview",
    )
    await _create_feature_flag(
        db_session,
        feature_key="foundation.env.stable-only",
        feature_name="Stable Only",
        environment=FeatureFlagEnvironment.STABLE,
        is_enabled=True,
    )
    await _create_feature_flag(
        db_session,
        feature_key="foundation.env.preview-only",
        feature_name="Preview Only",
        environment=FeatureFlagEnvironment.PREVIEW,
        is_enabled=True,
    )

    monkeypatch.setattr(settings, "ENVIRONMENT", "stable")
    stable_response = await async_client.get(
        "/api/v1/feature-flags/my-features",
        headers=_bearer_token_for(feature_user),
    )

    assert stable_response.status_code == 200
    stable_features = set(stable_response.json()["enabled_features"])
    assert "foundation.env.stable-only" in stable_features
    assert "foundation.env.preview-only" not in stable_features

    monkeypatch.setattr(settings, "ENVIRONMENT", "preview")
    preview_response = await async_client.get(
        "/api/v1/feature-flags/my-features",
        headers=_bearer_token_for(feature_user),
    )

    assert preview_response.status_code == 200
    preview_features = set(preview_response.json()["enabled_features"])
    assert "foundation.env.preview-only" in preview_features
    assert "foundation.env.stable-only" not in preview_features


@pytest.mark.asyncio
async def test_supplier_workbench_returns_supplier_shape_and_safe_defaults(
    async_client: AsyncClient, db_session: AsyncSession
):
    supplier = await _create_supplier(
        db_session,
        name="Supplier Dashboard Co",
        code="SUP-400",
    )
    supplier_user = await _create_user(
        db_session,
        username="supplier_dashboard_user",
        user_type=UserType.SUPPLIER,
        supplier_id=supplier.id,
        full_name="Supplier Dashboard User",
        allowed_environments="stable,preview",
        digital_signature="/uploads/signatures/supplier_dashboard_user.png",
    )

    response = await async_client.get(
        "/api/v1/workbench/dashboard",
        headers=_bearer_token_for(supplier_user),
    )

    assert response.status_code == 200
    data = response.json()
    assert data["environment"] == settings.ENVIRONMENT
    assert data["user_info"]["supplier_name"] == "Supplier Dashboard Co"
    assert data["user_info"]["signature_image_path"] == "/uploads/signatures/supplier_dashboard_user.png"
    assert data["user_info"]["is_platform_admin"] is False
    assert [action["title"] for action in data["quick_actions"]] == ["个人中心"]
    assert data["todo_summary"] == {
        "total": 0,
        "overdue": 0,
        "due_soon": 0,
    }
    assert data["performance_status"] is None
    assert data["action_required_tasks"] == []
    assert set(data["feature_blocks"].keys()) == {"metrics", "announcements", "notifications"}


@pytest.mark.asyncio
async def test_admin_user_governance_pending_and_reject_contract(
    async_client: AsyncClient, db_session: AsyncSession
):
    admin_username = settings.PLATFORM_ADMIN_USERNAMES.split(",")[0].strip() or "admin"
    admin_user = await _create_user(
        db_session,
        username=admin_username,
        password="AdminGov123!",
        full_name="Governance Admin",
    )
    non_admin_user = await _create_user(
        db_session,
        username="governance_viewer",
        password="ViewerPass123!",
        full_name="Governance Viewer",
    )
    supplier = await _create_supplier(
        db_session,
        name="Pending Supplier Co",
        code="SUP-500",
    )
    pending_supplier_user = await _create_user(
        db_session,
        username="pending_supplier_user",
        password="PendingSup123!",
        user_type=UserType.SUPPLIER,
        supplier_id=supplier.id,
        status=UserStatus.PENDING,
        full_name="Pending Supplier User",
        allowed_environments="stable,preview",
        digital_signature="/uploads/signatures/pending_supplier_user.png",
    )

    forbidden_response = await async_client.get(
        "/api/v1/admin/users/pending",
        headers=_bearer_token_for(non_admin_user),
    )
    assert forbidden_response.status_code == 403

    pending_response = await async_client.get(
        "/api/v1/admin/users/pending",
        headers=_bearer_token_for(admin_user),
    )
    assert pending_response.status_code == 200
    pending_data = pending_response.json()
    pending_row = next(item for item in pending_data if item["username"] == "pending_supplier_user")
    assert pending_row["status"] == "pending"
    assert pending_row["supplier_name"] == "Pending Supplier Co"
    assert pending_row["signature_image_path"] == "/uploads/signatures/pending_supplier_user.png"
    assert pending_row["is_platform_admin"] is False

    reject_response = await async_client.post(
        f"/api/v1/admin/users/{pending_supplier_user.id}/reject",
        headers=_bearer_token_for(admin_user),
        json={"reason": "Missing compliance package"},
    )
    assert reject_response.status_code == 200
    reject_data = reject_response.json()
    assert reject_data["status"] == "rejected"
    assert "Missing compliance package" in reject_data["message"]

    await db_session.refresh(pending_supplier_user)
    assert pending_supplier_user.status == UserStatus.REJECTED


@pytest.mark.asyncio
async def test_admin_user_governance_freeze_unfreeze_and_reset_password(
    async_client: AsyncClient, db_session: AsyncSession
):
    admin_username = settings.PLATFORM_ADMIN_USERNAMES.split(",")[0].strip() or "admin"
    admin_user = await _create_user(
        db_session,
        username=admin_username,
        password="AdminOps123!",
        full_name="Ops Admin",
    )
    managed_user = await _create_user(
        db_session,
        username="managed_employee",
        password="ManagedPass123!",
        full_name="Managed Employee",
        allowed_environments="stable,preview",
    )
    managed_user.failed_login_attempts = 4
    managed_user.locked_until = datetime.utcnow() + timedelta(minutes=10)
    await db_session.commit()

    freeze_response = await async_client.post(
        f"/api/v1/admin/users/{managed_user.id}/freeze",
        headers=_bearer_token_for(admin_user),
        json={"reason": "Risk review"},
    )
    assert freeze_response.status_code == 200
    assert freeze_response.json()["status"] == "frozen"

    frozen_login = await async_client.post(
        "/api/v1/auth/login",
        json={
            "username": "managed_employee",
            "password": "ManagedPass123!",
            "user_type": "internal",
        },
    )
    assert frozen_login.status_code == 403

    unfreeze_response = await async_client.post(
        f"/api/v1/admin/users/{managed_user.id}/unfreeze",
        headers=_bearer_token_for(admin_user),
    )
    assert unfreeze_response.status_code == 200
    assert unfreeze_response.json()["status"] == "active"

    reset_response = await async_client.post(
        f"/api/v1/admin/users/{managed_user.id}/reset-password",
        headers=_bearer_token_for(admin_user),
    )
    assert reset_response.status_code == 200
    reset_data = reset_response.json()
    temporary_password = reset_data["temporary_password"]
    assert len(temporary_password) >= 12
    assert any(char.isupper() for char in temporary_password)
    assert any(char.islower() for char in temporary_password)
    assert any(char.isdigit() for char in temporary_password)
    assert any(char in "!@#$%^&*" for char in temporary_password)

    await db_session.refresh(managed_user)
    assert managed_user.status == UserStatus.ACTIVE
    assert managed_user.failed_login_attempts == 0
    assert managed_user.locked_until is None
    assert managed_user.password_changed_at is None
    assert LocalAuthStrategy().verify_password(temporary_password, managed_user.password_hash)

    old_password_login = await async_client.post(
        "/api/v1/auth/login",
        json={
            "username": "managed_employee",
            "password": "ManagedPass123!",
            "user_type": "internal",
        },
    )
    assert old_password_login.status_code == 401

    temp_password_login = await async_client.post(
        "/api/v1/auth/login",
        json={
            "username": "managed_employee",
            "password": temporary_password,
            "user_type": "internal",
            "environment": "preview",
        },
    )
    assert temp_password_login.status_code == 200
    temp_login_data = temp_password_login.json()
    assert temp_login_data["allowed_environments"] == ["stable", "preview"]
    assert temp_login_data["password_expired"] is True


@pytest.mark.asyncio
async def test_profile_contract_change_password_and_uploads(
    async_client: AsyncClient, db_session: AsyncSession, tmp_path, monkeypatch
):
    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path))

    supplier = await _create_supplier(
        db_session,
        name="Profile Supplier Co",
        code="SUP-600",
    )
    profile_user = await _create_user(
        db_session,
        username="profile_supplier_user",
        password="ProfilePass123!",
        user_type=UserType.SUPPLIER,
        supplier_id=supplier.id,
        full_name="Profile Supplier User",
        allowed_environments="stable,preview",
        avatar_image_path="/uploads/avatars/legacy_avatar.png",
        digital_signature="/uploads/signatures/legacy_signature.png",
    )

    profile_response = await async_client.get(
        "/api/v1/profile",
        headers=_bearer_token_for(profile_user),
    )
    assert profile_response.status_code == 200
    profile_data = profile_response.json()
    assert profile_data["supplier_name"] == "Profile Supplier Co"
    assert profile_data["signature_image_path"] == "/uploads/signatures/legacy_signature.png"
    assert profile_data["avatar_image_path"] == "/uploads/avatars/legacy_avatar.png"
    assert profile_data["is_platform_admin"] is False

    password_response = await async_client.put(
        "/api/v1/profile/password",
        headers=_bearer_token_for(profile_user),
        json={
            "old_password": "ProfilePass123!",
            "new_password": "ProfileNew456!",
        },
    )
    assert password_response.status_code == 200
    await db_session.refresh(profile_user)
    assert LocalAuthStrategy().verify_password("ProfileNew456!", profile_user.password_hash)
    assert profile_user.password_changed_at is not None

    avatar_response = await async_client.post(
        "/api/v1/profile/avatar",
        headers=_bearer_token_for(profile_user),
        files={"file": ("avatar.png", _png_bytes(color="lightblue", text="avatar"), "image/png")},
    )
    assert avatar_response.status_code == 200
    avatar_data = avatar_response.json()
    assert avatar_data["avatar_path"].startswith("/uploads/avatars/")
    assert avatar_data["avatar_path"].endswith(".png")
    assert (tmp_path / "avatars" / avatar_data["avatar_path"].split("/")[-1]).exists()

    signature_response = await async_client.post(
        "/api/v1/profile/signature",
        headers=_bearer_token_for(profile_user),
        files={"file": ("signature.png", _png_bytes(color="white", text="sign"), "image/png")},
    )
    assert signature_response.status_code == 200
    signature_data = signature_response.json()
    assert signature_data["signature_path"].startswith("/uploads/signatures/")
    assert signature_data["signature_path"].endswith(".png")
    assert (tmp_path / "signatures" / signature_data["signature_path"].split("/")[-1]).exists()

    refreshed_profile = await async_client.get(
        "/api/v1/profile",
        headers=_bearer_token_for(profile_user),
    )
    assert refreshed_profile.status_code == 200
    refreshed_data = refreshed_profile.json()
    assert refreshed_data["avatar_image_path"] == avatar_data["avatar_path"]
    assert refreshed_data["signature_image_path"] == signature_data["signature_path"]
    assert refreshed_data["digital_signature"] == signature_data["signature_path"]


@pytest.mark.asyncio
async def test_profile_uploads_reject_invalid_avatar_format(
    async_client: AsyncClient, db_session: AsyncSession, tmp_path, monkeypatch
):
    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path))

    profile_user = await _create_user(
        db_session,
        username="profile_avatar_guard",
        password="AvatarGuard123!",
        full_name="Avatar Guard",
    )

    response = await async_client.post(
        "/api/v1/profile/avatar",
        headers=_bearer_token_for(profile_user),
        files={"file": ("avatar.txt", BytesIO(b"not-an-image"), "text/plain")},
    )

    assert response.status_code == 400
