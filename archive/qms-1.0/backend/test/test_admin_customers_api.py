"""
客户基础信息 API 测试
覆盖列表、创建、批量导入、编辑与状态切换。
"""
from __future__ import annotations

from datetime import datetime

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_strategy import LocalAuthStrategy
from app.models.customer_master import CustomerMaster, CustomerStatus
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
async def existing_customer(db_session: AsyncSession) -> CustomerMaster:
    customer = CustomerMaster(
        code="CUST001",
        name="BYD Auto",
        status=CustomerStatus.ACTIVE,
        contact_person="Tom",
        contact_email="tom@example.com",
        contact_phone="13800000001",
    )
    db_session.add(customer)
    await db_session.commit()
    await db_session.refresh(customer)
    return customer


@pytest.mark.asyncio
async def test_get_customers_supports_keyword_and_status_filter(
    async_client: AsyncClient,
    admin_token: str,
    existing_customer: CustomerMaster,
):
    response = await async_client.get(
        "/api/v1/admin/customers",
        headers={"Authorization": f"Bearer {admin_token}"},
        params={"keyword": "CUST001", "status": "active"},
    )

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["code"] == "CUST001"
    assert data[0]["name"] == "BYD Auto"


@pytest.mark.asyncio
async def test_create_customer_success(
    async_client: AsyncClient,
    admin_token: str,
):
    response = await async_client.post(
        "/api/v1/admin/customers",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "code": "CUST002",
            "name": "Changan Auto",
            "contact_person": "Alice",
            "contact_email": "alice@example.com",
            "contact_phone": "13800000002",
            "status": "active",
        },
    )

    assert response.status_code == 201
    data = response.json()
    assert data["code"] == "CUST002"
    assert data["name"] == "Changan Auto"
    assert data["status"] == "active"


@pytest.mark.asyncio
async def test_bulk_create_customers_success(
    async_client: AsyncClient,
    admin_token: str,
):
    response = await async_client.post(
        "/api/v1/admin/customers/bulk",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "status": "active",
            "items": [
                {
                    "code": "CUST010",
                    "name": "GAC Motor",
                    "contact_person": "Amy",
                    "contact_email": "amy@example.com",
                    "contact_phone": "13800000010",
                },
                {
                    "code": "CUST011",
                    "name": "Geely Auto",
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
    assert {item["code"] for item in data["customers"]} == {"CUST010", "CUST011"}


@pytest.mark.asyncio
async def test_update_customer_success(
    async_client: AsyncClient,
    admin_token: str,
    existing_customer: CustomerMaster,
):
    response = await async_client.patch(
        f"/api/v1/admin/customers/{existing_customer.id}",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "code": "CUST001",
            "name": "BYD Auto Updated",
            "contact_person": "Jerry",
            "contact_email": "jerry@example.com",
            "contact_phone": "13800000003",
            "status": "active",
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "BYD Auto Updated"
    assert data["contact_person"] == "Jerry"


@pytest.mark.asyncio
async def test_update_customer_status_success(
    async_client: AsyncClient,
    admin_token: str,
    existing_customer: CustomerMaster,
):
    response = await async_client.post(
        f"/api/v1/admin/customers/{existing_customer.id}/status",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"status": "suspended"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "suspended"
