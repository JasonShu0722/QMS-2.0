"""Service layer for new-product defect source records."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.new_product_defect import (
    NewProductDefect,
    NewProductDefectSourceType,
    NewProductDefectStatus,
)
from app.models.problem_report import ProblemReport, ProblemReportStatus
from app.schemas.new_product_defect import (
    NewProductDefectCreate,
    NewProductDefectProblemReportCreate,
    NewProductDefectUpdate,
)
from app.schemas.problem_management import ProblemReportCreate, ProblemReportSourceCreate
from app.services.problem_management_service import ProblemManagementService


class NewProductDefectService:
    @staticmethod
    async def attach_problem_report_numbers(
        db: AsyncSession,
        defects: list[NewProductDefect],
    ) -> None:
        report_ids = [defect.problem_report_id for defect in defects if defect.problem_report_id]
        if not report_ids:
            return

        result = await db.execute(select(ProblemReport).where(ProblemReport.id.in_(report_ids)))
        report_by_id = {report.id: report for report in result.scalars().all()}

        for defect in defects:
            report = report_by_id.get(defect.problem_report_id)
            if report is None:
                continue
            defect.problem_number = report.problem_number
            defect.eight_d_number = report.eight_d_number

    @staticmethod
    async def generate_defect_number(db: AsyncSession) -> str:
        today = datetime.utcnow().strftime("%Y%m%d")
        prefix = f"NPD-{today}-"
        result = await db.execute(
            select(NewProductDefect.defect_number)
            .where(NewProductDefect.defect_number.like(f"{prefix}%"))
            .order_by(NewProductDefect.defect_number.desc())
            .limit(1)
        )
        latest_number = result.scalar_one_or_none()
        if latest_number:
            try:
                sequence = int(str(latest_number).rsplit("-", 1)[-1]) + 1
            except ValueError:
                sequence = 1
        else:
            sequence = 1
        return f"{prefix}{sequence:03d}"

    @staticmethod
    async def create_defect(
        db: AsyncSession,
        defect_data: NewProductDefectCreate,
        recorded_by: int,
    ) -> NewProductDefect:
        try:
            source_type = NewProductDefectSourceType(defect_data.source_type)
        except ValueError as exc:
            raise ValueError("source_type must be trial_defect or customer_complaint") from exc

        defect = NewProductDefect(
            defect_number=await NewProductDefectService.generate_defect_number(db),
            source_type=source_type,
            defect_date=defect_data.defect_date,
            project_id=defect_data.project_id,
            trial_id=defect_data.trial_id,
            customer_name=defect_data.customer_name,
            customer_complaint_number=defect_data.customer_complaint_number,
            product_code=defect_data.product_code,
            product_name=defect_data.product_name,
            defect_type=defect_data.defect_type,
            defect_description=defect_data.defect_description,
            defect_qty=defect_data.defect_qty,
            responsible_dept=defect_data.responsible_dept,
            recorded_by=recorded_by,
            remarks=defect_data.remarks,
        )
        db.add(defect)
        await db.commit()
        await db.refresh(defect)
        return defect

    @staticmethod
    async def get_defect_by_id(db: AsyncSession, defect_id: int) -> NewProductDefect | None:
        result = await db.execute(select(NewProductDefect).where(NewProductDefect.id == defect_id))
        return result.scalar_one_or_none()

    @staticmethod
    async def list_defects(
        db: AsyncSession,
        *,
        source_type: str | None = None,
        keyword: str | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[NewProductDefect], int]:
        stmt = select(NewProductDefect)
        if source_type:
            stmt = stmt.where(NewProductDefect.source_type == source_type)
        if keyword:
            like_value = f"%{keyword.strip()}%"
            stmt = stmt.where(
                or_(
                    NewProductDefect.defect_number.ilike(like_value),
                    NewProductDefect.defect_type.ilike(like_value),
                    NewProductDefect.defect_description.ilike(like_value),
                    NewProductDefect.customer_name.ilike(like_value),
                    NewProductDefect.product_code.ilike(like_value),
                )
            )

        count_result = await db.execute(select(func.count()).select_from(stmt.subquery()))
        total = count_result.scalar() or 0
        stmt = (
            stmt.order_by(NewProductDefect.defect_date.desc(), NewProductDefect.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        result = await db.execute(stmt)
        return list(result.scalars().all()), total

    @staticmethod
    async def update_defect(
        db: AsyncSession,
        defect_id: int,
        defect_data: NewProductDefectUpdate,
    ) -> NewProductDefect:
        defect = await NewProductDefectService.get_defect_by_id(db, defect_id)
        if not defect:
            raise ValueError("New product defect not found")

        for field, value in defect_data.model_dump(exclude_unset=True).items():
            setattr(defect, field, value)
        defect.updated_at = datetime.utcnow()
        await db.commit()
        await db.refresh(defect)
        return defect

    @staticmethod
    async def create_problem_report(
        db: AsyncSession,
        *,
        defect_id: int,
        report_data: NewProductDefectProblemReportCreate,
        created_by: int,
    ):
        defect = await NewProductDefectService.get_defect_by_id(db, defect_id)
        if not defect:
            raise ValueError("New product defect not found")
        if defect.problem_report_id:
            raise ValueError("New product defect already has a problem report")

        report = await ProblemManagementService.create_problem_report(
            db=db,
            report_data=ProblemReportCreate(
                module_key="new_product_quality",
                problem_category_key=report_data.problem_category_key,
                title=report_data.title or defect.defect_description[:500],
                description=report_data.description or defect.remarks,
                risk_level=report_data.risk_level,
                response_mode=report_data.response_mode,
                responsible_dept=defect.responsible_dept,
                assigned_to=report_data.assigned_to,
                due_at=report_data.due_at,
                sources=[
                    ProblemReportSourceCreate(
                        source_type="new_product_defect",
                        source_id=defect.id,
                        source_number=defect.defect_number,
                        is_primary=True,
                    )
                ],
            ),
            created_by=created_by,
            status=ProblemReportStatus.RESPONDING if report_data.response_mode == "eight_d" else ProblemReportStatus.ASSIGNED,
            commit=False,
        )
        defect.problem_report_id = report.id
        defect.status = NewProductDefectStatus.PROMOTED
        defect.updated_at = datetime.utcnow()
        await db.commit()
        await db.refresh(defect)
        await db.refresh(report, attribute_names=["sources"])
        return defect, report
