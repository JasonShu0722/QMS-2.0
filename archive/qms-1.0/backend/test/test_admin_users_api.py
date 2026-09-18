"""
用户管理 API 测试
测试管理员用户审核、用户清单治理、角色分配等操作
"""
from datetime import datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_strategy import LocalAuthStrategy
from app.models.role_tag import RoleTag
from app.models.supplier import Supplier, SupplierStatus
from app.models.user import User, UserStatus, UserType
from app.models.user_role_assignment import UserRoleAssignment

pytestmark = pytest.mark.foundation_smoke


@pytest.fixture
async def admin_user(db_session: AsyncSession) -> User:
    auth_strategy = LocalAuthStrategy()
    hashed_password = auth_strategy.hash_password("AdminPass123!")

    admin = User(
        username="admin",
        password_hash=hashed_password,
        full_name="管理员",
        email="admin@company.com",
        phone="13800138000",
        user_type=UserType.INTERNAL,
        status=UserStatus.ACTIVE,
        department="质量部",
        position="系统管理员",
        password_changed_at=datetime.utcnow(),
    )

    db_session.add(admin)
    await db_session.commit()
    await db_session.refresh(admin)

    return admin


@pytest.fixture
async def pending_user(db_session: AsyncSession) -> User:
    auth_strategy = LocalAuthStrategy()
    hashed_password = auth_strategy.hash_password("UserPass123!")

    user = User(
        username="pending_user",
        password_hash=hashed_password,
        full_name="张三",
        email="zhangsan@company.com",
        phone="13900139000",
        user_type=UserType.INTERNAL,
        status=UserStatus.PENDING,
        department="生产部",
        position="质量工程师",
    )

    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    return user


@pytest.fixture
async def active_user(db_session: AsyncSession) -> User:
    auth_strategy = LocalAuthStrategy()
    hashed_password = auth_strategy.hash_password("UserPass123!")

    user = User(
        username="active_user",
        password_hash=hashed_password,
        full_name="李四",
        email="lisi@company.com",
        phone="13800138001",
        user_type=UserType.INTERNAL,
        status=UserStatus.ACTIVE,
        department="质量部",
        position="质量工程师",
        allowed_environments="stable,preview",
        password_changed_at=datetime.utcnow(),
    )

    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    return user


@pytest.fixture
async def extra_active_user(db_session: AsyncSession) -> User:
    auth_strategy = LocalAuthStrategy()
    hashed_password = auth_strategy.hash_password("UserPass123!")

    user = User(
        username="another_user",
        password_hash=hashed_password,
        full_name="王五",
        email="wangwu@company.com",
        phone="13800138002",
        user_type=UserType.INTERNAL,
        status=UserStatus.ACTIVE,
        department="采购部",
        position="采购工程师",
        password_changed_at=datetime.utcnow(),
    )

    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    return user


@pytest.fixture
async def role_tag(db_session: AsyncSession) -> RoleTag:
    role = RoleTag(
        role_key="quality.process.engineer",
        role_name="制程质量工程师",
        applicable_user_type=UserType.INTERNAL,
        is_active=True,
    )
    db_session.add(role)
    await db_session.commit()
    await db_session.refresh(role)
    return role


@pytest.fixture
async def active_supplier(db_session: AsyncSession) -> Supplier:
    supplier = Supplier(
        name="Northwind Components",
        code="SUP001",
        status=SupplierStatus.ACTIVE,
        contact_person="Tom",
        contact_email="supplier@example.com",
    )
    db_session.add(supplier)
    await db_session.commit()
    await db_session.refresh(supplier)
    return supplier


@pytest.fixture
async def numeric_code_supplier(db_session: AsyncSession) -> Supplier:
    supplier = Supplier(
        name="Numeric Code Supplier",
        code="101669",
        status=SupplierStatus.ACTIVE,
        contact_person="Numeric Contact",
        contact_email="numeric@supplier.com",
    )
    db_session.add(supplier)
    await db_session.commit()
    await db_session.refresh(supplier)
    return supplier


@pytest.fixture
async def duplicate_named_suppliers(db_session: AsyncSession) -> tuple[Supplier, Supplier]:
    first_supplier = Supplier(
        name="Shared Supplier",
        code="SUP-DUP-001",
        status=SupplierStatus.ACTIVE,
        contact_person="Alice",
        contact_email="alice@supplier.com",
    )
    second_supplier = Supplier(
        name="Shared Supplier",
        code="SUP-DUP-002",
        status=SupplierStatus.ACTIVE,
        contact_person="Bob",
        contact_email="bob@supplier.com",
    )
    db_session.add_all([first_supplier, second_supplier])
    await db_session.commit()
    await db_session.refresh(first_supplier)
    await db_session.refresh(second_supplier)
    return first_supplier, second_supplier


@pytest.fixture
async def admin_token(async_client: AsyncClient, admin_user: User) -> str:
    response = await async_client.post(
        "/api/v1/auth/login",
        json={
            "username": "admin",
            "password": "AdminPass123!",
            "user_type": "internal",
        },
    )
    assert response.status_code == 200
    return response.json()["access_token"]


class TestGetPendingUsers:
    @pytest.mark.asyncio
    async def test_get_pending_users_success(
        self,
        async_client: AsyncClient,
        admin_token: str,
        pending_user: User,
    ):
        response = await async_client.get(
            "/api/v1/admin/users/pending",
            headers={"Authorization": f"Bearer {admin_token}"},
        )

        assert response.status_code == 200
        data = response.json()
        pending_users = [u for u in data if u["username"] == "pending_user"]
        assert len(pending_users) == 1
        assert pending_users[0]["status"] == "pending"

    @pytest.mark.asyncio
    async def test_get_pending_users_unauthorized(
        self,
        async_client: AsyncClient,
    ):
        response = await async_client.get("/api/v1/admin/users/pending")
        assert response.status_code == 401


class TestUserListManagement:
    @pytest.mark.asyncio
    async def test_get_users_supports_filters(
        self,
        async_client: AsyncClient,
        admin_token: str,
        active_user: User,
        extra_active_user: User,
        pending_user: User,
        role_tag: RoleTag,
        db_session: AsyncSession,
    ):
        db_session.add(
            UserRoleAssignment(
                user_id=active_user.id,
                role_tag_id=role_tag.id,
            )
        )
        await db_session.commit()

        response = await async_client.get(
            "/api/v1/admin/users",
            headers={"Authorization": f"Bearer {admin_token}"},
            params={"department": "质量", "position": "工程师", "role_tag_id": role_tag.id},
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["username"] == "active_user"
        assert data[0]["role_tags"][0]["role_key"] == "quality.process.engineer"
        assert all(user["status"] != "pending" for user in data)

    @pytest.mark.asyncio
    async def test_create_user_success_assigns_roles(
        self,
        async_client: AsyncClient,
        admin_token: str,
        role_tag: RoleTag,
        db_session: AsyncSession,
    ):
        response = await async_client.post(
            "/api/v1/admin/users",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "username": "created_user",
                "full_name": "赵六",
                "email": "zhaoliu@company.com",
                "phone": "13600136000",
                "user_type": "internal",
                "department": "质量管理部",
                "position": "体系工程师",
                "allowed_environments": "stable,preview",
                "role_tag_ids": [role_tag.id],
            },
        )

        assert response.status_code == 201
        data = response.json()
        assert data["user"]["username"] == "created_user"
        assert data["user"]["status"] == "active"
        assert len(data["temporary_password"]) >= 12
        assert len(data["user"]["role_tags"]) == 1

        created_user = (
            await db_session.execute(select(User).where(User.username == "created_user"))
        ).scalar_one()
        assert created_user.department == "质量管理部"
        assert created_user.password_changed_at is None

    @pytest.mark.asyncio
    async def test_create_supplier_user_resolves_supplier_identifier(
        self,
        async_client: AsyncClient,
        admin_token: str,
        active_supplier: Supplier,
        db_session: AsyncSession,
    ):
        response = await async_client.post(
            "/api/v1/admin/users",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "username": "supplier_admin",
                "full_name": "供应商管理员",
                "email": "supplier-admin@example.com",
                "user_type": "supplier",
                "supplier_identifier": active_supplier.code,
                "position": "质量接口人",
                "allowed_environments": "stable",
                "role_tag_ids": [],
            },
        )

        assert response.status_code == 201
        data = response.json()
        assert data["user"]["user_type"] == "supplier"
        assert data["user"]["supplier_id"] == active_supplier.id
        assert data["user"]["supplier_name"] == active_supplier.name

    @pytest.mark.asyncio
    async def test_create_supplier_user_prefers_numeric_supplier_code_over_id(
        self,
        async_client: AsyncClient,
        admin_token: str,
        numeric_code_supplier: Supplier,
    ):
        response = await async_client.post(
            "/api/v1/admin/users",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "username": "supplier_numeric_code",
                "full_name": "数字代码供应商",
                "email": "supplier-numeric@example.com",
                "user_type": "supplier",
                "supplier_identifier": numeric_code_supplier.code,
                "position": "质量接口人",
                "allowed_environments": "stable",
                "role_tag_ids": [],
            },
        )

        assert response.status_code == 201
        data = response.json()
        assert data["user"]["supplier_id"] == numeric_code_supplier.id
        assert data["user"]["supplier_name"] == numeric_code_supplier.name

    @pytest.mark.asyncio
    async def test_bulk_create_users_success(
        self,
        async_client: AsyncClient,
        admin_token: str,
        role_tag: RoleTag,
        db_session: AsyncSession,
    ):
        response = await async_client.post(
            "/api/v1/admin/users/bulk",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "user_type": "internal",
                "allowed_environments": "stable",
                "role_tag_ids": [role_tag.id],
                "items": [
                    {
                        "username": "batch_user_01",
                        "full_name": "批量用户一",
                        "email": "batch01@company.com",
                        "phone": "13500135001",
                        "department": "质量管理部",
                        "position": "质量工程师",
                    },
                    {
                        "username": "batch_user_02",
                        "full_name": "批量用户二",
                        "email": "batch02@company.com",
                        "phone": "13500135002",
                        "department": "采购部",
                        "position": "采购工程师",
                    },
                ],
            },
        )

        assert response.status_code == 201
        data = response.json()
        assert data["created_count"] == 2
        assert len(data["results"]) == 2
        assert all(len(item["temporary_password"]) >= 12 for item in data["results"])

        created_users = (
            await db_session.execute(
                select(User).where(User.username.in_(["batch_user_01", "batch_user_02"]))
            )
        ).scalars().all()
        assert len(created_users) == 2

    @pytest.mark.asyncio
    async def test_bulk_create_supplier_users_resolves_supplier_identifier(
        self,
        async_client: AsyncClient,
        admin_token: str,
        active_supplier: Supplier,
        db_session: AsyncSession,
    ):
        response = await async_client.post(
            "/api/v1/admin/users/bulk",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "user_type": "supplier",
                "allowed_environments": "stable",
                "role_tag_ids": [],
                "items": [
                    {
                        "username": "supplier_batch_code",
                        "full_name": "供应商批量代码",
                        "email": "supplier-batch-code@example.com",
                        "phone": "13600136001",
                        "supplier_identifier": active_supplier.code,
                        "position": "质量接口人",
                    },
                    {
                        "username": "supplier_batch_name",
                        "full_name": "供应商批量名称",
                        "email": "supplier-batch-name@example.com",
                        "phone": "13600136002",
                        "supplier_identifier": active_supplier.name,
                        "position": "售后工程师",
                    },
                ],
            },
        )

        assert response.status_code == 201
        data = response.json()
        assert data["created_count"] == 2
        assert all(item["user"]["supplier_id"] == active_supplier.id for item in data["results"])

        created_users = (
            await db_session.execute(
                select(User).where(
                    User.username.in_(["supplier_batch_code", "supplier_batch_name"])
                )
            )
        ).scalars().all()
        assert len(created_users) == 2
        assert all(user.supplier_id == active_supplier.id for user in created_users)

    @pytest.mark.asyncio
    async def test_bulk_create_supplier_users_prefers_numeric_supplier_code_over_id(
        self,
        async_client: AsyncClient,
        admin_token: str,
        numeric_code_supplier: Supplier,
        db_session: AsyncSession,
    ):
        response = await async_client.post(
            "/api/v1/admin/users/bulk",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "user_type": "supplier",
                "allowed_environments": "stable",
                "role_tag_ids": [],
                "items": [
                    {
                        "username": "supplier_batch_numeric",
                        "full_name": "供应商批量数字代码",
                        "email": "supplier-batch-numeric@example.com",
                        "phone": "13600136009",
                        "supplier_identifier": numeric_code_supplier.code,
                        "position": "总经理",
                    }
                ],
            },
        )

        assert response.status_code == 201
        data = response.json()
        assert data["created_count"] == 1
        assert data["results"][0]["user"]["supplier_id"] == numeric_code_supplier.id

        created_user = (
            await db_session.execute(select(User).where(User.username == "supplier_batch_numeric"))
        ).scalar_one()
        assert created_user.supplier_id == numeric_code_supplier.id

    @pytest.mark.asyncio
    async def test_bulk_create_supplier_users_requires_unique_supplier_name(
        self,
        async_client: AsyncClient,
        admin_token: str,
        duplicate_named_suppliers: tuple[Supplier, Supplier],
    ):
        response = await async_client.post(
            "/api/v1/admin/users/bulk",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "user_type": "supplier",
                "allowed_environments": "stable",
                "role_tag_ids": [],
                "items": [
                    {
                        "username": "supplier_batch_duplicate",
                        "full_name": "供应商重名",
                        "email": "supplier-batch-duplicate@example.com",
                        "phone": "13600136003",
                        "supplier_identifier": "Shared Supplier",
                        "position": "质量接口人",
                    }
                ],
            },
        )

        assert response.status_code == 400
        assert "请改用唯一的供应商代码" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_update_user_basic_info_success(
        self,
        async_client: AsyncClient,
        admin_token: str,
        active_user: User,
        db_session: AsyncSession,
    ):
        response = await async_client.patch(
            f"/api/v1/admin/users/{active_user.id}",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "full_name": "李四-更新",
                "email": "lisi-updated@company.com",
                "phone": "13700137000",
                "department": "质量管理部",
                "position": "高级质量工程师",
                "allowed_environments": "stable",
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["full_name"] == "李四-更新"
        assert data["department"] == "质量管理部"
        assert data["allowed_environments"] == "stable"

        await db_session.refresh(active_user)
        assert active_user.email == "lisi-updated@company.com"

    @pytest.mark.asyncio
    async def test_assign_user_roles_success(
        self,
        async_client: AsyncClient,
        admin_token: str,
        active_user: User,
        role_tag: RoleTag,
        db_session: AsyncSession,
    ):
        response = await async_client.put(
            f"/api/v1/admin/users/{active_user.id}/roles",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"role_tag_ids": [role_tag.id]},
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data["role_tags"]) == 1
        assert data["role_tags"][0]["role_key"] == "quality.process.engineer"

        assignments = (
            await db_session.execute(
                select(UserRoleAssignment).where(UserRoleAssignment.user_id == active_user.id)
            )
        ).scalars().all()
        assert len(assignments) == 1

    @pytest.mark.asyncio
    async def test_assign_user_roles_rejects_incompatible_user_type(
        self,
        async_client: AsyncClient,
        admin_token: str,
        active_user: User,
        db_session: AsyncSession,
    ):
        supplier_role = RoleTag(
            role_key="supplier.external",
            role_name="供应商账号",
            applicable_user_type=UserType.SUPPLIER,
            is_active=True,
        )
        db_session.add(supplier_role)
        await db_session.commit()
        await db_session.refresh(supplier_role)

        response = await async_client.put(
            f"/api/v1/admin/users/{active_user.id}/roles",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"role_tag_ids": [supplier_role.id]},
        )

        assert response.status_code == 400
        assert "不适用于当前用户类型" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_delete_user_success(
        self,
        async_client: AsyncClient,
        admin_token: str,
        extra_active_user: User,
        db_session: AsyncSession,
    ):
        response = await async_client.delete(
            f"/api/v1/admin/users/{extra_active_user.id}",
            headers={"Authorization": f"Bearer {admin_token}"},
        )

        assert response.status_code == 200
        assert response.json()["status"] == "deleted"

        deleted = await db_session.get(User, extra_active_user.id)
        assert deleted is None


class TestApproveUser:
    @pytest.mark.asyncio
    async def test_approve_user_success(
        self,
        async_client: AsyncClient,
        admin_token: str,
        pending_user: User,
        db_session: AsyncSession,
    ):
        response = await async_client.post(
            f"/api/v1/admin/users/{pending_user.id}/approve",
            headers={"Authorization": f"Bearer {admin_token}"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["message"] == "用户已批准"
        assert data["status"] == "active"

        await db_session.refresh(pending_user)
        assert pending_user.status == UserStatus.ACTIVE

    @pytest.mark.asyncio
    async def test_approve_user_not_found(
        self,
        async_client: AsyncClient,
        admin_token: str,
    ):
        response = await async_client.post(
            "/api/v1/admin/users/99999/approve",
            headers={"Authorization": f"Bearer {admin_token}"},
        )

        assert response.status_code == 404
        assert "用户不存在" in response.json()["detail"]


class TestRejectUser:
    @pytest.mark.asyncio
    async def test_reject_user_success(
        self,
        async_client: AsyncClient,
        admin_token: str,
        pending_user: User,
        db_session: AsyncSession,
    ):
        response = await async_client.post(
            f"/api/v1/admin/users/{pending_user.id}/reject",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"reason": "资料不完整"},
        )

        assert response.status_code == 200
        assert response.json()["status"] == "rejected"

        await db_session.refresh(pending_user)
        assert pending_user.status == UserStatus.REJECTED

    @pytest.mark.asyncio
    async def test_reject_user_without_reason(
        self,
        async_client: AsyncClient,
        admin_token: str,
        pending_user: User,
    ):
        response = await async_client.post(
            f"/api/v1/admin/users/{pending_user.id}/reject",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"reason": ""},
        )

        assert response.status_code == 400
        assert "必须填写拒绝原因" in response.json()["detail"]


class TestFreezeUser:
    @pytest.mark.asyncio
    async def test_freeze_user_success(
        self,
        async_client: AsyncClient,
        admin_token: str,
        active_user: User,
        db_session: AsyncSession,
    ):
        response = await async_client.post(
            f"/api/v1/admin/users/{active_user.id}/freeze",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"reason": "供应商合作暂停"},
        )

        assert response.status_code == 200
        assert response.json()["status"] == "frozen"

        await db_session.refresh(active_user)
        assert active_user.status == UserStatus.FROZEN

    @pytest.mark.asyncio
    async def test_freeze_current_login_user_rejected(
        self,
        async_client: AsyncClient,
        admin_token: str,
        admin_user: User,
    ):
        response = await async_client.post(
            f"/api/v1/admin/users/{admin_user.id}/freeze",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"reason": "误操作保护"},
        )

        assert response.status_code == 400
        assert "不能冻结当前登录账号" in response.json()["detail"]


class TestUnfreezeUser:
    @pytest.mark.asyncio
    async def test_unfreeze_user_success(
        self,
        async_client: AsyncClient,
        admin_token: str,
        active_user: User,
        db_session: AsyncSession,
    ):
        active_user.status = UserStatus.FROZEN
        await db_session.commit()

        response = await async_client.post(
            f"/api/v1/admin/users/{active_user.id}/unfreeze",
            headers={"Authorization": f"Bearer {admin_token}"},
        )

        assert response.status_code == 200
        assert response.json()["status"] == "active"

        await db_session.refresh(active_user)
        assert active_user.status == UserStatus.ACTIVE


class TestResetPassword:
    @pytest.mark.asyncio
    async def test_reset_password_success(
        self,
        async_client: AsyncClient,
        admin_token: str,
        active_user: User,
        db_session: AsyncSession,
    ):
        response = await async_client.post(
            f"/api/v1/admin/users/{active_user.id}/reset-password",
            headers={"Authorization": f"Bearer {admin_token}"},
        )

        assert response.status_code == 200
        data = response.json()
        assert "temporary_password" in data
        assert len(data["temporary_password"]) >= 12

        await db_session.refresh(active_user)
        assert active_user.password_changed_at is None
        assert active_user.failed_login_attempts == 0
        assert active_user.locked_until is None
