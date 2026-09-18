"""
Audit NC service.
"""

from datetime import datetime
from typing import List, Optional

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    NotFoundException,
    PermissionDeniedException,
    ValidationException,
)
from app.core.problem_management import (
    get_audit_type_by_problem_category,
    get_problem_category_by_audit_type,
)
from app.models.audit import AuditExecution, AuditNC, AuditPlan
from app.models.user import User
from app.schemas.audit_nc import (
    AuditNCAssign,
    AuditNCClose,
    AuditNCDetail,
    AuditNCQuery,
    AuditNCResponse,
    AuditNCVerify,
)


class AuditNCService:
    """Service layer for audit non-conformance records."""

    @staticmethod
    def _build_nc_detail(
        nc: AuditNC,
        audit_type: Optional[str] = None,
    ) -> AuditNCDetail:
        now = datetime.utcnow()
        remaining_hours = (nc.deadline - now).total_seconds() / 3600
        is_overdue = remaining_hours < 0 and nc.verification_status not in ["closed", "verified"]

        nc_dict = nc.to_dict()
        nc_dict["is_overdue"] = is_overdue
        nc_dict["remaining_hours"] = remaining_hours
        nc_dict["audit_type"] = audit_type
        nc_dict["problem_category_key"] = None
        nc_dict["problem_category_label"] = None

        if audit_type:
            try:
                category = get_problem_category_by_audit_type(audit_type)
            except ValueError:
                pass
            else:
                nc_dict["problem_category_key"] = category.key
                nc_dict["problem_category_label"] = category.label

        return AuditNCDetail(**nc_dict)

    @staticmethod
    async def assign_nc(
        db: AsyncSession,
        nc_id: int,
        data: AuditNCAssign,
        current_user_id: int,
    ) -> AuditNC:
        nc = await db.get(AuditNC, nc_id)
        if not nc:
            raise NotFoundException(f"NC记录 ID {nc_id} 不存在")

        if nc.verification_status not in ["open", "rejected"]:
            raise ValidationException(f"NC状态为 {nc.verification_status}，无法指派")

        assigned_user = await db.get(User, data.assigned_to)
        if not assigned_user:
            raise NotFoundException(f"用户 ID {data.assigned_to} 不存在")

        nc.assigned_to = data.assigned_to
        nc.deadline = data.deadline
        nc.verification_status = "assigned"
        nc.updated_at = datetime.utcnow()

        await db.commit()
        await db.refresh(nc)
        return nc

    @staticmethod
    async def submit_response(
        db: AsyncSession,
        nc_id: int,
        data: AuditNCResponse,
        current_user_id: int,
    ) -> AuditNC:
        nc = await db.get(AuditNC, nc_id)
        if not nc:
            raise NotFoundException(f"NC记录 ID {nc_id} 不存在")

        if nc.assigned_to != current_user_id:
            raise PermissionDeniedException("您无权提交此NC的响应")

        if nc.verification_status not in ["assigned", "rejected"]:
            raise ValidationException(f"NC状态为 {nc.verification_status}，无法提交响应")

        nc.root_cause = data.root_cause
        nc.corrective_action = data.corrective_action
        nc.corrective_evidence = data.corrective_evidence
        nc.verification_status = "submitted"
        nc.updated_at = datetime.utcnow()

        await db.commit()
        await db.refresh(nc)
        return nc

    @staticmethod
    async def verify_nc(
        db: AsyncSession,
        nc_id: int,
        data: AuditNCVerify,
        current_user_id: int,
    ) -> AuditNC:
        nc = await db.get(AuditNC, nc_id)
        if not nc:
            raise NotFoundException(f"NC记录 ID {nc_id} 不存在")

        if nc.verification_status != "submitted":
            raise ValidationException(f"NC状态为 {nc.verification_status}，无法验证")

        audit_execution = await db.get(AuditExecution, nc.audit_id)
        if not audit_execution:
            raise NotFoundException(f"审核执行记录 ID {nc.audit_id} 不存在")

        if audit_execution.auditor_id != current_user_id:
            raise PermissionDeniedException("您无权验证此NC")

        nc.verified_by = current_user_id
        nc.verified_at = datetime.utcnow()
        nc.verification_comment = data.verification_comment
        nc.verification_status = "verified" if data.is_approved else "rejected"
        nc.updated_at = datetime.utcnow()

        await db.commit()
        await db.refresh(nc)
        return nc

    @staticmethod
    async def close_nc(
        db: AsyncSession,
        nc_id: int,
        data: AuditNCClose,
        current_user_id: int,
    ) -> AuditNC:
        nc = await db.get(AuditNC, nc_id)
        if not nc:
            raise NotFoundException(f"NC记录 ID {nc_id} 不存在")

        if nc.verification_status != "verified":
            raise ValidationException(f"NC状态为 {nc.verification_status}，无法关闭。必须先验证通过。")

        audit_execution = await db.get(AuditExecution, nc.audit_id)
        if not audit_execution:
            raise NotFoundException(f"审核执行记录 ID {nc.audit_id} 不存在")

        if audit_execution.auditor_id != current_user_id:
            raise PermissionDeniedException("您无权关闭此NC")

        nc.verification_status = "closed"
        nc.closed_at = datetime.utcnow()
        nc.updated_at = datetime.utcnow()

        await db.commit()
        await db.refresh(nc)
        await AuditNCService._check_and_update_audit_status(db, nc.audit_id)
        return nc

    @staticmethod
    async def _check_and_update_audit_status(
        db: AsyncSession,
        audit_id: int,
    ) -> None:
        query = select(AuditNC).where(AuditNC.audit_id == audit_id)
        result = await db.execute(query)
        all_ncs = result.scalars().all()

        if all(nc.verification_status == "closed" for nc in all_ncs):
            audit_execution = await db.get(AuditExecution, audit_id)
            if audit_execution and audit_execution.status == "nc_open":
                audit_execution.status = "completed"
                await db.commit()

    @staticmethod
    async def get_nc_detail(
        db: AsyncSession,
        nc_id: int,
    ) -> Optional[AuditNCDetail]:
        query = (
            select(AuditNC, AuditPlan.audit_type)
            .outerjoin(AuditExecution, AuditExecution.id == AuditNC.audit_id)
            .outerjoin(AuditPlan, AuditPlan.id == AuditExecution.audit_plan_id)
            .where(AuditNC.id == nc_id)
        )
        result = await db.execute(query)
        row = result.one_or_none()
        if row is None:
            return None

        nc, audit_type = row
        return AuditNCService._build_nc_detail(nc, audit_type)

    @staticmethod
    async def list_ncs(
        db: AsyncSession,
        query_params: AuditNCQuery,
    ) -> tuple[List[AuditNCDetail], int]:
        conditions = []

        if query_params.audit_id:
            conditions.append(AuditNC.audit_id == query_params.audit_id)

        if query_params.assigned_to:
            conditions.append(AuditNC.assigned_to == query_params.assigned_to)

        if query_params.responsible_dept:
            conditions.append(AuditNC.responsible_dept == query_params.responsible_dept)

        if query_params.problem_category_key:
            try:
                audit_type = get_audit_type_by_problem_category(query_params.problem_category_key)
            except ValueError:
                return [], 0
            conditions.append(AuditPlan.audit_type == audit_type)

        if query_params.verification_status:
            conditions.append(AuditNC.verification_status == query_params.verification_status)

        if query_params.is_overdue:
            now = datetime.utcnow()
            conditions.append(
                and_(
                    AuditNC.deadline < now,
                    AuditNC.verification_status.notin_(["closed", "verified"]),
                )
            )

        count_query = (
            select(func.count(AuditNC.id))
            .select_from(AuditNC)
            .outerjoin(AuditExecution, AuditExecution.id == AuditNC.audit_id)
            .outerjoin(AuditPlan, AuditPlan.id == AuditExecution.audit_plan_id)
        )
        if conditions:
            count_query = count_query.where(and_(*conditions))
        result = await db.execute(count_query)
        total = result.scalar_one()

        query = (
            select(AuditNC, AuditPlan.audit_type)
            .outerjoin(AuditExecution, AuditExecution.id == AuditNC.audit_id)
            .outerjoin(AuditPlan, AuditPlan.id == AuditExecution.audit_plan_id)
        )
        if conditions:
            query = query.where(and_(*conditions))
        query = query.order_by(AuditNC.deadline.asc())
        query = query.offset((query_params.page - 1) * query_params.page_size).limit(query_params.page_size)

        result = await db.execute(query)
        rows = result.all()
        nc_details = [AuditNCService._build_nc_detail(nc, audit_type) for nc, audit_type in rows]
        return nc_details, total

    @staticmethod
    async def get_overdue_ncs(
        db: AsyncSession,
    ) -> List[AuditNC]:
        now = datetime.utcnow()
        query = select(AuditNC).where(
            and_(
                AuditNC.deadline < now,
                AuditNC.verification_status.notin_(["closed", "verified"]),
            )
        )
        result = await db.execute(query)
        return list(result.scalars().all())
