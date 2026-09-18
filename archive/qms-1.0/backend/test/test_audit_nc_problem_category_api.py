"""
Audit NC problem-category API tests.
"""

from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditExecution, AuditNC, AuditPlan, AuditTemplate
from app.models.user import User


async def _seed_audit_nc(
    db_session: AsyncSession,
    *,
    user: User,
    audit_type: str,
    name_suffix: str,
) -> AuditNC:
    now = datetime.utcnow()

    plan = AuditPlan(
        audit_type=audit_type,
        audit_name=f"Audit Plan {name_suffix}",
        planned_date=now + timedelta(days=1),
        auditor_id=user.id,
        auditee_dept="Quality",
        status="planned",
        created_at=now,
        updated_at=now,
        created_by=user.id,
    )
    db_session.add(plan)
    await db_session.flush()

    template = AuditTemplate(
        template_name=f"Template {name_suffix}",
        audit_type=audit_type,
        checklist_items={"items": []},
        scoring_rules={"rules": []},
        description="test template",
        is_builtin=False,
        is_active=True,
        created_at=now,
        updated_at=now,
        created_by=user.id,
    )
    db_session.add(template)
    await db_session.flush()

    execution = AuditExecution(
        audit_plan_id=plan.id,
        template_id=template.id,
        audit_date=now,
        auditor_id=user.id,
        audit_team={"members": []},
        checklist_results={"items": []},
        final_score=None,
        grade=None,
        audit_report_path=None,
        summary=None,
        status="nc_open",
        created_at=now,
        updated_at=now,
        created_by=user.id,
    )
    db_session.add(execution)
    await db_session.flush()

    nc = AuditNC(
        audit_id=execution.id,
        nc_item=f"Clause {name_suffix}",
        nc_description=f"Problem {name_suffix}",
        evidence_photo_path=None,
        responsible_dept="Quality",
        assigned_to=None,
        root_cause=None,
        corrective_action=None,
        corrective_evidence=None,
        verification_status="open",
        verified_by=None,
        verified_at=None,
        verification_comment=None,
        deadline=now + timedelta(days=3),
        closed_at=None,
        created_at=now,
        updated_at=now,
        created_by=user.id,
    )
    db_session.add(nc)
    await db_session.commit()
    await db_session.refresh(nc)
    return nc


@pytest.mark.asyncio
async def test_get_audit_nc_detail_returns_problem_category(
    async_client: AsyncClient,
    db_session: AsyncSession,
    test_user: User,
    test_user_token: str,
):
    nc = await _seed_audit_nc(
        db_session,
        user=test_user,
        audit_type="process_audit",
        name_suffix="process",
    )
    headers = {"Authorization": f"Bearer {test_user_token}"}

    response = await async_client.get(f"/api/v1/audit-nc/{nc.id}", headers=headers)

    assert response.status_code == 200
    data = response.json()
    assert data["audit_type"] == "process_audit"
    assert data["problem_category_key"] == "AQ1"
    assert data["problem_category_label"]


@pytest.mark.asyncio
async def test_list_audit_ncs_returns_problem_category(
    async_client: AsyncClient,
    db_session: AsyncSession,
    test_user: User,
    test_user_token: str,
):
    await _seed_audit_nc(
        db_session,
        user=test_user,
        audit_type="customer_audit",
        name_suffix="customer",
    )
    headers = {"Authorization": f"Bearer {test_user_token}"}

    response = await async_client.get("/api/v1/audit-nc", headers=headers)

    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 1
    assert data["items"][0]["audit_type"] == "customer_audit"
    assert data["items"][0]["problem_category_key"] == "AQ3"
    assert data["items"][0]["problem_category_label"]


@pytest.mark.asyncio
async def test_list_audit_ncs_filters_by_problem_category(
    async_client: AsyncClient,
    db_session: AsyncSession,
    test_user: User,
    test_user_token: str,
):
    await _seed_audit_nc(
        db_session,
        user=test_user,
        audit_type="process_audit",
        name_suffix="filter-process",
    )
    await _seed_audit_nc(
        db_session,
        user=test_user,
        audit_type="customer_audit",
        name_suffix="filter-customer",
    )
    headers = {"Authorization": f"Bearer {test_user_token}"}

    response = await async_client.get(
        "/api/v1/audit-nc",
        headers=headers,
        params={"problem_category_key": "AQ3"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 1
    assert len(data["items"]) == 1
    assert data["items"][0]["audit_type"] == "customer_audit"
    assert data["items"][0]["problem_category_key"] == "AQ3"
