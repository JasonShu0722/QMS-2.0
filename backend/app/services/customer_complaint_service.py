"""
Customer Complaint Service
客诉管理服务层 - 处理客诉录入、分流、实物处理备案等业务逻辑
"""
from datetime import date, datetime
import logging
from typing import List, Optional

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.customer_complaint import (
    ComplaintStatus,
    ComplaintType,
    CustomerComplaint,
    PhysicalAnalysisStatus,
    PhysicalDispositionStatus,
    SeverityLevel,
)
from app.models.eight_d_customer import EightDCustomerComplaintLink
from app.models.customer_master import CustomerMaster, CustomerStatus
from app.models.problem_report import ProblemReport, ProblemReportSource
from app.models.user import User, UserStatus, UserType
from app.schemas.customer_complaint import (
    CustomerComplaintCreate,
    IMSTracebackResponse,
    PhysicalAnalysisRecordRequest,
    PhysicalDispositionRecordRequest,
    PreliminaryAnalysisRequest,
)

logger = logging.getLogger(__name__)


class CustomerComplaintService:
    """客诉管理服务"""

    @staticmethod
    def _clean_text(value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None

    @staticmethod
    async def _attach_problem_report_links(
        db: AsyncSession,
        complaints: list[CustomerComplaint],
    ) -> None:
        complaint_ids = [complaint.id for complaint in complaints if complaint.id]
        if not complaint_ids:
            return

        result = await db.execute(
            select(ProblemReportSource, ProblemReport)
            .join(ProblemReport, ProblemReport.id == ProblemReportSource.problem_report_id)
            .where(
                ProblemReportSource.source_type == "customer_complaint",
                ProblemReportSource.source_id.in_(complaint_ids),
            )
            .order_by(ProblemReport.updated_at.desc(), ProblemReport.id.desc())
        )
        report_by_complaint_id: dict[int, ProblemReport] = {}
        for source, report in result.all():
            report_by_complaint_id.setdefault(source.source_id, report)

        for complaint in complaints:
            report = report_by_complaint_id.get(complaint.id)
            if report is None:
                continue
            complaint.problem_report_id = report.id
            complaint.problem_number = report.problem_number
            complaint.problem_report_eight_d_number = report.eight_d_number
            complaint.problem_report_response_mode = report.response_mode
            complaint.problem_report_risk_level = (
                report.risk_level.value if hasattr(report.risk_level, "value") else report.risk_level
            )

    @staticmethod
    async def _resolve_customer_snapshot(
        db: AsyncSession,
        complaint_data: CustomerComplaintCreate,
    ) -> tuple[Optional[int], str, str]:
        customer_id = complaint_data.customer_id
        customer_code = CustomerComplaintService._clean_text(complaint_data.customer_code)
        customer_name = CustomerComplaintService._clean_text(complaint_data.customer_name)

        if customer_id is not None:
            customer_result = await db.execute(select(CustomerMaster).where(CustomerMaster.id == customer_id))
            customer = customer_result.scalar_one_or_none()
            if not customer:
                raise ValueError(f"客户不存在: ID={customer_id}")
            if customer.status != CustomerStatus.ACTIVE:
                raise ValueError(f"客户状态不可用: {customer.code}")

            customer_code = customer.code
            customer_name = customer.name

        if customer_id is None and (customer_code or customer_name):
            customer = None
            if customer_code:
                customer_result = await db.execute(
                    select(CustomerMaster).where(
                        CustomerMaster.status == CustomerStatus.ACTIVE,
                        CustomerMaster.code == customer_code,
                    )
                )
                customer = customer_result.scalar_one_or_none()

            if customer is None and customer_name:
                customer_result = await db.execute(
                    select(CustomerMaster)
                    .where(
                        CustomerMaster.status == CustomerStatus.ACTIVE,
                        CustomerMaster.name == customer_name,
                    )
                    .order_by(CustomerMaster.code.asc())
                    .limit(1)
                )
                customer = customer_result.scalar_one_or_none()

            if customer:
                customer_id = customer.id
                customer_code = customer.code
                customer_name = customer.name

        if not customer_code and not customer_name:
            raise ValueError("客户名称或客户代码不能为空")

        if not customer_code:
            customer_code = customer_name

        if not customer_name:
            customer_name = customer_code

        return customer_id, customer_code, customer_name

    @staticmethod
    def _build_complaint(
        complaint_data: CustomerComplaintCreate,
        complaint_number: str,
        customer_id: Optional[int],
        customer_code: str,
        customer_name: str,
        created_by_id: int,
    ) -> CustomerComplaint:
        severity_level = CustomerComplaintService._determine_severity_level(
            complaint_data.defect_description,
            complaint_data.complaint_type.value,
        )

        return CustomerComplaint(
            complaint_number=complaint_number,
            complaint_type=ComplaintType(complaint_data.complaint_type.value),
            customer_id=customer_id,
            customer_code=customer_code,
            customer_name_snapshot=customer_name,
            end_customer_name=CustomerComplaintService._clean_text(complaint_data.end_customer_name),
            received_date=complaint_data.received_date,
            occurrence_date=complaint_data.occurrence_date,
            production_date=complaint_data.production_date,
            product_type=complaint_data.product_type.strip(),
            product_model=CustomerComplaintService._clean_text(complaint_data.product_model),
            project_stage=CustomerComplaintService._clean_text(complaint_data.project_stage),
            batch_code=CustomerComplaintService._clean_text(complaint_data.batch_code),
            trace_code=CustomerComplaintService._clean_text(complaint_data.trace_code),
            return_type=CustomerComplaintService._clean_text(complaint_data.return_type),
            return_month=CustomerComplaintService._clean_text(complaint_data.return_month),
            service_months=complaint_data.service_months,
            service_month_category=CustomerComplaintService._clean_text(complaint_data.service_month_category),
            dealer_name=CustomerComplaintService._clean_text(complaint_data.dealer_name),
            occurrence_region=CustomerComplaintService._clean_text(complaint_data.occurrence_region),
            fault_category=CustomerComplaintService._clean_text(complaint_data.fault_category),
            service_method=CustomerComplaintService._clean_text(complaint_data.service_method),
            analysis_priority=CustomerComplaintService._clean_text(complaint_data.analysis_priority),
            failure_count=complaint_data.failure_count,
            defect_description=complaint_data.defect_description.strip(),
            severity_level=severity_level,
            is_return_required=complaint_data.is_return_required,
            requires_physical_analysis=complaint_data.requires_physical_analysis,
            vin_code=CustomerComplaintService._clean_text(complaint_data.vin_code),
            mileage=complaint_data.mileage,
            mileage_category=CustomerComplaintService._clean_text(complaint_data.mileage_category),
            purchase_date=complaint_data.purchase_date,
            status=ComplaintStatus.PENDING,
            created_by=created_by_id,
        )

    @staticmethod
    async def create_complaint(
        db: AsyncSession,
        complaint_data: CustomerComplaintCreate,
        created_by_id: int,
    ) -> CustomerComplaint:
        customer_id, customer_code, customer_name = await CustomerComplaintService._resolve_customer_snapshot(
            db=db,
            complaint_data=complaint_data,
        )
        complaint_number = await CustomerComplaintService._generate_complaint_number(db)
        complaint = CustomerComplaintService._build_complaint(
            complaint_data=complaint_data,
            complaint_number=complaint_number,
            customer_id=customer_id,
            customer_code=customer_code,
            customer_name=customer_name,
            created_by_id=created_by_id,
        )

        db.add(complaint)
        await db.commit()
        await db.refresh(complaint)

        logger.info("创建客诉单成功: %s, 严重度=%s", complaint_number, complaint.severity_level.value)
        return complaint

    @staticmethod
    async def create_complaints(
        db: AsyncSession,
        complaint_items: List[CustomerComplaintCreate],
        created_by_id: int,
    ) -> list[CustomerComplaint]:
        if not complaint_items:
            raise ValueError("请至少提供一条客诉记录")

        today = datetime.now().strftime("%Y%m%d")
        prefix = f"CC-{today}-"
        next_seq = await CustomerComplaintService._get_next_complaint_sequence(db, prefix)
        complaints: list[CustomerComplaint] = []

        for index, complaint_data in enumerate(complaint_items):
            customer_id, customer_code, customer_name = await CustomerComplaintService._resolve_customer_snapshot(
                db=db,
                complaint_data=complaint_data,
            )
            complaint_number = f"{prefix}{next_seq + index:03d}"
            complaints.append(
                CustomerComplaintService._build_complaint(
                    complaint_data=complaint_data,
                    complaint_number=complaint_number,
                    customer_id=customer_id,
                    customer_code=customer_code,
                    customer_name=customer_name,
                    created_by_id=created_by_id,
                )
            )

        db.add_all(complaints)
        await db.commit()

        for complaint in complaints:
            await db.refresh(complaint)

        logger.info("批量创建客诉单成功: count=%s", len(complaints))
        return complaints

    @staticmethod
    async def _generate_complaint_number(db: AsyncSession) -> str:
        today = datetime.now().strftime("%Y%m%d")
        prefix = f"CC-{today}-"
        return f"{prefix}{await CustomerComplaintService._get_next_complaint_sequence(db, prefix):03d}"

    @staticmethod
    async def _get_next_complaint_sequence(db: AsyncSession, prefix: str) -> int:
        result = await db.execute(
            select(func.max(CustomerComplaint.complaint_number)).where(
                CustomerComplaint.complaint_number.like(f"{prefix}%")
            )
        )
        max_number = result.scalar()

        if max_number:
            last_seq = int(max_number.split("-")[-1])
            new_seq = last_seq + 1
        else:
            new_seq = 1

        return new_seq

    @staticmethod
    def _determine_severity_level(defect_description: str, complaint_type: str) -> SeverityLevel:
        description_lower = defect_description.lower()

        critical_keywords = ["安全", "抛锚", "起火", "爆炸", "人身伤害", "断电", "失控", "刹车失效"]
        if any(keyword in description_lower for keyword in critical_keywords):
            return SeverityLevel.CRITICAL

        major_keywords = ["功能失效", "批量", "召回", "停产", "无法使用", "烧毁", "短路"]
        if any(keyword in description_lower for keyword in major_keywords):
            return SeverityLevel.MAJOR

        minor_keywords = ["外观", "轻微", "偶发", "划痕", "色差", "噪音"]
        if any(keyword in description_lower for keyword in minor_keywords):
            return SeverityLevel.MINOR

        return SeverityLevel.TBD

    @staticmethod
    async def record_physical_disposition(
        db: AsyncSession,
        complaint_id: int,
        disposition_data: PhysicalDispositionRecordRequest,
        updated_by_id: int,
    ) -> CustomerComplaint:
        complaint = await CustomerComplaintService.get_complaint_by_id(db=db, complaint_id=complaint_id)

        if not complaint:
            raise ValueError(f"客诉单不存在: ID={complaint_id}")
        if complaint.requires_physical_analysis:
            raise ValueError("当前客诉已标记为需要实物解析，请走解析任务流程")
        if complaint.status == ComplaintStatus.CLOSED:
            raise ValueError("当前客诉已关闭，不能继续更新实物处理备案")

        complaint.physical_disposition_plan = disposition_data.disposition_plan.strip()
        complaint.physical_disposition_notes = disposition_data.disposition_notes.strip() if disposition_data.disposition_notes else None
        complaint.physical_disposition_status = PhysicalDispositionStatus(disposition_data.disposition_status.value)
        complaint.physical_disposition_updated_at = datetime.now()
        complaint.physical_disposition_updated_by = updated_by_id

        if complaint.physical_disposition_status == PhysicalDispositionStatus.COMPLETED:
            complaint.status = ComplaintStatus.CLOSED

        await db.commit()
        await db.refresh(complaint)

        logger.info(
            "客诉单 %s 更新实物处理备案: status=%s",
            complaint.complaint_number,
            complaint.physical_disposition_status.value,
        )
        return complaint

    @staticmethod
    async def record_physical_analysis(
        db: AsyncSession,
        complaint_id: int,
        analysis_data: PhysicalAnalysisRecordRequest,
        updated_by_id: int,
    ) -> CustomerComplaint:
        complaint = await CustomerComplaintService.get_complaint_by_id(db=db, complaint_id=complaint_id)

        if not complaint:
            raise ValueError(f"客诉单不存在: ID={complaint_id}")
        if not complaint.requires_physical_analysis:
            raise ValueError("当前客诉未标记为需要实物解析，请走实物处理备案流程")
        if complaint.status == ComplaintStatus.CLOSED:
            raise ValueError("当前客诉已关闭，不能继续更新实物解析任务")

        user_result = await db.execute(
            select(User).where(
                User.id == analysis_data.responsible_user_id,
                User.user_type == UserType.INTERNAL,
                User.status == UserStatus.ACTIVE,
            )
        )
        responsible_user = user_result.scalar_one_or_none()
        if not responsible_user:
            raise ValueError("实物解析责任人不存在或不可用")

        complaint.physical_analysis_responsible_dept = analysis_data.responsible_dept.strip()
        complaint.physical_analysis_responsible_user_id = responsible_user.id
        complaint.failed_part_number = (
            analysis_data.failed_part_number.strip() if analysis_data.failed_part_number else None
        )
        complaint.physical_analysis_summary = (
            analysis_data.analysis_summary.strip() if analysis_data.analysis_summary else None
        )
        complaint.physical_analysis_notes = (
            analysis_data.analysis_notes.strip() if analysis_data.analysis_notes else None
        )
        complaint.physical_analysis_status = PhysicalAnalysisStatus(analysis_data.analysis_status.value)
        complaint.physical_analysis_updated_at = datetime.now()
        complaint.physical_analysis_updated_by = updated_by_id
        complaint.responsible_dept = complaint.physical_analysis_responsible_dept

        if complaint.physical_analysis_status == PhysicalAnalysisStatus.COMPLETED:
            complaint.status = ComplaintStatus.IN_RESPONSE
        else:
            complaint.status = ComplaintStatus.IN_ANALYSIS

        await db.commit()
        await db.refresh(complaint)

        logger.info(
            "客诉单 %s 更新实物解析任务: status=%s, owner=%s",
            complaint.complaint_number,
            complaint.physical_analysis_status.value,
            responsible_user.username,
        )
        return complaint

    @staticmethod
    async def submit_preliminary_analysis(
        db: AsyncSession,
        complaint_id: int,
        analysis_data: PreliminaryAnalysisRequest,
        cqe_id: int,
    ) -> CustomerComplaint:
        complaint = await CustomerComplaintService.get_complaint_by_id(db=db, complaint_id=complaint_id)

        if not complaint:
            raise ValueError(f"客诉单不存在: ID={complaint_id}")
        if complaint.status != ComplaintStatus.PENDING:
            raise ValueError(f"客诉单状态不正确，当前状态: {complaint.status.value}")

        complaint.status = ComplaintStatus.IN_RESPONSE
        complaint.cqe_id = cqe_id
        complaint.responsible_dept = analysis_data.responsible_dept

        await db.commit()
        await db.refresh(complaint)

        logger.info("客诉单 %s 完成一次因解析，责任部门=%s", complaint.complaint_number, analysis_data.responsible_dept)

        if analysis_data.ims_work_order or analysis_data.ims_batch_number:
            traceback_result = await CustomerComplaintService.auto_traceback_ims(
                db=db,
                work_order=analysis_data.ims_work_order,
                batch_number=analysis_data.ims_batch_number,
            )
            logger.info("IMS 自动追溯完成: anomaly_detected=%s", traceback_result.anomaly_detected)

        return complaint

    @staticmethod
    async def auto_traceback_ims(
        db: AsyncSession,
        work_order: Optional[str] = None,
        batch_number: Optional[str] = None,
        material_code: Optional[str] = None,
    ) -> IMSTracebackResponse:
        try:
            process_records = []
            defect_records = []
            material_records = []
            anomaly_detected = False
            anomaly_description = None

            if work_order:
                process_records = [
                    {"process": "SMT贴片", "operator": "张三", "result": "OK", "timestamp": "2024-01-05 08:30:00"},
                    {"process": "波峰焊", "operator": "李四", "result": "OK", "timestamp": "2024-01-05 09:15:00"},
                    {"process": "功能测试", "operator": "王五", "result": "OK", "timestamp": "2024-01-05 10:00:00"},
                ]

            if batch_number:
                defect_records = [
                    {"defect_type": "虚焊", "qty": 2, "date": "2024-01-05", "process": "波峰焊"},
                ]
                if defect_records:
                    anomaly_detected = True
                    anomaly_description = (
                        f"该批次在{defect_records[0]['process']}工序出现"
                        f"{defect_records[0]['qty']}次{defect_records[0]['defect_type']}不良"
                    )

            if material_code:
                material_records = [
                    {"material_code": material_code, "supplier": "SUP-A", "batch": "B001", "incoming_date": "2024-01-03"},
                ]

            return IMSTracebackResponse(
                found=bool(work_order or batch_number),
                work_order=work_order,
                batch_number=batch_number,
                production_date=date(2024, 1, 5) if work_order else None,
                process_records=process_records,
                defect_records=defect_records,
                material_records=material_records,
                anomaly_detected=anomaly_detected,
                anomaly_description=anomaly_description,
            )
        except Exception as exc:
            logger.error("IMS 自动追溯失败: %s", exc)
            return IMSTracebackResponse(found=False, anomaly_detected=False)

    @staticmethod
    async def get_complaint_by_id(
        db: AsyncSession,
        complaint_id: int,
    ) -> Optional[CustomerComplaint]:
        result = await db.execute(
            select(CustomerComplaint)
            .options(
                selectinload(CustomerComplaint.eight_d_report),
                selectinload(CustomerComplaint.eight_d_links).selectinload(EightDCustomerComplaintLink.report),
            )
            .where(CustomerComplaint.id == complaint_id)
        )
        complaint = result.scalar_one_or_none()
        if complaint:
            await CustomerComplaintService._attach_problem_report_links(db, [complaint])
        return complaint

    @staticmethod
    async def list_customer_options(
        db: AsyncSession,
        keyword: Optional[str] = None,
    ) -> list[CustomerMaster]:
        query = select(CustomerMaster).where(CustomerMaster.status == CustomerStatus.ACTIVE)

        if keyword:
            like_value = f"%{keyword.strip()}%"
            query = query.where(
                or_(
                    CustomerMaster.code.ilike(like_value),
                    CustomerMaster.name.ilike(like_value),
                )
            )

        result = await db.execute(query.order_by(CustomerMaster.code.asc()))
        return list(result.scalars().all())

    @staticmethod
    async def list_internal_user_options(
        db: AsyncSession,
        keyword: Optional[str] = None,
    ) -> list[User]:
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

        result = await db.execute(query.order_by(User.department.asc(), User.full_name.asc()))
        return list(result.scalars().all())

    @staticmethod
    async def list_complaints(
        db: AsyncSession,
        complaint_type: Optional[str] = None,
        status: Optional[str] = None,
        customer_id: Optional[int] = None,
        customer_code: Optional[str] = None,
        severity_level: Optional[str] = None,
        cqe_id: Optional[int] = None,
        responsible_dept: Optional[str] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[List[CustomerComplaint], int]:
        conditions = []

        if complaint_type:
            conditions.append(CustomerComplaint.complaint_type == ComplaintType(complaint_type))
        if status:
            conditions.append(CustomerComplaint.status == ComplaintStatus(status))
        if customer_id:
            conditions.append(CustomerComplaint.customer_id == customer_id)
        if customer_code:
            conditions.append(CustomerComplaint.customer_code == customer_code)
        if severity_level:
            conditions.append(CustomerComplaint.severity_level == SeverityLevel(severity_level))
        if cqe_id:
            conditions.append(CustomerComplaint.cqe_id == cqe_id)
        if responsible_dept:
            conditions.append(CustomerComplaint.responsible_dept == responsible_dept)
        if start_date:
            conditions.append(CustomerComplaint.created_at >= datetime.combine(start_date, datetime.min.time()))
        if end_date:
            conditions.append(CustomerComplaint.created_at <= datetime.combine(end_date, datetime.max.time()))

        count_query = select(func.count(CustomerComplaint.id))
        if conditions:
            count_query = count_query.where(and_(*conditions))

        result = await db.execute(count_query)
        total = result.scalar()

        query = select(CustomerComplaint).options(
            selectinload(CustomerComplaint.eight_d_report),
            selectinload(CustomerComplaint.eight_d_links).selectinload(EightDCustomerComplaintLink.report),
        )
        if conditions:
            query = query.where(and_(*conditions))

        query = query.order_by(CustomerComplaint.created_at.desc())
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await db.execute(query)
        complaints = list(result.scalars().all())
        await CustomerComplaintService._attach_problem_report_links(db, complaints)
        return complaints, total
