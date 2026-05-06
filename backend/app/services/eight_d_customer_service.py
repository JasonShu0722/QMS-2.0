"""Customer 8D report service."""

from datetime import datetime
import logging
from typing import Optional

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.problem_management import build_8d_number, get_problem_category_by_customer_complaint_type
from app.models.customer_complaint import ComplaintType, CustomerComplaint, ComplaintStatus, PhysicalAnalysisStatus, SeverityLevel
from app.models.eight_d_customer import EightDCustomer, EightDCustomerComplaintLink, EightDStatus, ApprovalLevel
from app.models.lesson_learned import LessonLearned, SourceType
from app.schemas.eight_d_customer import D4D7Request, D8Request, EightDReviewRequest, SLAStatus

logger = logging.getLogger(__name__)


class EightDCustomerService:
    """Service layer for customer 8D reports."""

    @staticmethod
    def _report_query():
        return select(EightDCustomer).options(
            selectinload(EightDCustomer.complaint),
            selectinload(EightDCustomer.complaint_links).selectinload(EightDCustomerComplaintLink.complaint),
        )

    @staticmethod
    async def get_by_id(db: AsyncSession, report_id: int) -> Optional[EightDCustomer]:
        result = await db.execute(
            EightDCustomerService._report_query().where(EightDCustomer.id == report_id)
        )
        return result.scalar_one_or_none()

    @staticmethod
    async def get_by_complaint_id(db: AsyncSession, complaint_id: int) -> Optional[EightDCustomer]:
        """Fetch an 8D report by any linked complaint id."""

        result = await db.execute(
            EightDCustomerService._report_query()
            .outerjoin(
                EightDCustomerComplaintLink,
                EightDCustomerComplaintLink.report_id == EightDCustomer.id,
            )
            .where(
                or_(
                    EightDCustomer.complaint_id == complaint_id,
                    EightDCustomerComplaintLink.complaint_id == complaint_id,
                )
            )
        )
        return result.scalars().unique().first()

    @staticmethod
    def _get_related_complaints(report: EightDCustomer) -> list[CustomerComplaint]:
        complaints: dict[int, CustomerComplaint] = {}
        if report.complaint is not None:
            complaints[report.complaint.id] = report.complaint
        for link in report.complaint_links or []:
            if link.complaint is not None:
                complaints[link.complaint.id] = link.complaint
        return list(complaints.values())

    @staticmethod
    def _get_primary_complaint(report: EightDCustomer) -> CustomerComplaint:
        for link in report.complaint_links or []:
            if link.is_primary and link.complaint is not None:
                return link.complaint

        if report.complaint is not None:
            return report.complaint

        raise ValueError("8D 报告缺少主客诉记录")

    @staticmethod
    def _ensure_scope_editable(report: EightDCustomer) -> None:
        if report.status != EightDStatus.D4_D7_IN_PROGRESS:
            raise ValueError("当前仅支持在 D4-D7 进行中阶段调整 8D 关联范围")

    @staticmethod
    def _build_fallback_report_number(report: EightDCustomer) -> str:
        primary_complaint = EightDCustomerService._get_primary_complaint(report)
        category_key = get_problem_category_by_customer_complaint_type(primary_complaint.complaint_type.value).key
        return build_8d_number(category_key=category_key, sequence=report.id, occurred_at=report.created_at)

    @staticmethod
    async def _generate_report_number(
        db: AsyncSession,
        primary_complaint: CustomerComplaint,
    ) -> str:
        category_key = get_problem_category_by_customer_complaint_type(primary_complaint.complaint_type.value).key
        current = datetime.utcnow()
        yymm = current.strftime("%y%m")
        prefix = f"ZX8D-{category_key}-{yymm}-"

        result = await db.execute(
            select(EightDCustomer.report_number)
            .where(EightDCustomer.report_number.like(f"{prefix}%"))
            .order_by(EightDCustomer.report_number.desc())
            .limit(1)
        )
        latest_report_number = result.scalar_one_or_none()

        if latest_report_number:
            try:
                sequence = int(str(latest_report_number).rsplit("-", 1)[-1]) + 1
            except ValueError:
                sequence = 1
        else:
            sequence = 1

        return build_8d_number(
            category_key=category_key,
            sequence=sequence,
            occurred_at=current,
        )

    @staticmethod
    def _sync_d0_d3_scope_metadata(report: EightDCustomer, complaints: list[CustomerComplaint]) -> None:
        primary_complaint = EightDCustomerService._get_primary_complaint(report)
        existing_payload = dict(report.d0_d3_cqe or {})
        existing_payload.update(
            {
                "source_complaint_number": primary_complaint.complaint_number,
                "source_complaint_numbers": [item.complaint_number for item in complaints],
                "source_complaint_ids": [item.id for item in complaints],
                "related_complaint_count": len(complaints),
                "containment_customer": any(item.is_return_required for item in complaints),
            }
        )
        report.d0_d3_cqe = existing_payload

    @staticmethod
    def _validate_scope_candidate(
        candidate: CustomerComplaint,
        baseline: CustomerComplaint,
        report: EightDCustomer,
    ) -> None:
        if candidate.id == report.complaint_id:
            raise ValueError("当前客诉已经是该 8D 的主客诉")

        if candidate.complaint_type != baseline.complaint_type:
            raise ValueError("追加关联客诉仅支持与当前 8D 相同客诉类型的记录")

        baseline_customer_signature = (baseline.customer_id or 0, baseline.customer_code)
        candidate_customer_signature = (candidate.customer_id or 0, candidate.customer_code)
        if candidate_customer_signature != baseline_customer_signature:
            raise ValueError("追加关联客诉仅支持同一客户的记录")

        EightDCustomerService._validate_complaint_ready_for_init(candidate)

    @staticmethod
    def _validate_complaint_ready_for_init(complaint: CustomerComplaint) -> None:
        if complaint.status == ComplaintStatus.CLOSED:
            raise ValueError(f"客诉单 {complaint.complaint_number} 已关闭，不能再发起 8D")

        if (
            complaint.requires_physical_analysis
            and complaint.physical_analysis_status != PhysicalAnalysisStatus.COMPLETED
        ):
            raise ValueError(f"客诉单 {complaint.complaint_number} 尚未完成实物解析，不能发起 8D")

        if not complaint.requires_physical_analysis and not complaint.physical_disposition_plan:
            raise ValueError(f"客诉单 {complaint.complaint_number} 尚未完成实物处理方案备案，不能发起 8D")

    @staticmethod
    def _build_initial_d0_d3(
        primary_complaint: CustomerComplaint,
        complaints: list[CustomerComplaint],
    ) -> dict:
        return {
            "problem_description": primary_complaint.defect_description,
            "containment_actions": (
                primary_complaint.physical_disposition_plan
                or primary_complaint.physical_analysis_summary
                or ""
            ),
            "containment_in_transit": False,
            "containment_inventory": False,
            "containment_customer": any(item.is_return_required for item in complaints),
            "root_cause_initial": primary_complaint.physical_analysis_summary or "",
            "source_complaint_number": primary_complaint.complaint_number,
            "source_complaint_numbers": [item.complaint_number for item in complaints],
            "source_complaint_ids": [item.id for item in complaints],
            "related_complaint_count": len(complaints),
        }

    @staticmethod
    async def init_report(
        db: AsyncSession,
        complaint_id: int,
        user_id: int,
    ) -> EightDCustomer:
        return await EightDCustomerService.init_report_batch(
            db=db,
            complaint_ids=[complaint_id],
            primary_complaint_id=complaint_id,
            user_id=user_id,
        )

    @staticmethod
    async def init_report_batch(
        db: AsyncSession,
        complaint_ids: list[int],
        user_id: int,
        primary_complaint_id: Optional[int] = None,
    ) -> EightDCustomer:
        normalized_ids = list(dict.fromkeys(complaint_ids))
        if not normalized_ids:
            raise ValueError("请至少选择一条客诉记录发起 8D")

        if primary_complaint_id is None:
            primary_complaint_id = normalized_ids[0]

        if primary_complaint_id not in normalized_ids:
            raise ValueError("主客诉记录必须包含在发起范围内")

        complaint_result = await db.execute(
            select(CustomerComplaint).where(CustomerComplaint.id.in_(normalized_ids))
        )
        complaints = list(complaint_result.scalars().all())
        complaints_by_id = {complaint.id: complaint for complaint in complaints}

        if len(complaints_by_id) != len(normalized_ids):
            missing_ids = [complaint_id for complaint_id in normalized_ids if complaint_id not in complaints_by_id]
            raise ValueError(f"存在未找到的客诉记录: {missing_ids}")

        ordered_complaints = [complaints_by_id[complaint_id] for complaint_id in normalized_ids]
        primary_complaint = complaints_by_id[primary_complaint_id]
        baseline_complaint = ordered_complaints[0]
        baseline_customer_signature = (
            baseline_complaint.customer_id or 0,
            baseline_complaint.customer_code,
        )

        for complaint in ordered_complaints:
            if complaint.complaint_type != baseline_complaint.complaint_type:
                raise ValueError("聚合发起 8D 仅支持相同客诉类型的记录")

            current_customer_signature = (complaint.customer_id or 0, complaint.customer_code)
            if current_customer_signature != baseline_customer_signature:
                raise ValueError("聚合发起 8D 仅支持同一客户的客诉记录")

            EightDCustomerService._validate_complaint_ready_for_init(complaint)

        existing_reports: dict[int, EightDCustomer] = {}
        for complaint in ordered_complaints:
            existing_report = await EightDCustomerService.get_by_complaint_id(db=db, complaint_id=complaint.id)
            if existing_report is not None:
                existing_reports[complaint.id] = existing_report

        unique_existing_reports = {report.id: report for report in existing_reports.values()}
        if len(normalized_ids) == 1 and len(unique_existing_reports) == 1:
            return next(iter(unique_existing_reports.values()))

        if existing_reports and len(unique_existing_reports) == 1 and set(existing_reports.keys()) == set(normalized_ids):
            return next(iter(unique_existing_reports.values()))

        if existing_reports:
            conflict_numbers = [complaints_by_id[complaint_id].complaint_number for complaint_id in existing_reports]
            raise ValueError(f"选中的客诉中存在已关联 8D 的记录: {', '.join(conflict_numbers)}")

        eight_d = EightDCustomer(
            complaint_id=primary_complaint.id,
            report_number=await EightDCustomerService._generate_report_number(db=db, primary_complaint=primary_complaint),
            d0_d3_cqe=EightDCustomerService._build_initial_d0_d3(
                primary_complaint=primary_complaint,
                complaints=ordered_complaints,
            ),
            status=EightDStatus.D4_D7_IN_PROGRESS,
            approval_level=ApprovalLevel.NONE,
        )
        db.add(eight_d)
        await db.flush()

        for complaint in ordered_complaints:
            db.add(
                EightDCustomerComplaintLink(
                    report_id=eight_d.id,
                    complaint_id=complaint.id,
                    is_primary=complaint.id == primary_complaint.id,
                )
            )
            if complaint.status in [ComplaintStatus.PENDING, ComplaintStatus.IN_ANALYSIS]:
                complaint.status = ComplaintStatus.IN_RESPONSE

        await db.commit()

        logger.info(
            "Initialized customer 8D report %s from complaints %s by user %s",
            eight_d.id,
            normalized_ids,
            user_id,
        )
        return await EightDCustomerService.get_by_id(db=db, report_id=eight_d.id)

    @staticmethod
    async def append_related_complaints(
        db: AsyncSession,
        complaint_id: int,
        complaint_ids: list[int],
        user_id: int,
    ) -> EightDCustomer:
        eight_d = await EightDCustomerService.get_by_complaint_id(db=db, complaint_id=complaint_id)
        if not eight_d:
            raise ValueError(f"客诉单 {complaint_id} 的 8D 报告不存在")

        EightDCustomerService._ensure_scope_editable(eight_d)
        normalized_ids = [item for item in dict.fromkeys(complaint_ids) if item != complaint_id]
        if not normalized_ids:
            raise ValueError("请至少选择一条可追加的客诉记录")

        primary_complaint = EightDCustomerService._get_primary_complaint(eight_d)
        related_complaints = EightDCustomerService._get_related_complaints(eight_d)
        related_ids = {item.id for item in related_complaints}

        append_ids = [item for item in normalized_ids if item not in related_ids]
        if not append_ids:
            raise ValueError("所选客诉已全部包含在当前 8D 关联范围中")

        complaint_result = await db.execute(
            select(CustomerComplaint).where(CustomerComplaint.id.in_(append_ids))
        )
        append_candidates = list(complaint_result.scalars().all())
        candidates_by_id = {item.id: item for item in append_candidates}
        if len(candidates_by_id) != len(append_ids):
            missing_ids = [item for item in append_ids if item not in candidates_by_id]
            raise ValueError(f"存在未找到的客诉记录: {missing_ids}")

        ordered_candidates = [candidates_by_id[item] for item in append_ids]
        for candidate in ordered_candidates:
            EightDCustomerService._validate_scope_candidate(candidate=candidate, baseline=primary_complaint, report=eight_d)
            existing_report = await EightDCustomerService.get_by_complaint_id(db=db, complaint_id=candidate.id)
            if existing_report is not None and existing_report.id != eight_d.id:
                raise ValueError(f"客诉 {candidate.complaint_number} 已关联其他 8D 报告")

        for candidate in ordered_candidates:
            db.add(
                EightDCustomerComplaintLink(
                    report_id=eight_d.id,
                    complaint_id=candidate.id,
                    is_primary=False,
                )
            )
            if candidate.status in [ComplaintStatus.PENDING, ComplaintStatus.IN_ANALYSIS]:
                candidate.status = ComplaintStatus.IN_RESPONSE

        EightDCustomerService._sync_d0_d3_scope_metadata(
            report=eight_d,
            complaints=[*related_complaints, *ordered_candidates],
        )
        report_id = eight_d.id
        await db.commit()
        db.expire_all()

        logger.info(
            "Appended complaints %s into customer 8D %s by user %s",
            append_ids,
            report_id,
            user_id,
        )
        return await EightDCustomerService.get_by_id(db=db, report_id=report_id)

    @staticmethod
    async def remove_related_complaint(
        db: AsyncSession,
        complaint_id: int,
        linked_complaint_id: int,
        user_id: int,
    ) -> EightDCustomer:
        eight_d = await EightDCustomerService.get_by_complaint_id(db=db, complaint_id=complaint_id)
        if not eight_d:
            raise ValueError(f"客诉单 {complaint_id} 的 8D 报告不存在")

        EightDCustomerService._ensure_scope_editable(eight_d)
        if linked_complaint_id == complaint_id:
            raise ValueError("当前查看客诉不能直接从本页移出 8D 范围")

        target_link = next(
            (
                link
                for link in eight_d.complaint_links or []
                if link.complaint_id == linked_complaint_id
            ),
            None,
        )
        if target_link is None:
            raise ValueError("待移除客诉不在当前 8D 关联范围内")
        if target_link.is_primary or linked_complaint_id == eight_d.complaint_id:
            raise ValueError("主客诉不能直接从 8D 关联范围中移除")

        remaining_complaints = [
            item
            for item in EightDCustomerService._get_related_complaints(eight_d)
            if item.id != linked_complaint_id
        ]
        if not remaining_complaints:
            raise ValueError("8D 关联范围至少需要保留一条客诉")

        await db.delete(target_link)
        EightDCustomerService._sync_d0_d3_scope_metadata(report=eight_d, complaints=remaining_complaints)
        report_id = eight_d.id
        await db.commit()
        db.expire_all()

        logger.info(
            "Removed complaint %s from customer 8D %s by user %s",
            linked_complaint_id,
            report_id,
            user_id,
        )
        return await EightDCustomerService.get_by_id(db=db, report_id=report_id)

    @staticmethod
    async def switch_primary_complaint(
        db: AsyncSession,
        complaint_id: int,
        primary_complaint_id: int,
        user_id: int,
    ) -> EightDCustomer:
        eight_d = await EightDCustomerService.get_by_complaint_id(db=db, complaint_id=complaint_id)
        if not eight_d:
            raise ValueError(f"瀹㈣瘔鍗?{complaint_id} 鐨?8D 鎶ュ憡涓嶅瓨鍦?")

        EightDCustomerService._ensure_scope_editable(eight_d)
        if primary_complaint_id == eight_d.complaint_id:
            raise ValueError("褰撳墠瀹㈣瘔宸茬粡鏄?8D 鐨勪富瀹㈣瘔")

        target_link = next(
            (
                link
                for link in eight_d.complaint_links or []
                if link.complaint_id == primary_complaint_id
            ),
            None,
        )
        if target_link is None or target_link.complaint is None:
            raise ValueError("鏂扮殑涓诲璇夊繀椤诲凡鍖呭惈鍦ㄥ綋鍓?8D 鍏宠仈鑼冨洿鍐?")

        for link in eight_d.complaint_links or []:
            link.is_primary = link.complaint_id == primary_complaint_id

        eight_d.complaint_id = primary_complaint_id
        eight_d.complaint = target_link.complaint
        EightDCustomerService._sync_d0_d3_scope_metadata(
            report=eight_d,
            complaints=EightDCustomerService._get_related_complaints(eight_d),
        )
        report_id = eight_d.id
        await db.commit()
        db.expire_all()

        logger.info(
            "Switched primary complaint to %s for customer 8D %s by user %s",
            primary_complaint_id,
            report_id,
            user_id,
        )
        return await EightDCustomerService.get_by_id(db=db, report_id=report_id)

    @staticmethod
    async def list_reports(
        db: AsyncSession,
        *,
        report_number: Optional[str] = None,
        complaint_type: Optional[str] = None,
        customer_id: Optional[int] = None,
        product_type: Optional[str] = None,
        status: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[EightDCustomer], int]:
        conditions = []

        if report_number:
            conditions.append(EightDCustomer.report_number.ilike(f"%{report_number.strip()}%"))
        if complaint_type:
            conditions.append(CustomerComplaint.complaint_type == ComplaintType(complaint_type))
        if customer_id:
            conditions.append(CustomerComplaint.customer_id == customer_id)
        if product_type:
            conditions.append(CustomerComplaint.product_type.ilike(f"%{product_type.strip()}%"))
        if status:
            conditions.append(EightDCustomer.status == EightDStatus(status))
        if start_date:
            conditions.append(EightDCustomer.created_at >= start_date)
        if end_date:
            conditions.append(EightDCustomer.created_at <= end_date)

        count_query = (
            select(func.count(EightDCustomer.id))
            .select_from(EightDCustomer)
            .join(CustomerComplaint, CustomerComplaint.id == EightDCustomer.complaint_id)
        )
        if conditions:
            count_query = count_query.where(and_(*conditions))

        total = (await db.execute(count_query)).scalar_one()

        query = (
            EightDCustomerService._report_query()
            .join(CustomerComplaint, CustomerComplaint.id == EightDCustomer.complaint_id)
            .order_by(EightDCustomer.updated_at.desc(), EightDCustomer.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        if conditions:
            query = query.where(and_(*conditions))

        result = await db.execute(query)
        reports = list(result.scalars().unique().all())
        return reports, total

    @staticmethod
    def build_report_summary(report: EightDCustomer) -> dict:
        return {
            "id": report.id,
            "complaint_id": report.complaint_id,
            "report_number": report.report_number or EightDCustomerService._build_fallback_report_number(report),
            "primary_complaint_number": report.primary_complaint_number,
            "complaint_type": report.complaint_type,
            "customer_code": report.customer_code,
            "customer_name": report.customer_name,
            "end_customer_name": report.end_customer_name,
            "product_type": report.product_type,
            "related_complaint_count": report.related_complaint_count,
            "status": report.status,
            "approval_level": report.approval_level,
            "created_at": report.created_at,
            "updated_at": report.updated_at,
            "submitted_at": report.submitted_at,
            "reviewed_at": report.reviewed_at,
        }

    @staticmethod
    async def submit_d4_d7(
        db: AsyncSession,
        complaint_id: int,
        data: D4D7Request,
        user_id: int,
    ) -> EightDCustomer:
        eight_d = await EightDCustomerService.get_by_complaint_id(db, complaint_id)
        if not eight_d:
            raise ValueError(f"客诉单 {complaint_id} 的 8D 报告不存在")

        if eight_d.status != EightDStatus.D4_D7_IN_PROGRESS:
            raise ValueError(f"8D 报告状态错误，当前状态为 {eight_d.status}")

        eight_d.d4_d7_responsible = {
            "d4_root_cause": {
                "analysis_method": data.d4_root_cause.analysis_method,
                "root_cause": data.d4_root_cause.root_cause,
                "evidence": data.d4_root_cause.evidence_files,
            },
            "d5_corrective_actions": [
                {
                    "action": action.action,
                    "responsible": action.responsible,
                    "deadline": action.deadline,
                }
                for action in data.d5_corrective_actions
            ],
            "d6_verification": {
                "verification_report": data.d6_verification.verification_report,
                "test_data": data.d6_verification.test_data,
                "result": data.d6_verification.result,
            },
            "d7_standardization": {
                "document_modified": data.d7_standardization.document_modified,
                "modified_files": data.d7_standardization.modified_files,
                "attachments": data.d7_standardization.attachment_paths,
            },
        }
        eight_d.status = EightDStatus.D4_D7_COMPLETED
        eight_d.submitted_at = datetime.utcnow()

        for complaint in EightDCustomerService._get_related_complaints(eight_d):
            complaint.status = ComplaintStatus.IN_REVIEW

        await db.commit()
        logger.info("Submitted D4-D7 for customer 8D %s by user %s", eight_d.id, user_id)
        return await EightDCustomerService.get_by_id(db=db, report_id=eight_d.id)

    @staticmethod
    async def submit_d8(
        db: AsyncSession,
        complaint_id: int,
        data: D8Request,
        user_id: int,
    ) -> EightDCustomer:
        eight_d = await EightDCustomerService.get_by_complaint_id(db, complaint_id)
        if not eight_d:
            raise ValueError(f"客诉单 {complaint_id} 的 8D 报告不存在")

        if eight_d.status not in [EightDStatus.D4_D7_COMPLETED, EightDStatus.D8_IN_PROGRESS]:
            raise ValueError(f"8D 报告状态错误，当前状态为 {eight_d.status}")

        lesson_id = None
        if data.lesson_learned.should_archive:
            lesson = LessonLearned(
                source_type=SourceType.CUSTOMER_COMPLAINT,
                source_id=complaint_id,
                lesson_title=data.lesson_learned.lesson_title or "客户投诉经验教训",
                lesson_content=data.lesson_learned.lesson_content or "",
                root_cause=(
                    eight_d.d4_d7_responsible.get("d4_root_cause", {}).get("root_cause", "")
                    if eight_d.d4_d7_responsible
                    else ""
                ),
                preventive_action=data.lesson_learned.preventive_action or "",
                approved_by=user_id,
                is_active=True,
            )
            db.add(lesson)
            await db.flush()
            lesson_id = lesson.id

        eight_d.d8_horizontal = {
            "horizontal_deployment": [
                {
                    "product": item.product,
                    "action": item.action,
                    "status": item.status,
                }
                for item in data.horizontal_deployment
            ],
            "lesson_learned": {
                "should_archive": data.lesson_learned.should_archive,
                "lesson_id": lesson_id,
            },
        }
        eight_d.status = EightDStatus.IN_REVIEW

        related_complaints = EightDCustomerService._get_related_complaints(eight_d)
        severity_rank = {
            SeverityLevel.TBD: 0,
            SeverityLevel.MINOR: 1,
            SeverityLevel.MAJOR: 2,
            SeverityLevel.CRITICAL: 3,
        }
        highest_severity = max(
            (complaint.severity_level for complaint in related_complaints),
            key=lambda value: severity_rank.get(value, 0),
            default=SeverityLevel.TBD,
        )
        if highest_severity == SeverityLevel.MINOR:
            eight_d.approval_level = ApprovalLevel.SECTION_MANAGER
        else:
            eight_d.approval_level = ApprovalLevel.DEPARTMENT_HEAD

        await db.commit()
        logger.info("Submitted D8 for customer 8D %s by user %s", eight_d.id, user_id)
        return await EightDCustomerService.get_by_id(db=db, report_id=eight_d.id)

    @staticmethod
    async def review_8d(
        db: AsyncSession,
        complaint_id: int,
        review_data: EightDReviewRequest,
        reviewer_id: int,
    ) -> EightDCustomer:
        eight_d = await EightDCustomerService.get_by_complaint_id(db, complaint_id)
        if not eight_d:
            raise ValueError(f"客诉单 {complaint_id} 的 8D 报告不存在")

        if eight_d.status != EightDStatus.IN_REVIEW:
            raise ValueError(f"8D 报告状态错误，当前状态为 {eight_d.status}")

        eight_d.reviewed_by = reviewer_id
        eight_d.reviewed_at = datetime.utcnow()
        eight_d.review_comments = review_data.review_comments

        if review_data.approved:
            eight_d.status = EightDStatus.APPROVED
        else:
            eight_d.status = EightDStatus.REJECTED
            eight_d.d4_d7_responsible = None
            eight_d.d8_horizontal = None
            for complaint in EightDCustomerService._get_related_complaints(eight_d):
                complaint.status = ComplaintStatus.IN_RESPONSE

        await db.commit()
        logger.info("Reviewed customer 8D %s by user %s with approved=%s", eight_d.id, reviewer_id, review_data.approved)
        return await EightDCustomerService.get_by_id(db=db, report_id=eight_d.id)

    @staticmethod
    async def archive_8d(
        db: AsyncSession,
        complaint_id: int,
        user_id: int,
    ) -> EightDCustomer:
        eight_d = await EightDCustomerService.get_by_complaint_id(db, complaint_id)
        if not eight_d:
            raise ValueError(f"客诉单 {complaint_id} 的 8D 报告不存在")

        if eight_d.status != EightDStatus.APPROVED:
            raise ValueError(f"8D 报告状态错误，当前状态为 {eight_d.status}")

        eight_d.status = EightDStatus.CLOSED
        for complaint in EightDCustomerService._get_related_complaints(eight_d):
            complaint.status = ComplaintStatus.CLOSED

        await db.commit()
        logger.info("Archived customer 8D %s by user %s", eight_d.id, user_id)
        return await EightDCustomerService.get_by_id(db=db, report_id=eight_d.id)

    @staticmethod
    async def calculate_sla_status(
        db: AsyncSession,
        complaint_id: int,
    ) -> SLAStatus:
        complaint = await db.get(CustomerComplaint, complaint_id)
        if not complaint:
            raise ValueError(f"客诉单 {complaint_id} 不存在")

        eight_d = await EightDCustomerService.get_by_complaint_id(db, complaint_id)
        if not eight_d:
            raise ValueError(f"客诉单 {complaint_id} 的 8D 报告不存在")

        days_since_creation = (datetime.utcnow() - complaint.created_at).days
        submission_deadline = 7
        archive_deadline = 10

        is_submission_overdue = False
        is_archive_overdue = False
        remaining_days = 0

        if eight_d.status in [EightDStatus.DRAFT, EightDStatus.D0_D3_COMPLETED, EightDStatus.D4_D7_IN_PROGRESS]:
            remaining_days = submission_deadline - days_since_creation
            is_submission_overdue = remaining_days < 0
        elif eight_d.status in [
            EightDStatus.D4_D7_COMPLETED,
            EightDStatus.D8_IN_PROGRESS,
            EightDStatus.IN_REVIEW,
            EightDStatus.APPROVED,
        ]:
            remaining_days = archive_deadline - days_since_creation
            is_archive_overdue = remaining_days < 0

        return SLAStatus(
            complaint_id=complaint_id,
            complaint_number=complaint.complaint_number,
            eight_d_status=eight_d.status,
            days_since_creation=days_since_creation,
            submission_deadline=submission_deadline,
            archive_deadline=archive_deadline,
            is_submission_overdue=is_submission_overdue,
            is_archive_overdue=is_archive_overdue,
            remaining_days=remaining_days,
        )

    @staticmethod
    async def get_overdue_reports(
        db: AsyncSession,
        skip: int = 0,
        limit: int = 100,
    ) -> list[SLAStatus]:
        result = await db.execute(
            select(CustomerComplaint)
            .where(CustomerComplaint.status != ComplaintStatus.CLOSED)
            .offset(skip)
            .limit(limit)
        )
        complaints = list(result.scalars().all())

        overdue_list: list[SLAStatus] = []
        seen_report_ids: set[int] = set()
        for complaint in complaints:
            try:
                report = await EightDCustomerService.get_by_complaint_id(db, complaint.id)
                if report is None or report.id in seen_report_ids:
                    continue
                seen_report_ids.add(report.id)
                sla_status = await EightDCustomerService.calculate_sla_status(db, report.complaint_id)
                if sla_status.is_submission_overdue or sla_status.is_archive_overdue:
                    overdue_list.append(sla_status)
            except ValueError:
                continue

        return overdue_list
