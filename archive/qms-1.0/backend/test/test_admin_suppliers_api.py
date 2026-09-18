"""
供应商基础信息 API 测试
覆盖列表、创建、批量导入、编辑与状态切换。
"""
from __future__ import annotations

from datetime import datetime

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_strategy import LocalAuthStrategy
from app.models.supplier import Supplier, SupplierStatus
from app.models.user import User, UserStatus, UserType

pytestmark = pytest.mark.foundation_smoke


@pytest.fixture
async def admin_user(db_session: AsyncSession) -> User:
    local_auth = LocalAuthStrategy()
    admin = User(
        username="admin",
        password_hash=local_auth.hash_password("AdminPass123!"),
        full_name="系统管理员",
        email="admin@ics-energy.com",
        user_type=UserType.INTERNAL,
        status=UserStatus.ACTIVE,
        department="信息技术部",
        position="系统管理员",
        password_changed_at=datetime.utcnow(),
    )
    db_session.add(admin)
    await db_session.commit()
    await db_session.refresh(admin)
    return admin


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


@pytest.fixture
async def existing_supplier(db_session: AsyncSession) -> Supplier:
    supplier = Supplier(
        code="SUP001",
        name="Northwind Components",
        status=SupplierStatus.ACTIVE,
        contact_person="Tom",
        contact_email="tom@example.com",
        contact_phone="13800000001",
    )
    db_session.add(supplier)
    await db_session.commit()
    await db_session.refresh(supplier)
    return supplier


@pytest.mark.asyncio
async def test_get_suppliers_supports_keyword_and_status_filter(
    async_client: AsyncClient,
    admin_token: str,
    existing_supplier: Supplier,
    db_session: AsyncSession,
):
    linked_user = User(
        username="supplier_linked_user",
        password_hash=LocalAuthStrategy().hash_password("SupplierPass123!"),
        full_name="供应商账号",
        email="supplier-linked@example.com",
        user_type=UserType.SUPPLIER,
        status=UserStatus.ACTIVE,
        supplier_id=existing_supplier.id,
        password_changed_at=datetime.utcnow(),
    )
    db_session.add(linked_user)
    await db_session.commit()

    response = await async_client.get(
        "/api/v1/admin/suppliers",
        headers={"Authorization": f"Bearer {admin_token}"},
        params={"keyword": "SUP001", "status": "active"},
    )

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["code"] == "SUP001"
    assert data[0]["linked_user_count"] == 1
    assert data[0]["active_user_count"] == 1


@pytest.mark.asyncio
async def test_create_supplier_success(
    async_client: AsyncClient,
    admin_token: str,
):
    response = await async_client.post(
        "/api/v1/admin/suppliers",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "code": "SUP002",
            "name": "Blue Sky Metals",
            "contact_person": "Alice",
            "contact_email": "alice@example.com",
            "contact_phone": "13800000002",
            "status": "active",
        },
    )

    assert response.status_code == 201
    data = response.json()
    assert data["code"] == "SUP002"
    assert data["name"] == "Blue Sky Metals"
    assert data["status"] == "active"
    assert data["linked_user_count"] == 0


@pytest.mark.asyncio
async def test_bulk_create_suppliers_success(
    async_client: AsyncClient,
    admin_token: str,
):
    response = await async_client.post(
        "/api/v1/admin/suppliers/bulk",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "status": "active",
            "items": [
                {
                    "code": "SUP010",
                    "name": "Alpha Precision",
                    "contact_person": "Amy",
                    "contact_email": "amy@example.com",
                    "contact_phone": "13800000010",
                },
                {
                    "code": "SUP011",
                    "name": "Beta Plastics",
                    "contact_person": "Ben",
                    "contact_email": "ben@example.com",
                    "contact_phone": "13800000011",
                },
            ],
        },
    )

    assert response.status_code == 201
    data = response.json()
    assert data["total_count"] == 2
    assert data["created_count"] == 2
    assert {item["code"] for item in data["suppliers"]} == {"SUP010", "SUP011"}


@pytest.mark.asyncio
async def test_update_supplier_success(
    async_client: AsyncClient,
    admin_token: str,
    existing_supplier: Supplier,
):
    response = await async_client.patch(
        f"/api/v1/admin/suppliers/{existing_supplier.id}",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "code": "SUP001",
            "name": "Northwind Components Updated",
            "contact_person": "Jerry",
            "contact_email": "jerry@example.com",
            "contact_phone": "13800000003",
            "status": "active",
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Northwind Components Updated"
    assert data["contact_person"] == "Jerry"


@pytest.mark.asyncio
async def test_update_supplier_status_success(
    async_client: AsyncClient,
    admin_token: str,
    existing_supplier: Supplier,
):
    response = await async_client.post(
        f"/api/v1/admin/suppliers/{existing_supplier.id}/status",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"status": "suspended"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "suspended"
