"""
登录功能测试
覆盖统一登录、验证码以及供应商主数据联动校验。
"""
from __future__ import annotations

from datetime import datetime

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_strategy import LocalAuthStrategy
from app.models.supplier import Supplier, SupplierStatus
from app.models.user import User, UserStatus, UserType
from app.services.captcha_service import captcha_service

pytestmark = pytest.mark.foundation_smoke


@pytest.mark.asyncio
async def test_internal_user_login_success(async_client: AsyncClient, db_session: AsyncSession):
    local_auth = LocalAuthStrategy()
    test_user = User(
        username="test_internal",
        password_hash=local_auth.hash_password("TestPass123!"),
        full_name="测试员工",
        email="test_internal@ics-energy.com",
        user_type=UserType.INTERNAL,
        status=UserStatus.ACTIVE,
        department="质量管理部",
        password_changed_at=datetime.utcnow(),
    )

    db_session.add(test_user)
    await db_session.commit()
    await db_session.refresh(test_user)

    response = await async_client.post(
        "/api/v1/auth/login",
        json={
            "username": "test_internal",
            "password": "TestPass123!",
            "user_type": "internal",
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert data["password_expired"] is False
    assert data["user_info"]["username"] == "test_internal"
    assert data["user_info"]["user_type"] == "internal"

    await db_session.refresh(test_user)
    assert test_user.last_login_at is not None


@pytest.mark.asyncio
async def test_password_expired_login_still_updates_last_login(
    async_client: AsyncClient,
    db_session: AsyncSession,
):
    local_auth = LocalAuthStrategy()
    expiring_user = User(
        username="temp_password_user",
        password_hash=local_auth.hash_password("TestPass123!"),
        full_name="临时密码用户",
        email="temp-password@ics-energy.com",
        user_type=UserType.INTERNAL,
        status=UserStatus.ACTIVE,
        department="质量管理部",
        password_changed_at=None,
    )

    db_session.add(expiring_user)
    await db_session.commit()
    await db_session.refresh(expiring_user)

    response = await async_client.post(
        "/api/v1/auth/login",
        json={
            "username": "temp_password_user",
            "password": "TestPass123!",
            "user_type": "internal",
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["password_expired"] is True

    await db_session.refresh(expiring_user)
    assert expiring_user.last_login_at is not None


@pytest.mark.asyncio
async def test_login_invalid_credentials(async_client: AsyncClient, db_session: AsyncSession):
    local_auth = LocalAuthStrategy()
    test_user = User(
        username="test_user_fail",
        password_hash=local_auth.hash_password("TestPass123!"),
        full_name="测试用户",
        email="testfail@ics-energy.com",
        user_type=UserType.INTERNAL,
        status=UserStatus.ACTIVE,
        department="质量管理部",
        password_changed_at=datetime.utcnow(),
    )

    db_session.add(test_user)
    await db_session.commit()

    response = await async_client.post(
        "/api/v1/auth/login",
        json={
            "username": "test_user_fail",
            "password": "WrongPassword123!",
            "user_type": "internal",
        },
    )

    assert response.status_code == 401
    assert "用户名或密码错误" in response.json()["detail"]


@pytest.mark.asyncio
async def test_login_pending_user(async_client: AsyncClient, db_session: AsyncSession):
    local_auth = LocalAuthStrategy()
    pending_user = User(
        username="test_pending",
        password_hash=local_auth.hash_password("TestPass123!"),
        full_name="待审核用户",
        email="pending@ics-energy.com",
        user_type=UserType.INTERNAL,
        status=UserStatus.PENDING,
        department="质量管理部",
    )

    db_session.add(pending_user)
    await db_session.commit()

    response = await async_client.post(
        "/api/v1/auth/login",
        json={
            "username": "test_pending",
            "password": "TestPass123!",
            "user_type": "internal",
        },
    )

    assert response.status_code == 403
    assert "待审核" in response.json()["detail"]


@pytest.mark.asyncio
async def test_get_captcha(async_client: AsyncClient):
    response = await async_client.get("/api/v1/auth/captcha")

    assert response.status_code == 200
    data = response.json()
    assert "captcha_id" in data
    assert "captcha_image" in data
    assert data["captcha_image"].startswith("data:image/png;base64,")


@pytest.mark.asyncio
async def test_supplier_login_without_captcha(async_client: AsyncClient, db_session: AsyncSession):
    local_auth = LocalAuthStrategy()
    supplier = Supplier(
        code="SUP001",
        name="测试供应商",
        status=SupplierStatus.ACTIVE,
    )
    db_session.add(supplier)
    await db_session.flush()

    test_user = User(
        username="test_supplier",
        password_hash=local_auth.hash_password("TestPass123!"),
        full_name="供应商用户",
        email="supplier@test.com",
        user_type=UserType.SUPPLIER,
        status=UserStatus.ACTIVE,
        supplier_id=supplier.id,
        password_changed_at=datetime.utcnow(),
    )
    db_session.add(test_user)
    await db_session.commit()

    response = await async_client.post(
        "/api/v1/auth/login",
        json={
            "username": "test_supplier",
            "password": "TestPass123!",
            "user_type": "supplier",
        },
    )

    assert response.status_code == 400
    assert "验证码" in response.json()["detail"]


@pytest.mark.asyncio
async def test_supplier_login_rejected_when_supplier_is_suspended(
    async_client: AsyncClient,
    db_session: AsyncSession,
):
    local_auth = LocalAuthStrategy()
    supplier = Supplier(
        code="SUP002",
        name="暂停合作供应商",
        status=SupplierStatus.SUSPENDED,
    )
    db_session.add(supplier)
    await db_session.flush()

    supplier_user = User(
        username="suspended_supplier_user",
        password_hash=local_auth.hash_password("TestPass123!"),
        full_name="暂停供应商账号",
        email="suspended-supplier@example.com",
        user_type=UserType.SUPPLIER,
        status=UserStatus.ACTIVE,
        supplier_id=supplier.id,
        password_changed_at=datetime.utcnow(),
    )
    db_session.add(supplier_user)
    await db_session.commit()

    captcha_id, _ = captcha_service.generate_captcha()
    captcha_text = captcha_service._captcha_store[captcha_id]["text"]

    response = await async_client.post(
        "/api/v1/auth/login",
        json={
            "username": "suspended_supplier_user",
            "password": "TestPass123!",
            "user_type": "supplier",
            "captcha_id": captcha_id,
            "captcha": captcha_text,
        },
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "账号当前不可用，请联系管理员"


@pytest.mark.asyncio
async def test_get_current_user_info(async_client: AsyncClient, db_session: AsyncSession):
    local_auth = LocalAuthStrategy()
    test_user = User(
        username="test_me",
        password_hash=local_auth.hash_password("TestPass123!"),
        full_name="测试用户",
        email="testme@ics-energy.com",
        user_type=UserType.INTERNAL,
        status=UserStatus.ACTIVE,
        department="质量管理部",
        position="工程师",
        password_changed_at=datetime.utcnow(),
    )

    db_session.add(test_user)
    await db_session.commit()
    await db_session.refresh(test_user)

    login_response = await async_client.post(
        "/api/v1/auth/login",
        json={
            "username": "test_me",
            "password": "TestPass123!",
            "user_type": "internal",
        },
    )
    assert login_response.status_code == 200
    token = login_response.json()["access_token"]

    response = await async_client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["username"] == "test_me"
    assert data["full_name"] == "测试用户"
    assert data["email"] == "testme@ics-energy.com"
    assert data["department"] == "质量管理部"
    assert data["position"] == "工程师"


@pytest.mark.asyncio
async def test_get_current_user_info_without_token(async_client: AsyncClient):
    response = await async_client.get("/api/v1/auth/me")
    assert response.status_code == 401
