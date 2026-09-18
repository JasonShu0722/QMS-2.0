from __future__ import annotations

from datetime import datetime

import pytest

from app.core.dependencies import get_current_user
from app.main import app
from app.models.supplier import Supplier, SupplierStatus
from app.models.supplier_performance import PerformanceGrade, SupplierPerformance
from app.models.user import User, UserStatus, UserType


async def _create_supplier(db_session, *, code: str, name: str) -> Supplier:
    supplier = Supplier(
        code=code,
        name=name,
        status=SupplierStatus.ACTIVE,
    )
    db_session.add(supplier)
    await db_session.commit()
    await db_session.refresh(supplier)
    return supplier


async def _create_user(db_session, **kwargs) -> User:
    user = User(
        username=kwargs["username"],
        password_hash="hashed_password",
        full_name=kwargs["full_name"],
        email=kwargs["email"],
        user_type=kwargs["user_type"],
        status=UserStatus.ACTIVE,
        supplier_id=kwargs.get("supplier_id"),
        password_changed_at=datetime.utcnow(),
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


async def _create_performance(
    db_session,
    *,
    supplier_id: int,
    year: int,
    month: int,
    score: float,
    grade: str,
) -> SupplierPerformance:
    performance = SupplierPerformance(
        supplier_id=supplier_id,
        year=year,
        month=month,
        incoming_quality_deduction=5.0,
        process_quality_deduction=0.0,
        cooperation_deduction=0.0,
        zero_km_deduction=0.0,
        total_deduction=5.0,
        final_score=score,
        grade=grade,
        is_reviewed=False,
    )
    db_session.add(performance)
    await db_session.commit()
    await db_session.refresh(performance)
    return performance


@pytest.mark.asyncio
async def test_supplier_user_only_sees_own_performance_records(async_client, db_session):
    supplier_a = await _create_supplier(db_session, code="101669", name="Supplier A")
    supplier_b = await _create_supplier(db_session, code="102107", name="Supplier B")
    supplier_user = await _create_user(
        db_session,
        username="supplier_reader",
        full_name="Supplier Reader",
        email="supplier-reader@example.com",
        user_type=UserType.SUPPLIER,
        supplier_id=supplier_a.id,
    )

    own_performance = await _create_performance(
        db_session,
        supplier_id=supplier_a.id,
        year=2026,
        month=4,
        score=91.67,
        grade=PerformanceGrade.B.value,
    )
    await _create_performance(
        db_session,
        supplier_id=supplier_b.id,
        year=2026,
        month=4,
        score=76.50,
        grade=PerformanceGrade.C.value,
    )

    async def override_current_user():
        return supplier_user

    app.dependency_overrides[get_current_user] = override_current_user
    try:
        list_response = await async_client.get("/api/v1/supplier-performance")
        detail_response = await async_client.get(f"/api/v1/supplier-performance/{own_performance.id}")
        stats_response = await async_client.get("/api/v1/supplier-performance/statistics/2026/4")
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert list_response.status_code == 200
    list_data = list_response.json()
    assert list_data["total"] == 1
    assert [item["supplier_id"] for item in list_data["items"]] == [supplier_a.id]

    assert detail_response.status_code == 200
    assert detail_response.json()["supplier_id"] == supplier_a.id

    assert stats_response.status_code == 403


@pytest.mark.asyncio
async def test_supplier_user_cannot_access_other_supplier_performance_detail(async_client, db_session):
    supplier_a = await _create_supplier(db_session, code="101475", name="Supplier A")
    supplier_b = await _create_supplier(db_session, code="101442", name="Supplier B")
    supplier_user = await _create_user(
        db_session,
        username="supplier_guard",
        full_name="Supplier Guard",
        email="supplier-guard@example.com",
        user_type=UserType.SUPPLIER,
        supplier_id=supplier_a.id,
    )
    other_performance = await _create_performance(
        db_session,
        supplier_id=supplier_b.id,
        year=2026,
        month=4,
        score=88.40,
        grade=PerformanceGrade.B.value,
    )

    async def override_current_user():
        return supplier_user

    app.dependency_overrides[get_current_user] = override_current_user
    try:
        detail_response = await async_client.get(f"/api/v1/supplier-performance/{other_performance.id}")
        card_response = await async_client.get(
            f"/api/v1/supplier-performance/card/{supplier_b.id}",
            params={"year": 2026, "month": 4},
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert detail_response.status_code == 404
    assert card_response.status_code == 404
