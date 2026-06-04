"""
Read-only cross-module problem summary service for the first unified issue center slice.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.problem_management import (
    build_8d_number,
    build_issue_number,
    get_audit_type_by_problem_category,
    get_customer_complaint_type_by_problem_category,
    get_problem_category_definition,
    get_problem_category_by_audit_type,
    get_problem_category_by_customer_complaint_type,
    get_problem_category_by_process_context,
    get_problem_category_by_scar_context,
    get_problem_category_by_trial_issue_type,
)
from app.models.audit import AuditExecution, AuditNC, AuditPlan, CustomerAudit
from app.models.customer_complaint import ComplaintStatus, ComplaintType, CustomerComplaint, SeverityLevel
from app.models.eight_d_customer import EightDCustomerComplaintLink
from app.models.problem_report import ProblemReport, ProblemReportSource, ProblemReportStatus, ProblemRiskLevel
from app.models.process_defect import ProcessDefect
from app.models.process_issue import ProcessIssue, ProcessIssueStatus
from app.models.scar import SCAR, SCARStatus
from app.models.supplier import Supplier
from app.models.trial_issue import IssueStatus, TrialIssue
from app.models.user import User, UserStatus, UserType
from app.schemas.problem_management import (
    InternalUserOption,
    ProblemReportBriefResponse,
    ProblemReportClose,
    ProblemReportCreate,
    ProblemReportResponse,
    ProblemReportReview,
    ProblemReportSourcesUpdate,
    ProblemReportSourceResponse,
    ProblemIssueSummaryItem,
    ProblemIssueSummaryListResponse,
    ProblemIssueSummaryQuery,
    UnifiedProblemStatus,
)


class ProblemManagementService:
    """Builds the first shared read-only issue list across confirmed modules."""

    SUPPORTED_MODULE_KEYS = {
        "customer_quality",
        "audit_management",
        "process_quality",
        "incoming_quality",
        "new_product_quality",
    }

    @staticmethod
    def _enum_value(value):
        return value.value if hasattr(value, "value") else value

    @staticmethod
    def _map_customer_severity_risk_level(severity_level: SeverityLevel | str | None) -> str:
        severity = severity_level.value if hasattr(severity_level, "value") else str(severity_level or "")
        if severity == SeverityLevel.CRITICAL.value:
            return "critical"
        if severity == SeverityLevel.MAJOR.value:
            return "high"
        return "medium"

    @staticmethod
    def _format_scar_eight_d_number(scar: SCAR, category_key: str | None = None) -> str:
        category_key = category_key or get_problem_category_by_scar_context(
            scar.material_code,
            scar.defect_description,
            scar.material_category,
        ).key
        created_at = scar.created_at or datetime.utcnow()
        sequence = ((scar.id - 1) % 999) + 1 if scar.id else 1
        return build_8d_number(category_key, sequence, created_at)

    @staticmethod
    async def _next_problem_sequence(
        db: AsyncSession,
        *,
        number_column,
        prefix: str,
        category_key: str,
        occurred_at: datetime | None = None,
    ) -> int:
        current = occurred_at or datetime.utcnow()
        yymm = current.strftime("%y%m")
        number_prefix = f"{prefix}-{category_key}-{yymm}-"
        result = await db.execute(
            select(number_column)
            .where(number_column.like(f"{number_prefix}%"))
            .order_by(number_column.desc())
            .limit(1)
        )
        latest_number = result.scalar_one_or_none()
        if not latest_number:
            return 1
        try:
            return int(str(latest_number).rsplit("-", 1)[-1]) + 1
        except ValueError:
            return 1

    @staticmethod
    async def generate_problem_number(
        db: AsyncSession,
        *,
        category_key: str,
        occurred_at: datetime | None = None,
    ) -> str:
        sequence = await ProblemManagementService._next_problem_sequence(
            db,
            number_column=ProblemReport.problem_number,
            prefix="ZXQ",
            category_key=category_key,
            occurred_at=occurred_at,
        )
        return build_issue_number(category_key=category_key, sequence=sequence, occurred_at=occurred_at)

    @staticmethod
    async def generate_eight_d_number(
        db: AsyncSession,
        *,
        category_key: str,
        occurred_at: datetime | None = None,
    ) -> str:
        sequence = await ProblemManagementService._next_problem_sequence(
            db,
            number_column=ProblemReport.eight_d_number,
            prefix="ZX8D",
            category_key=category_key,
            occurred_at=occurred_at,
        )
        return build_8d_number(category_key=category_key, sequence=sequence, occurred_at=occurred_at)

    @staticmethod
    def build_report_response(report: ProblemReport) -> ProblemReportResponse:
        sources = [
            ProblemReportSourceResponse(
                id=source.id,
                source_type=source.source_type,
                source_id=source.source_id,
                source_parent_id=source.source_parent_id,
                source_number=source.source_number,
                is_primary=source.is_primary,
            )
            for source in (report.sources or [])
        ]
        return ProblemReportResponse(
            id=report.id,
            problem_number=report.problem_number,
            eight_d_number=report.eight_d_number,
            module_key=report.module_key,
            problem_category_key=report.problem_category_key,
            problem_category_label=report.problem_category_label,
            title=report.title,
            description=report.description,
            risk_level=ProblemManagementService._enum_value(report.risk_level),
            response_mode=report.response_mode,
            status=ProblemManagementService._enum_value(report.status),
            responsible_dept=report.responsible_dept,
            assigned_to=report.assigned_to,
            action_owner_id=report.action_owner_id,
            owner_id=report.owner_id,
            created_by=report.created_by,
            verified_by=report.verified_by,
            closed_by=report.closed_by,
            brief_response=report.brief_response,
            due_at=report.due_at,
            reviewed_at=report.reviewed_at,
            closed_at=report.closed_at,
            rejected_reason=report.rejected_reason,
            reopened_count=report.reopened_count,
            created_at=report.created_at,
            updated_at=report.updated_at,
            sources=sources,
        )

    @staticmethod
    async def get_report_by_id(db: AsyncSession, report_id: int) -> ProblemReport | None:
        result = await db.execute(
            select(ProblemReport)
            .options(selectinload(ProblemReport.sources))
            .where(ProblemReport.id == report_id)
        )
        return result.scalar_one_or_none()

    @staticmethod
    async def get_report_for_source(
        db: AsyncSession,
        *,
        source_type: str,
        source_id: int,
    ) -> ProblemReport | None:
        result = await db.execute(
            select(ProblemReport)
            .join(ProblemReportSource, ProblemReportSource.problem_report_id == ProblemReport.id)
            .options(selectinload(ProblemReport.sources))
            .where(
                ProblemReportSource.source_type == source_type,
                ProblemReportSource.source_id == source_id,
            )
            .order_by(ProblemReport.updated_at.desc(), ProblemReport.id.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    @staticmethod
    async def replace_report_sources(
        db: AsyncSession,
        *,
        report_id: int,
        source_data: ProblemReportSourcesUpdate,
    ) -> ProblemReport:
        report = await ProblemManagementService.get_report_by_id(db, report_id)
        if report is None:
            raise ValueError("Problem report not found")

        sources = list(source_data.sources)
        if not any(source.is_primary for source in sources):
            sources[0].is_primary = True

        await db.execute(
            delete(ProblemReportSource).where(ProblemReportSource.problem_report_id == report_id)
        )
        await db.flush()

        for source in sources:
            db.add(
                ProblemReportSource(
                    problem_report_id=report_id,
                    source_type=source.source_type,
                    source_id=source.source_id,
                    source_parent_id=source.source_parent_id,
                    source_number=source.source_number,
                    is_primary=source.is_primary,
                )
            )

        report.updated_at = datetime.utcnow()
        await db.commit()
        db.expire(report, ["sources"])

        updated_report = await ProblemManagementService.get_report_by_id(db, report_id)
        if updated_report is None:
            raise ValueError("Problem report not found after source update")
        return updated_report

    @staticmethod
    async def create_problem_report(
        db: AsyncSession,
        *,
        report_data: ProblemReportCreate,
        created_by: int | None,
        problem_number: str | None = None,
        eight_d_number: str | None = None,
        status: ProblemReportStatus = ProblemReportStatus.OPEN,
        commit: bool = True,
    ) -> ProblemReport:
        category = get_problem_category_definition(report_data.problem_category_key)
        if report_data.module_key and report_data.module_key != category.module_key:
            raise ValueError("module_key does not match problem_category_key")
        if report_data.response_mode not in {"brief", "eight_d"}:
            raise ValueError("response_mode must be brief or eight_d")

        current = datetime.utcnow()
        if problem_number is None:
            problem_number = await ProblemManagementService.generate_problem_number(
                db,
                category_key=category.key,
                occurred_at=current,
            )
        if report_data.response_mode == "eight_d" and eight_d_number is None:
            eight_d_number = await ProblemManagementService.generate_eight_d_number(
                db,
                category_key=category.key,
                occurred_at=current,
            )

        owner_id = report_data.assigned_to or created_by
        report = ProblemReport(
            problem_number=problem_number,
            eight_d_number=eight_d_number,
            module_key=category.module_key,
            problem_category_key=category.key,
            problem_category_label=category.label,
            title=report_data.title,
            description=report_data.description,
            risk_level=ProblemRiskLevel(report_data.risk_level.value if hasattr(report_data.risk_level, "value") else report_data.risk_level),
            response_mode=report_data.response_mode,
            status=status,
            responsible_dept=report_data.responsible_dept,
            assigned_to=report_data.assigned_to,
            action_owner_id=owner_id,
            owner_id=owner_id,
            created_by=created_by,
            due_at=report_data.due_at,
            created_at=current,
            updated_at=current,
        )
        db.add(report)
        await db.flush()

        sources = list(report_data.sources)
        if sources and not any(source.is_primary for source in sources):
            sources[0].is_primary = True

        for source in sources:
            db.add(
                ProblemReportSource(
                    problem_report_id=report.id,
                    source_type=source.source_type,
                    source_id=source.source_id,
                    source_parent_id=source.source_parent_id,
                    source_number=source.source_number,
                    is_primary=source.is_primary,
                )
            )
        await db.flush()

        if commit:
            await db.commit()
            report = await ProblemManagementService.get_report_by_id(db, report.id)
            if report is None:
                raise ValueError("Created problem report could not be loaded")
        return report

    @staticmethod
    async def submit_brief_response(
        db: AsyncSession,
        *,
        report_id: int,
        response_data: ProblemReportBriefResponse,
        user_id: int,
    ) -> ProblemReport:
        report = await ProblemManagementService.get_report_by_id(db, report_id)
        if not report:
            raise ValueError("Problem report not found")
        if report.response_mode != "brief":
            raise ValueError("Only brief reports can use brief response")
        report.brief_response = response_data.model_dump()
        report.status = ProblemReportStatus.PENDING_REVIEW
        report.action_owner_id = report.created_by or report.owner_id
        report.updated_at = datetime.utcnow()
        await db.commit()
        loaded = await ProblemManagementService.get_report_by_id(db, report_id)
        if not loaded:
            raise ValueError("Problem report not found")
        return loaded

    @staticmethod
    async def review_problem_report(
        db: AsyncSession,
        *,
        report_id: int,
        review_data: ProblemReportReview,
        reviewer_id: int,
    ) -> ProblemReport:
        report = await ProblemManagementService.get_report_by_id(db, report_id)
        if not report:
            raise ValueError("Problem report not found")
        report.reviewed_at = datetime.utcnow()
        report.verified_by = reviewer_id
        if review_data.approved:
            report.status = ProblemReportStatus.VERIFYING
            report.action_owner_id = report.created_by or report.owner_id
            report.rejected_reason = None
        else:
            report.status = ProblemReportStatus.REJECTED
            report.action_owner_id = report.assigned_to
            report.rejected_reason = review_data.review_comment
        report.updated_at = datetime.utcnow()
        await db.commit()
        loaded = await ProblemManagementService.get_report_by_id(db, report_id)
        if not loaded:
            raise ValueError("Problem report not found")
        return loaded

    @staticmethod
    async def close_problem_report(
        db: AsyncSession,
        *,
        report_id: int,
        close_data: ProblemReportClose,
        closed_by: int,
    ) -> ProblemReport:
        _ = close_data
        report = await ProblemManagementService.get_report_by_id(db, report_id)
        if not report:
            raise ValueError("Problem report not found")
        report.status = ProblemReportStatus.CLOSED
        report.closed_by = closed_by
        report.closed_at = datetime.utcnow()
        report.action_owner_id = None
        report.updated_at = datetime.utcnow()
        await db.commit()
        loaded = await ProblemManagementService.get_report_by_id(db, report_id)
        if not loaded:
            raise ValueError("Problem report not found")
        return loaded

    @staticmethod
    async def list_internal_user_options(
        db: AsyncSession,
        *,
        keyword: str | None = None,
    ) -> list[InternalUserOption]:
        query = select(User).where(
            User.user_type == UserType.INTERNAL,
            User.status == UserStatus.ACTIVE,
        )

        if keyword:
            like_value = f"%{keyword.strip()}%"
            query = query.where(
                or_(
                    User.username.ilike(like_value),
                    User.full_name.ilike(like_value),
                    User.department.ilike(like_value),
                )
            )

        result = await db.execute(query.order_by(User.department.asc(), User.full_name.asc(), User.username.asc()))
        return [InternalUserOption.model_validate(item) for item in result.scalars().all()]

    @staticmethod
    def _is_actionable_for_current_user(
        item: ProblemIssueSummaryItem,
        *,
        current_user_id: int,
    ) -> bool:
        action_owner_id = item.action_owner_id or item.assigned_to
        if action_owner_id != current_user_id:
            return False

        if item.source_type == "process_issue":
            return item.unified_status in [
                UnifiedProblemStatus.OPEN,
                UnifiedProblemStatus.RESPONDING,
                UnifiedProblemStatus.VERIFYING,
            ]

        if item.source_type == "audit_nc":
            return item.unified_status in [
                UnifiedProblemStatus.ASSIGNED,
                UnifiedProblemStatus.PENDING_REVIEW,
                UnifiedProblemStatus.VERIFYING,
            ]

        if item.source_type == "trial_issue":
            return item.unified_status in [
                UnifiedProblemStatus.OPEN,
                UnifiedProblemStatus.RESPONDING,
                UnifiedProblemStatus.VERIFYING,
            ]

        if item.source_type == "customer_complaint":
            if item.requires_physical_analysis is False:
                return item.unified_status in [UnifiedProblemStatus.OPEN, UnifiedProblemStatus.RESPONDING]
            return item.unified_status == UnifiedProblemStatus.RESPONDING

        if item.source_type == "scar":
            return item.unified_status == UnifiedProblemStatus.PENDING_REVIEW

        return False

    @staticmethod
    def _normalize_customer_unified_status(status: ComplaintStatus | str) -> UnifiedProblemStatus:
        if status == ComplaintStatus.PENDING:
            return UnifiedProblemStatus.OPEN
        if status in [ComplaintStatus.IN_ANALYSIS, ComplaintStatus.IN_RESPONSE]:
            return UnifiedProblemStatus.RESPONDING
        if status == ComplaintStatus.IN_REVIEW:
            return UnifiedProblemStatus.PENDING_REVIEW
        if status == ComplaintStatus.REJECTED:
            return UnifiedProblemStatus.REJECTED
        return UnifiedProblemStatus.CLOSED

    @staticmethod
    def _normalize_audit_unified_status(status: str) -> UnifiedProblemStatus:
        if status == "open":
            return UnifiedProblemStatus.OPEN
        if status == "assigned":
            return UnifiedProblemStatus.ASSIGNED
        if status == "submitted":
            return UnifiedProblemStatus.PENDING_REVIEW
        if status == "verified":
            return UnifiedProblemStatus.VERIFYING
        if status == "rejected":
            return UnifiedProblemStatus.REJECTED
        return UnifiedProblemStatus.CLOSED

    @staticmethod
    def _normalize_process_unified_status(status: ProcessIssueStatus | str) -> UnifiedProblemStatus:
        if status == ProcessIssueStatus.OPEN:
            return UnifiedProblemStatus.OPEN
        if status == ProcessIssueStatus.IN_ANALYSIS:
            return UnifiedProblemStatus.RESPONDING
        if status == ProcessIssueStatus.IN_VERIFICATION:
            return UnifiedProblemStatus.VERIFYING
        return UnifiedProblemStatus.CLOSED

    @staticmethod
    def _normalize_trial_issue_unified_status(status: IssueStatus | str) -> UnifiedProblemStatus:
        if status == IssueStatus.OPEN:
            return UnifiedProblemStatus.OPEN
        if status in [IssueStatus.IN_PROGRESS, IssueStatus.ESCALATED]:
            return UnifiedProblemStatus.RESPONDING
        if status == IssueStatus.RESOLVED:
            return UnifiedProblemStatus.VERIFYING
        return UnifiedProblemStatus.CLOSED

    @staticmethod
    def _normalize_scar_unified_status(status: SCARStatus | str) -> UnifiedProblemStatus:
        if status == SCARStatus.OPEN:
            return UnifiedProblemStatus.OPEN
        if status == SCARStatus.SUPPLIER_RESPONDING:
            return UnifiedProblemStatus.RESPONDING
        if status == SCARStatus.UNDER_REVIEW:
            return UnifiedProblemStatus.PENDING_REVIEW
        if status == SCARStatus.REJECTED:
            return UnifiedProblemStatus.REJECTED
        if status == SCARStatus.APPROVED:
            return UnifiedProblemStatus.APPROVED
        return UnifiedProblemStatus.CLOSED

    @staticmethod
    def _normalize_report_unified_status(status: ProblemReportStatus | str) -> UnifiedProblemStatus:
        raw_status = status.value if hasattr(status, "value") else str(status)
        return UnifiedProblemStatus(raw_status)

    @staticmethod
    def _formal_source_label(source_type: str, category_key: str | None = None) -> str:
        labels = {
            "customer_complaint": "客诉问题跟进",
            "process_issue": "制程问题跟进",
            "process_defect": "制程不良登记",
            "trial_issue": "新品问题跟进",
            "new_product_defect": "新品不良登记",
            "audit_nc": "客户审核问题" if category_key == "AQ3" else "审核问题跟进",
            "scar": "SCAR问题跟进",
        }
        return labels.get(source_type, "问题跟进")

    @staticmethod
    async def _list_formal_problem_report_items(
        db: AsyncSession,
        query: ProblemIssueSummaryQuery,
    ) -> list[ProblemIssueSummaryItem]:
        conditions = []
        if query.module_key:
            conditions.append(ProblemReport.module_key == query.module_key)
        if query.problem_category_key:
            conditions.append(ProblemReport.problem_category_key == query.problem_category_key)
        if query.risk_level:
            conditions.append(ProblemReport.risk_level == query.risk_level)
        if query.response_mode:
            conditions.append(ProblemReport.response_mode == query.response_mode)

        stmt = select(ProblemReport).options(selectinload(ProblemReport.sources))
        if conditions:
            stmt = stmt.where(and_(*conditions))
        stmt = stmt.order_by(ProblemReport.updated_at.desc(), ProblemReport.created_at.desc())

        result = await db.execute(stmt)
        reports = result.scalars().unique().all()
        now = datetime.utcnow()
        keyword = query.keyword.strip().lower() if query.keyword else None
        customer_audit_names: dict[int, str] = {}
        customer_audit_ids = {
            source.source_parent_id
            for report in reports
            for source in (report.sources or [])
            if source.source_type == "audit_nc"
            and report.problem_category_key == "AQ3"
            and source.source_parent_id
        }
        if customer_audit_ids:
            customer_audit_result = await db.execute(
                select(CustomerAudit.id, CustomerAudit.customer_name).where(CustomerAudit.id.in_(customer_audit_ids))
            )
            customer_audit_names = {
                row.id: row.customer_name
                for row in customer_audit_result.all()
            }

        items: list[ProblemIssueSummaryItem] = []
        for report in reports:
            source_values = [
                report.problem_number,
                report.eight_d_number,
                report.title,
                report.description,
                *(source.source_number for source in (report.sources or [])),
            ]
            if keyword and not any(keyword in str(value).lower() for value in source_values if value):
                continue

            unified_status = ProblemManagementService._normalize_report_unified_status(report.status)
            if query.unified_status and unified_status != query.unified_status:
                continue

            sources = list(report.sources or [])
            primary_source = next((source for source in sources if source.is_primary), sources[0] if sources else None)
            source_type = primary_source.source_type if primary_source else "problem_report"
            source_id = primary_source.source_id if primary_source else report.id
            source_parent_id = primary_source.source_parent_id if primary_source else None
            customer_name = (
                customer_audit_names.get(source_parent_id)
                if source_type == "audit_nc" and report.problem_category_key == "AQ3" and source_parent_id
                else None
            )
            is_overdue = bool(
                report.due_at
                and report.due_at < now
                and report.status not in [ProblemReportStatus.CLOSED, ProblemReportStatus.REJECTED]
            )

            items.append(
                ProblemIssueSummaryItem(
                    source_type=source_type,
                    source_id=source_id,
                    source_parent_id=source_parent_id,
                    source_label=ProblemManagementService._formal_source_label(
                        source_type,
                        report.problem_category_key,
                    ),
                    problem_report_id=report.id,
                    problem_number=report.problem_number,
                    eight_d_number=report.eight_d_number,
                    risk_level=ProblemManagementService._enum_value(report.risk_level),
                    module_key=report.module_key,
                    problem_category_key=report.problem_category_key,
                    problem_category_label=report.problem_category_label,
                    reference_no=report.problem_number,
                    title=report.title,
                    raw_status=ProblemManagementService._enum_value(report.status),
                    unified_status=unified_status,
                    responsible_dept=report.responsible_dept,
                    assigned_to=report.assigned_to,
                    action_owner_id=report.action_owner_id or report.assigned_to,
                    created_by_id=report.created_by,
                    owner_id=report.owner_id,
                    verified_by=report.verified_by,
                    response_mode=report.response_mode,
                    customer_name=customer_name,
                    is_overdue=is_overdue,
                    due_at=report.due_at,
                    created_at=report.created_at,
                    updated_at=report.updated_at,
                )
            )

        return items

    @staticmethod
    async def _list_customer_quality_items(
        db: AsyncSession,
        query: ProblemIssueSummaryQuery,
    ) -> list[ProblemIssueSummaryItem]:
        conditions = []

        if query.problem_category_key:
            try:
                complaint_type = get_customer_complaint_type_by_problem_category(query.problem_category_key)
            except ValueError:
                return []
            conditions.append(CustomerComplaint.complaint_type == ComplaintType(complaint_type))

        if query.keyword:
            like_value = f"%{query.keyword.strip()}%"
            conditions.append(
                or_(
                    CustomerComplaint.complaint_number.ilike(like_value),
                    CustomerComplaint.customer_code.ilike(like_value),
                    CustomerComplaint.customer_name_snapshot.ilike(like_value),
                    CustomerComplaint.defect_description.ilike(like_value),
                )
            )

        stmt = select(CustomerComplaint).options(
            selectinload(CustomerComplaint.eight_d_report),
            selectinload(CustomerComplaint.eight_d_links).selectinload(EightDCustomerComplaintLink.report),
        )
        if conditions:
            stmt = stmt.where(and_(*conditions))
        stmt = stmt.order_by(CustomerComplaint.updated_at.desc(), CustomerComplaint.created_at.desc())

        result = await db.execute(stmt)
        complaints = result.scalars().all()

        items: list[ProblemIssueSummaryItem] = []
        for complaint in complaints:
            unified_status = ProblemManagementService._normalize_customer_unified_status(complaint.status)
            if query.unified_status and unified_status != query.unified_status:
                continue

            category = get_problem_category_by_customer_complaint_type(complaint.complaint_type.value)
            response_mode = "eight_d" if complaint.eight_d_report_id else "brief"
            customer_name = complaint.customer_name_snapshot or complaint.customer_code

            items.append(
                ProblemIssueSummaryItem(
                    source_type="customer_complaint",
                    source_id=complaint.id,
                    source_label="客诉台账",
                    risk_level=ProblemManagementService._map_customer_severity_risk_level(
                        complaint.severity_level
                    ),
                    module_key="customer_quality",
                    problem_category_key=category.key,
                    problem_category_label=category.label,
                    reference_no=complaint.complaint_number,
                    title=complaint.defect_description,
                    raw_status=complaint.status.value,
                    unified_status=unified_status,
                    responsible_dept=complaint.responsible_dept,
                    assigned_to=(
                        complaint.physical_analysis_responsible_user_id
                        if complaint.requires_physical_analysis
                        else complaint.cqe_id or complaint.created_by
                    ),
                    action_owner_id=(
                        complaint.physical_analysis_responsible_user_id
                        if complaint.requires_physical_analysis
                        else complaint.cqe_id or complaint.created_by
                    ),
                    created_by_id=complaint.created_by,
                    owner_id=complaint.cqe_id or complaint.created_by,
                    response_mode=response_mode,
                    customer_name=customer_name,
                    requires_physical_analysis=complaint.requires_physical_analysis,
                    is_overdue=False,
                    due_at=None,
                    created_at=complaint.created_at,
                    updated_at=complaint.updated_at,
                )
            )

        return items

    @staticmethod
    async def _list_audit_management_items(
        db: AsyncSession,
        query: ProblemIssueSummaryQuery,
    ) -> list[ProblemIssueSummaryItem]:
        conditions = []

        if query.keyword:
            like_value = f"%{query.keyword.strip()}%"
            conditions.append(
                or_(
                    AuditNC.nc_item.ilike(like_value),
                    AuditNC.nc_description.ilike(like_value),
                    AuditNC.responsible_dept.ilike(like_value),
                )
            )

        stmt = (
            select(
                AuditNC,
                AuditPlan.audit_type,
                AuditExecution.auditor_id,
                CustomerAudit.id.label("customer_audit_id"),
                CustomerAudit.customer_name.label("customer_audit_name"),
            )
            .outerjoin(AuditExecution, AuditExecution.id == AuditNC.audit_id)
            .outerjoin(AuditPlan, AuditPlan.id == AuditExecution.audit_plan_id)
            .outerjoin(CustomerAudit, CustomerAudit.id == -AuditNC.audit_id)
        )
        if conditions:
            stmt = stmt.where(and_(*conditions))
        stmt = stmt.order_by(AuditNC.updated_at.desc(), AuditNC.created_at.desc())

        result = await db.execute(stmt)
        rows = result.all()
        now = datetime.utcnow()

        items: list[ProblemIssueSummaryItem] = []
        for nc, audit_type, auditor_id, customer_audit_id, customer_audit_name in rows:
            resolved_audit_type = audit_type or ("customer_audit" if customer_audit_id else None)
            if not resolved_audit_type:
                continue

            unified_status = ProblemManagementService._normalize_audit_unified_status(nc.verification_status)
            if query.unified_status and unified_status != query.unified_status:
                continue

            category = get_problem_category_by_audit_type(resolved_audit_type)
            if query.problem_category_key and category.key != query.problem_category_key:
                continue
            is_overdue = nc.deadline < now and nc.verification_status not in ["closed", "verified"]
            action_owner_id = nc.assigned_to
            if unified_status in [UnifiedProblemStatus.PENDING_REVIEW, UnifiedProblemStatus.VERIFYING]:
                action_owner_id = auditor_id or nc.created_by

            source_label = "客户审核问题" if customer_audit_id else "审核 NC"

            items.append(
                ProblemIssueSummaryItem(
                    source_type="audit_nc",
                    source_id=nc.id,
                    source_parent_id=customer_audit_id,
                    source_label=source_label,
                    risk_level="medium",
                    module_key="audit_management",
                    problem_category_key=category.key,
                    problem_category_label=category.label,
                    reference_no=f"NC-{nc.id}",
                    title=nc.nc_description,
                    raw_status=nc.verification_status,
                    unified_status=unified_status,
                    responsible_dept=nc.responsible_dept,
                    assigned_to=nc.assigned_to,
                    action_owner_id=action_owner_id,
                    created_by_id=nc.created_by,
                    owner_id=nc.created_by,
                    verified_by=nc.verified_by,
                    response_mode="brief",
                    customer_name=customer_audit_name,
                    is_overdue=is_overdue,
                    due_at=nc.deadline,
                    created_at=nc.created_at,
                    updated_at=nc.updated_at,
                )
            )

        return items

    @staticmethod
    async def _list_process_quality_items(
        db: AsyncSession,
        query: ProblemIssueSummaryQuery,
    ) -> list[ProblemIssueSummaryItem]:
        conditions = []

        if query.keyword:
            like_value = f"%{query.keyword.strip()}%"
            conditions.append(
                or_(
                    ProcessIssue.issue_number.ilike(like_value),
                    ProcessIssue.issue_description.ilike(like_value),
                    ProcessIssue.responsibility_category.ilike(like_value),
                )
            )

        stmt = select(ProcessIssue)
        if conditions:
            stmt = stmt.where(and_(*conditions))
        stmt = stmt.order_by(ProcessIssue.updated_at.desc(), ProcessIssue.created_at.desc())

        result = await db.execute(stmt)
        issues = result.scalars().all()

        related_defect_ids: set[int] = set()
        for issue in issues:
            if not issue.related_defect_ids:
                continue
            for value in issue.related_defect_ids.split(","):
                value = value.strip()
                if value.isdigit():
                    related_defect_ids.add(int(value))

        defect_context_by_id: dict[int, tuple[str | None, str | None]] = {}
        if related_defect_ids:
            defect_result = await db.execute(
                select(ProcessDefect.id, ProcessDefect.process_id, ProcessDefect.line_id).where(
                    ProcessDefect.id.in_(related_defect_ids)
                )
            )
            defect_context_by_id = {
                row.id: (row.process_id, row.line_id)
                for row in defect_result.all()
            }

        items: list[ProblemIssueSummaryItem] = []
        for issue in issues:
            unified_status = ProblemManagementService._normalize_process_unified_status(issue.status)
            if query.unified_status and unified_status != query.unified_status:
                continue

            process_context_values: list[str | None] = [issue.issue_number, issue.issue_description]
            if issue.related_defect_ids:
                for value in issue.related_defect_ids.split(","):
                    value = value.strip()
                    if not value.isdigit():
                        continue
                    process_id, line_id = defect_context_by_id.get(int(value), (None, None))
                    process_context_values.extend([process_id, line_id])

            category = get_problem_category_by_process_context(*process_context_values)
            if query.problem_category_key and category.key != query.problem_category_key:
                continue

            due_at = None
            if issue.verification_end_date:
                due_at = datetime.combine(issue.verification_end_date, datetime.min.time())

            items.append(
                ProblemIssueSummaryItem(
                    source_type="process_issue",
                    source_id=issue.id,
                    source_label="制程问题单",
                    risk_level="medium",
                    module_key="process_quality",
                    problem_category_key=category.key,
                    problem_category_label=category.label,
                    reference_no=issue.issue_number,
                    title=issue.issue_description,
                    raw_status=issue.status.value if hasattr(issue.status, "value") else str(issue.status),
                    unified_status=unified_status,
                    responsible_dept=issue.responsibility_category,
                    assigned_to=issue.assigned_to,
                    action_owner_id=issue.assigned_to,
                    created_by_id=issue.created_by,
                    owner_id=issue.created_by,
                    verified_by=issue.verified_by,
                    response_mode="brief",
                    customer_name=None,
                    is_overdue=issue.is_overdue(),
                    due_at=due_at,
                    created_at=issue.created_at,
                    updated_at=issue.updated_at,
                )
            )

        return items

    @staticmethod
    async def _list_new_product_quality_items(
        db: AsyncSession,
        query: ProblemIssueSummaryQuery,
    ) -> list[ProblemIssueSummaryItem]:
        if query.problem_category_key and query.problem_category_key != "DQ0":
            return []

        conditions = []

        if query.keyword:
            like_value = f"%{query.keyword.strip()}%"
            conditions.append(
                or_(
                    TrialIssue.issue_number.ilike(like_value),
                    TrialIssue.issue_description.ilike(like_value),
                    TrialIssue.assigned_dept.ilike(like_value),
                )
            )

        stmt = select(TrialIssue)
        if conditions:
            stmt = stmt.where(and_(*conditions))
        stmt = stmt.order_by(TrialIssue.updated_at.desc(), TrialIssue.created_at.desc())

        result = await db.execute(stmt)
        issues = result.scalars().all()
        now = datetime.utcnow()

        items: list[ProblemIssueSummaryItem] = []
        for issue in issues:
            unified_status = ProblemManagementService._normalize_trial_issue_unified_status(issue.status)
            if query.unified_status and unified_status != query.unified_status:
                continue

            category = get_problem_category_by_trial_issue_type(
                issue.issue_type.value if hasattr(issue.issue_type, "value") else str(issue.issue_type)
            )
            response_mode = "eight_d" if issue.is_escalated_to_8d else "brief"
            is_overdue = bool(
                issue.deadline and issue.deadline < now and issue.status not in [IssueStatus.RESOLVED, IssueStatus.CLOSED]
            )

            items.append(
                ProblemIssueSummaryItem(
                    source_type="trial_issue",
                    source_id=issue.id,
                    source_label="试产问题单",
                    risk_level="medium",
                    module_key="new_product_quality",
                    problem_category_key=category.key,
                    problem_category_label=category.label,
                    reference_no=issue.issue_number,
                    title=issue.issue_description,
                    raw_status=issue.status.value if hasattr(issue.status, "value") else str(issue.status),
                    unified_status=unified_status,
                    responsible_dept=issue.assigned_dept,
                    assigned_to=issue.assigned_to,
                    action_owner_id=issue.assigned_to,
                    created_by_id=issue.created_by,
                    owner_id=issue.created_by,
                    verified_by=issue.verified_by,
                    response_mode=response_mode,
                    customer_name=None,
                    is_overdue=is_overdue,
                    due_at=issue.deadline,
                    created_at=issue.created_at,
                    updated_at=issue.updated_at,
                )
            )

        return items

    @staticmethod
    async def _list_incoming_quality_items(
        db: AsyncSession,
        query: ProblemIssueSummaryQuery,
    ) -> list[ProblemIssueSummaryItem]:
        conditions = []

        if query.keyword:
            like_value = f"%{query.keyword.strip()}%"
            conditions.append(
                or_(
                    SCAR.scar_number.ilike(like_value),
                    SCAR.material_code.ilike(like_value),
                    SCAR.defect_description.ilike(like_value),
                    Supplier.name.ilike(like_value),
                )
            )

        stmt = select(SCAR, Supplier.name).outerjoin(Supplier, Supplier.id == SCAR.supplier_id)
        if conditions:
            stmt = stmt.where(and_(*conditions))
        stmt = stmt.order_by(SCAR.updated_at.desc(), SCAR.created_at.desc())

        result = await db.execute(stmt)
        rows = result.all()
        now = datetime.utcnow()

        items: list[ProblemIssueSummaryItem] = []
        for scar, supplier_name in rows:
            unified_status = ProblemManagementService._normalize_scar_unified_status(scar.status)
            if query.unified_status and unified_status != query.unified_status:
                continue

            category = get_problem_category_by_scar_context(
                scar.material_code,
                scar.defect_description,
                supplier_name,
            )
            if query.problem_category_key and category.key != query.problem_category_key:
                continue

            is_overdue = bool(
                scar.deadline and scar.deadline < now and scar.status not in [SCARStatus.APPROVED, SCARStatus.CLOSED]
            )

            items.append(
                ProblemIssueSummaryItem(
                    source_type="scar",
                    source_id=scar.id,
                    source_label="SCAR单",
                    module_key="incoming_quality",
                    problem_category_key=category.key,
                    problem_category_label=category.label,
                    eight_d_number=ProblemManagementService._format_scar_eight_d_number(scar, category.key),
                    risk_level=ProblemManagementService._enum_value(scar.severity),
                    reference_no=scar.scar_number,
                    title=scar.defect_description,
                    raw_status=scar.status.value if hasattr(scar.status, "value") else str(scar.status),
                    unified_status=unified_status,
                    responsible_dept=None,
                    assigned_to=scar.current_handler_id,
                    action_owner_id=scar.current_handler_id,
                    created_by_id=scar.created_by,
                    owner_id=scar.created_by,
                    response_mode="eight_d",
                    customer_name=supplier_name,
                    is_overdue=is_overdue,
                    due_at=scar.deadline,
                    created_at=scar.created_at,
                    updated_at=scar.updated_at,
                )
            )

        return items

    @staticmethod
    async def list_problem_issue_summaries(
        db: AsyncSession,
        current_user: User,
        query: ProblemIssueSummaryQuery,
    ) -> ProblemIssueSummaryListResponse:
        if current_user.user_type != UserType.INTERNAL:
            return ProblemIssueSummaryListResponse(
                total=0,
                page=query.page,
                page_size=query.page_size,
                items=[],
            )

        if query.module_key and query.module_key not in ProblemManagementService.SUPPORTED_MODULE_KEYS:
            return ProblemIssueSummaryListResponse(
                total=0,
                page=query.page,
                page_size=query.page_size,
                items=[],
            )

        items: list[ProblemIssueSummaryItem] = []
        formal_items = await ProblemManagementService._list_formal_problem_report_items(db, query)
        mapped_sources = {
            (item.source_type, item.source_id)
            for item in formal_items
            if item.source_type != "problem_report"
        }
        items.extend(formal_items)

        def without_formal_duplicates(legacy_items: list[ProblemIssueSummaryItem]) -> list[ProblemIssueSummaryItem]:
            return [
                item
                for item in legacy_items
                if (item.source_type, item.source_id) not in mapped_sources
            ]

        if query.module_key in [None, "customer_quality"]:
            items.extend(
                without_formal_duplicates(await ProblemManagementService._list_customer_quality_items(db, query))
            )

        if query.module_key in [None, "audit_management"]:
            items.extend(
                without_formal_duplicates(await ProblemManagementService._list_audit_management_items(db, query))
            )

        if query.module_key in [None, "process_quality"]:
            items.extend(
                without_formal_duplicates(await ProblemManagementService._list_process_quality_items(db, query))
            )

        if query.module_key in [None, "incoming_quality"]:
            items.extend(
                without_formal_duplicates(await ProblemManagementService._list_incoming_quality_items(db, query))
            )

        if query.module_key in [None, "new_product_quality"]:
            items.extend(
                without_formal_duplicates(await ProblemManagementService._list_new_product_quality_items(db, query))
            )

        if query.risk_level:
            items = [item for item in items if item.risk_level == query.risk_level]

        if query.response_mode:
            items = [item for item in items if item.response_mode == query.response_mode]

        if query.only_assigned_to_me:
            items = [item for item in items if item.assigned_to == current_user.id]

        if query.only_actionable_to_me:
            items = [
                item
                for item in items
                if ProblemManagementService._is_actionable_for_current_user(
                    item,
                    current_user_id=current_user.id,
                )
            ]

        if query.only_created_by_me:
            items = [item for item in items if item.created_by_id == current_user.id]

        if query.only_overdue:
            items = [item for item in items if item.is_overdue]

        items.sort(key=lambda item: (item.updated_at, item.created_at), reverse=True)

        module_counts: dict[str, int] = {}
        for item in items:
            module_counts[item.module_key] = module_counts.get(item.module_key, 0) + 1

        total = len(items)
        offset = (query.page - 1) * query.page_size
        page_items = items[offset : offset + query.page_size]

        return ProblemIssueSummaryListResponse(
            total=total,
            page=query.page,
            page_size=query.page_size,
            module_counts=module_counts,
            items=page_items,
        )
