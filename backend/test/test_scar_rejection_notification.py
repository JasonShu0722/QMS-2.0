from datetime import datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.eight_d import EightD, EightDStatus
from app.models.notification import Notification
from app.models.operation_log import OperationLog
from app.models.scar import SCAR, SCARSeverity, SCARStatus
from app.models.supplier import Supplier, SupplierStatus
from app.models.user import User, UserStatus, UserType
from app.schemas.scar import EightDReview
from app.services.scar_service import EightDService


@pytest.mark.asyncio
async def test_rejected_scar_8d_notifies_current_responsible_user(db_session: AsyncSession):
    supplier = Supplier(
        name="测试供应商",
        code="SUP-REJECT-001",
        status=SupplierStatus.ACTIVE,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db_session.add(supplier)
    await db_session.commit()
    await db_session.refresh(supplier)

    supplier_user = User(
        username="supplier_reject_owner",
        password_hash="hashed",
        full_name="供应商责任人",
        email="supplier.reject@example.com",
        user_type=UserType.SUPPLIER,
        status=UserStatus.ACTIVE,
        supplier_id=supplier.id,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    reviewer = User(
        username="sqe_reviewer",
        password_hash="hashed",
        full_name="供应商质量工程师",
        email="sqe.reviewer@example.com",
        user_type=UserType.INTERNAL,
        status=UserStatus.ACTIVE,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db_session.add_all([supplier_user, reviewer])
    await db_session.commit()
    await db_session.refresh(supplier_user)
    await db_session.refresh(reviewer)

    scar = SCAR(
        scar_number="SCAR-20260507-0001",
        supplier_id=supplier.id,
        material_code="MAT-001",
        material_category="structure",
        defect_description="屏蔽盖针规无法塞入",
        defect_qty=1,
        severity=SCARSeverity.MEDIUM,
        status=SCARStatus.UNDER_REVIEW,
        current_handler_id=reviewer.id,
        deadline=datetime.utcnow() + timedelta(days=7),
        created_by=reviewer.id,
        created_at=datetime(2026, 5, 7),
        updated_at=datetime.utcnow(),
    )
    db_session.add(scar)
    await db_session.commit()
    await db_session.refresh(scar)

    eight_d = EightD(
        scar_id=scar.id,
        d4_d7_data={
            "root_cause": "原因描述不充分",
            "corrective_action": "补充改善对策",
            "preventive_action": "补充防再发措施",
        },
        status=EightDStatus.SUBMITTED,
        submitted_by=supplier_user.id,
        submitted_at=datetime.utcnow(),
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db_session.add(eight_d)
    await db_session.commit()

    await EightDService.review_8d_report(
        db=db_session,
        scar_id=scar.id,
        review_data=EightDReview(approved=False, review_comments="原因分析不充分"),
        reviewed_by=reviewer.id,
    )

    await db_session.refresh(scar)
    assert scar.status == SCARStatus.REJECTED
    assert scar.current_handler_id == supplier_user.id

    notification_result = await db_session.execute(
        select(Notification).where(Notification.user_id == supplier_user.id)
    )
    notification = notification_result.scalar_one()
    expected_report_number = f"ZX8D-IQ0-2605-{scar.id:03d}"

    assert notification.is_read is False
    assert notification.message_type == "workflow_exception"
    assert notification.title == f"8D 报告被驳回：{expected_report_number}"
    assert "原因分析不充分" in notification.content
    assert notification.link == f"/supplier/eight-d/{scar.id}?sourceRouteName=SCARList&sourceFocusId={scar.id}"

    history_result = await db_session.execute(
        select(OperationLog).where(
            OperationLog.target_module == "scar",
            OperationLog.target_id == scar.id,
            OperationLog.operation_type == "reject",
        )
    )
    history = history_result.scalar_one()
    assert history.after_data["action"] == "驳回"
    assert history.after_data["report_number"] == expected_report_number
    assert history.after_data["content"] == "原因分析不充分"
