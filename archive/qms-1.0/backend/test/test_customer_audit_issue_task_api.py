"""
Customer-audit issue-task API tests.
"""

from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import CustomerAudit
from app.models.user import User


async def _seed_customer_audit(
    db_session: AsyncSession,
    *,
    user: User,
    name_suffix: str,
) -> CustomerAudit:
    now = datetime.utcnow()

    audit = CustomerAudit(
        customer_name=f"Customer {name_suffix}",
        audit_type="system",
        audit_date=now,
        final_result="conditional_passed",
        score=88,
        external_issue_list_path=None,
        internal_contact="QA",
        audit_report_path=None,
        summary="test customer audit",
        status="completed",
        created_at=now,
        updated_at=now,
        created_by=user.id,
    )
    db_session.add(audit)
    await db_session.commit()
    await db_session.refresh(audit)
    return audit


@pytest.mark.asyncio
async def test_create_customer_audit_issue_task_returns_unified_problem_category(
    async_client: AsyncClient,
    db_session: AsyncSession,
    test_user: User,
    test_user_token: str,
):
    audit = await _seed_customer_audit(db_session, user=test_user, name_suffix="create")
    headers = {"Authorization": f"Bearer {test_user_token}"}

    response = await async_client.post(
        f"/api/v1/customer-audits/{audit.id}/issue-tasks",
        headers=headers,
        json={
            "customer_audit_id": audit.id,
            "issue_description": "Line clearance gap",
            "responsible_dept": "Quality",
            "assigned_to": test_user.id,
            "deadline": (datetime.utcnow() + timedelta(days=7)).isoformat(),
            "priority": "high",
        },
    )

    assert response.status_code == 201
    data = response.json()
    assert data["customer_audit_id"] == audit.id
    assert data["issue_description"] == "Line clearance gap"
    assert data["status"] == "assigned"
    assert data["priority"] == "high"
    assert data["problem_category_key"] == "AQ3"
    assert data["problem_category_label"]


@pytest.mark.asyncio
async def test_list_customer_audit_issue_tasks_returns_unified_problem_category(
    async_client: AsyncClient,
    db_session: AsyncSession,
    test_user: User,
    test_user_token: str,
):
    audit = await _seed_customer_audit(db_session, user=test_user, name_suffix="list")
    headers = {"Authorization": f"Bearer {test_user_token}"}

    create_response = await async_client.post(
        f"/api/v1/customer-audits/{audit.id}/issue-tasks",
        headers=headers,
        json={
            "customer_audit_id": audit.id,
            "issue_description": "Packaging defect follow-up",
            "responsible_dept": "Production",
            "assigned_to": None,
            "deadline": (datetime.utcnow() + timedelta(days=5)).isoformat(),
            "priority": "medium",
        },
    )
    assert create_response.status_code == 201

    response = await async_client.get(
        f"/api/v1/customer-audits/{audit.id}/issue-tasks",
        headers=headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["customer_audit_id"] == audit.id
    assert data[0]["issue_description"] == "Packaging defect follow-up"
    assert data[0]["status"] == "open"
    assert data[0]["problem_category_key"] == "AQ3"
    assert data[0]["problem_category_label"]
