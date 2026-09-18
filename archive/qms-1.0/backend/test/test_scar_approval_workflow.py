from datetime import datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.eight_d import EightD, EightDStatus
from app.models.notification import Notification
from app.models.role_tag import RoleTag
from app.models.scar import SCAR, SCARSeverity, SCARStatus
from app.models.supplier import Supplier, SupplierStatus
from app.models.user import User, UserStatus, UserType
from app.models.user_role_assignment import UserRoleAssignment
from app.schemas.scar import EightDReview
from app.services.scar_service import EightDService


async def _create_user(
    db_session: AsyncSession,
    username: str,
    full_name: str,
    user_type: UserType,
    *,
    supplier_id: int | None = None,
    department: str | None = None,
    position: str | None = None,
) -> User:
    user = User(
        username=username,
        password_hash="hashed",
        full_name=full_name,
        email=f"{username}@example.com",
        user_type=user_type,
        status=UserStatus.ACTIVE,
        supplier_id=supplier_id,
        department=department,
        position=position,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


async def _assign_role(db_session: AsyncSession, user: User, role_key: str) -> None:
    role = RoleTag(
        role_key=role_key,
        role_name=role_key,
        applicable_user_type=UserType.INTERNAL,
        is_active=True,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db_session.add(role)
    await db_session.commit()
    await db_session.refresh(role)

    db_session.add(
        UserRoleAssignment(
            user_id=user.id,
            role_tag_id=role.id,
            assigned_at=datetime.utcnow(),
        )
    )
    await db_session.commit()


async def _create_submitted_scar(
    db_session: AsyncSession,
    supplier: Supplier,
    supplier_user: User,
    engineer: User,
    severity: SCARSeverity,
    number_suffix: str,
) -> tuple[SCAR, EightD]:
    scar = SCAR(
        scar_number=f"SCAR-20260509-{number_suffix}",
        supplier_id=supplier.id,
        material_code=f"MAT-{number_suffix}",
        material_category="structure",
        defect_description="sample defect",
        defect_qty=1,
        severity=severity,
        status=SCARStatus.UNDER_REVIEW,
        current_handler_id=engineer.id,
        deadline=datetime.utcnow() + timedelta(days=7),
        created_by=engineer.id,
        created_at=datetime(2026, 5, 9),
        updated_at=datetime.utcnow(),
    )
    db_session.add(scar)
    await db_session.commit()
    await db_session.refresh(scar)

    report = EightD(
        scar_id=scar.id,
        d4_d7_data={
            "root_cause": "root cause",
            "corrective_action": "corrective action",
            "preventive_action": "preventive action",
        },
        status=EightDStatus.SUBMITTED,
        submitted_by=supplier_user.id,
        submitted_at=datetime.utcnow(),
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db_session.add(report)
    await db_session.commit()
    await db_session.refresh(report)
    return scar, report


@pytest.mark.asyncio
async def test_low_severity_engineer_approval_closes_scar(db_session: AsyncSession):
    supplier = Supplier(
        name="supplier-low",
        code="SUP-LOW",
        status=SupplierStatus.ACTIVE,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db_session.add(supplier)
    await db_session.commit()
    await db_session.refresh(supplier)

    supplier_user = await _create_user(
        db_session,
        "supplier_low_owner",
        "supplier low owner",
        UserType.SUPPLIER,
        supplier_id=supplier.id,
    )
    engineer = await _create_user(
        db_session,
        "sqe_low",
        "SQE Low",
        UserType.INTERNAL,
        department="Supplier Quality",
        position="Engineer",
    )

    scar, report = await _create_submitted_scar(
        db_session,
        supplier,
        supplier_user,
        engineer,
        SCARSeverity.LOW,
        "LOW",
    )

    result = await EightDService.review_8d_report(
        db=db_session,
        scar_id=scar.id,
        review_data=EightDReview(approved=True, review_comments="ok"),
        reviewed_by=engineer.id,
    )

    await db_session.refresh(scar)
    assert result.status == EightDStatus.CLOSED
    assert scar.status == SCARStatus.CLOSED
    assert scar.current_handler_id is None
    assert result.d8_data["approval_workflow"]["required_levels"] == ["engineer"]
    assert len(result.d8_data["approval_workflow"]["history"]) == 1

    notification_result = await db_session.execute(
        select(Notification).where(Notification.user_id == supplier_user.id)
    )
    notification = notification_result.scalar_one()
    assert "已关闭" in notification.title


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("severity", "expected_levels"),
    [
        (SCARSeverity.MEDIUM, ["engineer", "manager"]),
        (SCARSeverity.HIGH, ["engineer", "manager"]),
        (SCARSeverity.CRITICAL, ["engineer", "manager", "minister"]),
    ],
)
async def test_medium_high_critical_severity_requires_layered_approval(
    db_session: AsyncSession,
    severity: SCARSeverity,
    expected_levels: list[str],
):
    supplier = Supplier(
        name=f"supplier-{severity.value}",
        code=f"SUP-{severity.value.upper()}",
        status=SupplierStatus.ACTIVE,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db_session.add(supplier)
    await db_session.commit()
    await db_session.refresh(supplier)

    supplier_user = await _create_user(
        db_session,
        f"supplier_{severity.value}_owner",
        f"supplier {severity.value} owner",
        UserType.SUPPLIER,
        supplier_id=supplier.id,
    )
    engineer = await _create_user(
        db_session,
        f"sqe_{severity.value}",
        f"SQE {severity.value}",
        UserType.INTERNAL,
        department="Supplier Quality",
        position="Engineer",
    )
    manager = await _create_user(
        db_session,
        f"manager_{severity.value}",
        f"Manager {severity.value}",
        UserType.INTERNAL,
        department="Supplier Quality",
        position="Manager",
    )
    minister = await _create_user(
        db_session,
        f"minister_{severity.value}",
        f"Minister {severity.value}",
        UserType.INTERNAL,
        department="Quality",
        position="Minister",
    )
    await _assign_role(db_session, manager, "quality.supplier.manager")
    await _assign_role(db_session, minister, "quality.minister")

    scar, report = await _create_submitted_scar(
        db_session,
        supplier,
        supplier_user,
        engineer,
        severity,
        severity.value.upper(),
    )

    report = await EightDService.review_8d_report(
        db=db_session,
        scar_id=scar.id,
        review_data=EightDReview(approved=True, review_comments="engineer ok"),
        reviewed_by=engineer.id,
    )
    await db_session.refresh(scar)
    assert report.status == EightDStatus.SUBMITTED
    assert scar.status == SCARStatus.UNDER_REVIEW
    assert scar.current_handler_id == manager.id

    report = await EightDService.review_8d_report(
        db=db_session,
        scar_id=scar.id,
        review_data=EightDReview(approved=True, review_comments="manager ok"),
        reviewed_by=manager.id,
    )
    await db_session.refresh(scar)

    if severity == SCARSeverity.CRITICAL:
        assert report.status == EightDStatus.SUBMITTED
        assert scar.status == SCARStatus.UNDER_REVIEW
        assert scar.current_handler_id == minister.id
        report = await EightDService.review_8d_report(
            db=db_session,
            scar_id=scar.id,
            review_data=EightDReview(approved=True, review_comments="minister ok"),
            reviewed_by=minister.id,
        )
        await db_session.refresh(scar)

    assert report.status == EightDStatus.CLOSED
    assert scar.status == SCARStatus.CLOSED
    assert scar.current_handler_id is None
    assert report.d8_data["approval_workflow"]["required_levels"] == expected_levels
    assert len(report.d8_data["approval_workflow"]["history"]) == len(expected_levels)
