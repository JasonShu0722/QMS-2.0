"""
用户注册接口测试
覆盖内部员工注册、邮箱策略以及供应商公共注册收口。
"""
from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User

pytestmark = pytest.mark.foundation_smoke


GENERIC_REGISTRATION_VALIDATION_ERROR = "注册信息校验未通过，请检查后重试"


@pytest.mark.asyncio
async def test_register_internal_user_success(
    async_client: AsyncClient,
    db_session: AsyncSession,
):
    response = await async_client.post(
        "/api/v1/auth/register",
        json={
            "username": "zhang_san",
            "password": "SecurePass123!",
            "full_name": "张三",
            "email": "zhangsan@ics-energy.com",
            "phone": "13800138000",
            "user_type": "internal",
            "department": "质量管理部",
            "position": "体系工程师",
        },
    )

    assert response.status_code == 201
    data = response.json()
    assert data["message"] == "注册成功，请等待管理员审核"
    assert data["username"] == "zhang_san"
    assert data["status"] == "pending"


@pytest.mark.asyncio
async def test_register_rejects_duplicate_username(
    async_client: AsyncClient,
    db_session: AsyncSession,
):
    payload = {
        "username": "duplicate_user",
        "password": "SecurePass123!",
        "full_name": "测试用户",
        "email": "duplicate@ics-energy.com",
        "user_type": "internal",
        "department": "质量管理部",
    }

    first_response = await async_client.post("/api/v1/auth/register", json=payload)
    assert first_response.status_code == 201

    second_response = await async_client.post("/api/v1/auth/register", json=payload)
    assert second_response.status_code == 400
    assert "用户名已存在" in second_response.json()["detail"]


@pytest.mark.asyncio
async def test_register_rejects_weak_password(
    async_client: AsyncClient,
    db_session: AsyncSession,
):
    response = await async_client.post(
        "/api/v1/auth/register",
        json={
            "username": "weak_user",
            "password": "weak123",
            "full_name": "测试用户",
            "email": "weak@ics-energy.com",
            "user_type": "internal",
            "department": "质量管理部",
        },
    )

    assert response.status_code == 422
    details = response.json()["detail"]
    assert any(item["loc"][-1] == "password" for item in details)


@pytest.mark.asyncio
async def test_register_requires_department_for_internal_user(
    async_client: AsyncClient,
    db_session: AsyncSession,
):
    response = await async_client.post(
        "/api/v1/auth/register",
        json={
            "username": "no_department_user",
            "password": "SecurePass123!",
            "full_name": "测试用户",
            "email": "nodept@ics-energy.com",
            "user_type": "internal",
        },
    )

    assert response.status_code == 400
    assert "部门" in response.json()["detail"]


@pytest.mark.asyncio
async def test_register_rejects_invalid_internal_email_domain(
    async_client: AsyncClient,
    db_session: AsyncSession,
):
    response = await async_client.post(
        "/api/v1/auth/register",
        json={
            "username": "external_mail_user",
            "password": "SecurePass123!",
            "full_name": "测试用户",
            "email": "external@example.com",
            "user_type": "internal",
            "department": "质量管理部",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == GENERIC_REGISTRATION_VALIDATION_ERROR


@pytest.mark.asyncio
async def test_register_blocks_supplier_self_registration(
    async_client: AsyncClient,
    db_session: AsyncSession,
):
    response = await async_client.post(
        "/api/v1/auth/register",
        json={
            "username": "supplier_user",
            "password": "SupplierPass123!",
            "full_name": "供应商用户",
            "email": "supplier@example.com",
            "user_type": "supplier",
            "supplier_id": 1,
            "position": "质量经理",
        },
    )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_public_supplier_search_endpoint_removed(
    async_client: AsyncClient,
):
    response = await async_client.get("/api/v1/auth/suppliers/search", params={"q": "SUP001"})
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_register_normalizes_email_to_lowercase(
    async_client: AsyncClient,
    db_session: AsyncSession,
):
    response = await async_client.post(
        "/api/v1/auth/register",
        json={
            "username": "case_user",
            "password": "SecurePass123!",
            "full_name": "大小写测试",
            "email": "CaseUser@ICS-ENERGY.COM",
            "user_type": "internal",
            "department": "信息技术部",
        },
    )

    assert response.status_code == 201

    stored_user = await db_session.get(User, response.json()["user_id"])
    assert stored_user is not None
    assert stored_user.email == "caseuser@ics-energy.com"
