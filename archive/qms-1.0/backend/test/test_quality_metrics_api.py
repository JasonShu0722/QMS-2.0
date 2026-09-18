from __future__ import annotations

from datetime import date, datetime, timedelta

import pytest

from app.core.dependencies import get_current_active_user
from app.main import app
from app.models.quality_metric import MetricType, QualityMetric
from app.models.supplier import Supplier, SupplierStatus
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
        department=kwargs.get("department"),
        position=kwargs.get("position"),
        supplier_id=kwargs.get("supplier_id"),
        password_changed_at=datetime.utcnow(),
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


async def _create_metric(
    db_session,
    *,
    metric_type: MetricType,
    metric_date: date,
    value: float,
    target_value: float,
    supplier_id: int | None = None,
) -> QualityMetric:
    metric = QualityMetric(
        metric_type=metric_type,
        metric_date=metric_date,
        value=value,
        target_value=target_value,
        supplier_id=supplier_id,
    )
    db_session.add(metric)
    await db_session.commit()
    await db_session.refresh(metric)
    return metric


@pytest.mark.asyncio
async def test_internal_user_can_view_overall_quality_dashboard(async_client, db_session):
    target_date = date(2026, 4, 18)
    supplier = await _create_supplier(db_session, code="S001", name="Supplier A")
    await _create_supplier(db_session, code="S002", name="Supplier B")
    internal_user = await _create_user(
        db_session,
        username="quality_viewer",
        full_name="Quality Viewer",
        email="quality-viewer@ics-energy.com",
        user_type=UserType.INTERNAL,
        department="Quality Management",
        position="Supplier Quality Engineer",
    )

    await _create_metric(
        db_session,
        metric_type=MetricType.INCOMING_BATCH_PASS_RATE,
        metric_date=target_date,
        value=98,
        target_value=95,
        supplier_id=supplier.id,
    )
    await _create_metric(
        db_session,
        metric_type=MetricType.MATERIAL_ONLINE_PPM,
        metric_date=target_date,
        value=320,
        target_value=500,
        supplier_id=supplier.id,
    )
    await _create_metric(
        db_session,
        metric_type=MetricType.PROCESS_DEFECT_RATE,
        metric_date=target_date,
        value=1.8,
        target_value=1.0,
    )

    async def override_current_user():
        return internal_user

    app.dependency_overrides[get_current_active_user] = override_current_user
    try:
        response = await async_client.get(
            "/api/v1/quality-metrics/dashboard",
            params={"target_date": target_date.isoformat()},
        )
    finally:
        app.dependency_overrides.pop(get_current_active_user, None)

    assert response.status_code == 200
    data = response.json()
    metric_types = {item["metric_type"] for item in data["metrics"]}
    assert metric_types == {
        MetricType.INCOMING_BATCH_PASS_RATE.value,
        MetricType.MATERIAL_ONLINE_PPM.value,
        MetricType.PROCESS_DEFECT_RATE.value,
    }


@pytest.mark.asyncio
async def test_supplier_user_only_sees_own_supplier_quality_trend(async_client, db_session):
    target_date = date(2026, 4, 18)
    previous_date = target_date - timedelta(days=1)
    supplier_a = await _create_supplier(db_session, code="S101669", name="Supplier A")
    supplier_b = await _create_supplier(db_session, code="S201669", name="Supplier B")
    supplier_user = await _create_user(
        db_session,
        username="supplier_viewer",
        full_name="Supplier Viewer",
        email="supplier-viewer@example.com",
        user_type=UserType.SUPPLIER,
        supplier_id=supplier_a.id,
        position="General Manager",
    )

    await _create_metric(
        db_session,
        metric_type=MetricType.INCOMING_BATCH_PASS_RATE,
        metric_date=previous_date,
        value=95,
        target_value=95,
        supplier_id=supplier_a.id,
    )
    await _create_metric(
        db_session,
        metric_type=MetricType.INCOMING_BATCH_PASS_RATE,
        metric_date=target_date,
        value=97,
        target_value=95,
        supplier_id=supplier_a.id,
    )
    await _create_metric(
        db_session,
        metric_type=MetricType.MATERIAL_ONLINE_PPM,
        metric_date=target_date,
        value=280,
        target_value=500,
        supplier_id=supplier_a.id,
    )
    await _create_metric(
        db_session,
        metric_type=MetricType.INCOMING_BATCH_PASS_RATE,
        metric_date=target_date,
        value=88,
        target_value=95,
        supplier_id=supplier_b.id,
    )
    await _create_metric(
        db_session,
        metric_type=MetricType.PROCESS_DEFECT_RATE,
        metric_date=target_date,
        value=2.4,
        target_value=1.0,
    )

    async def override_current_user():
        return supplier_user

    app.dependency_overrides[get_current_active_user] = override_current_user
    try:
        dashboard_response = await async_client.get(
            "/api/v1/quality-metrics/dashboard",
            params={"target_date": target_date.isoformat()},
        )
        trend_response = await async_client.get(
            "/api/v1/quality-metrics/trend",
            params={
                "metric_type": MetricType.INCOMING_BATCH_PASS_RATE.value,
                "start_date": previous_date.isoformat(),
                "end_date": target_date.isoformat(),
            },
        )
        denied_response = await async_client.get(
            "/api/v1/quality-metrics/trend",
            params={
                "metric_type": MetricType.PROCESS_DEFECT_RATE.value,
                "start_date": previous_date.isoformat(),
                "end_date": target_date.isoformat(),
            },
        )
    finally:
        app.dependency_overrides.pop(get_current_active_user, None)

    assert dashboard_response.status_code == 200
    dashboard_data = dashboard_response.json()
    dashboard_metric_types = {item["metric_type"] for item in dashboard_data["metrics"]}
    assert dashboard_metric_types == {
        MetricType.INCOMING_BATCH_PASS_RATE.value,
        MetricType.MATERIAL_ONLINE_PPM.value,
    }

    assert trend_response.status_code == 200
    trend_data = trend_response.json()
    assert trend_data["metric_type"] == MetricType.INCOMING_BATCH_PASS_RATE.value
    assert {item["supplier_id"] for item in trend_data["data_points"]} == {supplier_a.id}

    assert denied_response.status_code == 403


@pytest.mark.asyncio
async def test_internal_user_can_access_all_quality_analysis_tabs(async_client, db_session):
    target_date = date(2026, 4, 18)
    start_date = date(2026, 3, 19)
    supplier_a = await _create_supplier(db_session, code="SQA001", name="Supplier A")
    supplier_b = await _create_supplier(db_session, code="SQA002", name="Supplier B")
    internal_user = await _create_user(
        db_session,
        username="sqe_manager",
        full_name="SQE Manager",
        email="sqe-manager@ics-energy.com",
        user_type=UserType.INTERNAL,
        department="Quality Management",
        position="Supplier Quality Manager",
    )

    await _create_metric(
        db_session,
        metric_type=MetricType.INCOMING_BATCH_PASS_RATE,
        metric_date=target_date,
        value=99,
        target_value=95,
        supplier_id=supplier_a.id,
    )
    await _create_metric(
        db_session,
        metric_type=MetricType.INCOMING_BATCH_PASS_RATE,
        metric_date=target_date,
        value=97,
        target_value=95,
        supplier_id=supplier_b.id,
    )
    await _create_metric(
        db_session,
        metric_type=MetricType.PROCESS_DEFECT_RATE,
        metric_date=target_date,
        value=1.6,
        target_value=1.0,
    )
    await _create_metric(
        db_session,
        metric_type=MetricType.PROCESS_FPY,
        metric_date=target_date,
        value=96.5,
        target_value=98.0,
    )
    await _create_metric(
        db_session,
        metric_type=MetricType.OKM_PPM,
        metric_date=target_date,
        value=120,
        target_value=100,
    )
    await _create_metric(
        db_session,
        metric_type=MetricType.MIS_3_PPM,
        metric_date=target_date,
        value=200,
        target_value=150,
    )
    await _create_metric(
        db_session,
        metric_type=MetricType.MIS_12_PPM,
        metric_date=target_date,
        value=260,
        target_value=200,
    )

    async def override_current_user():
        return internal_user

    app.dependency_overrides[get_current_active_user] = override_current_user
    try:
        top_suppliers_response = await async_client.get(
            "/api/v1/quality-metrics/top-suppliers",
            params={
                "metric_type": MetricType.INCOMING_BATCH_PASS_RATE.value,
                "period": "monthly",
                "target_date": target_date.isoformat(),
            },
        )
        process_analysis_response = await async_client.get(
            "/api/v1/quality-metrics/process-analysis",
            params={
                "start_date": start_date.isoformat(),
                "end_date": target_date.isoformat(),
            },
        )
        customer_analysis_response = await async_client.get(
            "/api/v1/quality-metrics/customer-analysis",
            params={
                "start_date": start_date.isoformat(),
                "end_date": target_date.isoformat(),
            },
        )
    finally:
        app.dependency_overrides.pop(get_current_active_user, None)

    assert top_suppliers_response.status_code == 200
    assert len(top_suppliers_response.json()["top_suppliers"]) == 2

    assert process_analysis_response.status_code == 200
    assert "monthly_trend" in process_analysis_response.json()

    assert customer_analysis_response.status_code == 200
    assert "monthly_trend" in customer_analysis_response.json()
