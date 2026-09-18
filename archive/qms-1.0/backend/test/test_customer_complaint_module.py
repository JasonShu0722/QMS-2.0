"""Customer complaint module tests."""

from datetime import date

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.customer_complaint import (
    ComplaintStatus,
    ComplaintType,
    PhysicalAnalysisStatus,
    PhysicalDispositionStatus,
    SeverityLevel,
)
from app.models.customer_master import CustomerMaster, CustomerStatus
from app.models.eight_d_customer import EightDStatus
from app.schemas.customer_complaint import (
    ComplaintTypeEnum,
    CustomerComplaintCreate,
    PhysicalAnalysisRecordRequest,
    PhysicalAnalysisStatusEnum,
    PhysicalDispositionRecordRequest,
    PhysicalDispositionStatusEnum,
)
from app.services.customer_complaint_service import CustomerComplaintService
from app.services.eight_d_customer_service import EightDCustomerService


@pytest.fixture
async def customer_master(db_session: AsyncSession):
    customer = CustomerMaster(
        code="CUSTM001",
        name="BYD Auto",
        status=CustomerStatus.ACTIVE,
    )
    db_session.add(customer)
    await db_session.commit()
    await db_session.refresh(customer)
    return customer


@pytest.mark.asyncio
class TestCustomerComplaintCreation:
    async def test_create_zero_km_complaint(self, db_session: AsyncSession, test_user):
        complaint = await CustomerComplaintService.create_complaint(
            db=db_session,
            complaint_data=CustomerComplaintCreate(
                complaint_type=ComplaintTypeEnum.ZERO_KM,
                customer_code="CUST001",
                product_type="MCU",
                defect_description="\u5ba2\u6237\u4ea7\u7ebf\u53d1\u73b0MCU\u529f\u80fd\u5f02\u5e38\u9700\u8981\u8ddf\u8fdb\u5904\u7406",
            ),
            created_by_id=test_user.id,
        )

        assert complaint.id is not None
        assert complaint.complaint_number.startswith("CC-")
        assert complaint.complaint_type == ComplaintType.ZERO_KM
        assert complaint.status == ComplaintStatus.PENDING
        assert complaint.severity_level in {
            SeverityLevel.MAJOR,
            SeverityLevel.TBD,
        }
        assert complaint.physical_disposition_status == PhysicalDispositionStatus.PENDING
        assert complaint.physical_analysis_status == PhysicalAnalysisStatus.PENDING

    async def test_create_after_sales_complaint(self, db_session: AsyncSession, test_user):
        complaint = await CustomerComplaintService.create_complaint(
            db=db_session,
            complaint_data=CustomerComplaintCreate(
                complaint_type=ComplaintTypeEnum.AFTER_SALES,
                customer_code="CUST002",
                product_type="BMS",
                defect_description="\u8f66\u8f86\u884c\u9a76\u4e2d\u7a81\u7136\u65ad\u7535\u9700\u7d27\u6025\u5904\u7406",
                vin_code="VIN-123",
                mileage=15000,
                purchase_date=date(2024, 1, 1),
            ),
            created_by_id=test_user.id,
        )

        assert complaint.complaint_type == ComplaintType.AFTER_SALES
        assert complaint.vin_code == "VIN-123"
        assert complaint.mileage == 15000

    async def test_create_with_customer_master(
        self,
        db_session: AsyncSession,
        test_user,
        customer_master: CustomerMaster,
    ):
        complaint = await CustomerComplaintService.create_complaint(
            db=db_session,
            complaint_data=CustomerComplaintCreate(
                complaint_type=ComplaintTypeEnum.ZERO_KM,
                customer_id=customer_master.id,
                product_type="MCU",
                defect_description="\u5ba2\u6237\u53d1\u73b0\u6279\u91cf\u529f\u80fd\u5f02\u5e38\u9700\u8981\u5206\u6790\u5904\u7406",
                end_customer_name="Project A",
                is_return_required=True,
                requires_physical_analysis=True,
            ),
            created_by_id=test_user.id,
        )

        assert complaint.customer_id == customer_master.id
        assert complaint.customer_code == customer_master.code
        assert complaint.customer_name_snapshot == customer_master.name
        assert complaint.end_customer_name == "Project A"
        assert complaint.is_return_required is True
        assert complaint.requires_physical_analysis is True


@pytest.mark.asyncio
class TestCustomerComplaintFlows:
    async def test_record_physical_disposition_keeps_case_open_for_8d(
        self,
        db_session: AsyncSession,
        test_user,
    ):
        complaint = await CustomerComplaintService.create_complaint(
            db=db_session,
            complaint_data=CustomerComplaintCreate(
                complaint_type=ComplaintTypeEnum.ZERO_KM,
                customer_code="CUST003",
                product_type="Housing",
                defect_description="\u5ba2\u6237\u9000\u4ef6\u9700\u8981\u590d\u5224\u5e76\u4fdd\u7559\u5904\u7406\u65b9\u6848",
                is_return_required=True,
                requires_physical_analysis=False,
            ),
            created_by_id=test_user.id,
        )

        updated = await CustomerComplaintService.record_physical_disposition(
            db=db_session,
            complaint_id=complaint.id,
            disposition_data=PhysicalDispositionRecordRequest(
                disposition_plan="\u5b89\u6392\u9000\u4ef6\u5165\u5e93\u540e\u590d\u5224\u5e76\u6267\u884c\u6539\u5236",
                disposition_status=PhysicalDispositionStatusEnum.IN_PROGRESS,
                disposition_notes="\u7b49\u5f85\u6837\u4ef6\u8fd4\u56de",
            ),
            updated_by_id=test_user.id,
        )

        assert updated.physical_disposition_status == PhysicalDispositionStatus.IN_PROGRESS
        assert updated.status == ComplaintStatus.PENDING
        assert updated.physical_disposition_plan is not None

    async def test_record_physical_analysis_assigns_owner(
        self,
        db_session: AsyncSession,
        test_user,
    ):
        complaint = await CustomerComplaintService.create_complaint(
            db=db_session,
            complaint_data=CustomerComplaintCreate(
                complaint_type=ComplaintTypeEnum.ZERO_KM,
                customer_code="CUST004",
                product_type="Module",
                defect_description="\u9000\u4ef6\u9700\u8981\u5931\u6548\u5206\u6790\u5de5\u7a0b\u5e08\u5b8c\u6210\u89e3\u6790",
                requires_physical_analysis=True,
            ),
            created_by_id=test_user.id,
        )

        updated = await CustomerComplaintService.record_physical_analysis(
            db=db_session,
            complaint_id=complaint.id,
            analysis_data=PhysicalAnalysisRecordRequest(
                responsible_dept="FAE",
                responsible_user_id=test_user.id,
                analysis_status=PhysicalAnalysisStatusEnum.ASSIGNED,
                failed_part_number="PN-FA-001",
                analysis_notes="\u5148\u5b8c\u6210\u62c6\u89e3\u5b9a\u4f4d",
            ),
            updated_by_id=test_user.id,
        )

        assert updated.physical_analysis_status == PhysicalAnalysisStatus.ASSIGNED
        assert updated.status == ComplaintStatus.IN_ANALYSIS
        assert updated.physical_analysis_responsible_user_id == test_user.id
        assert updated.responsible_dept == "FAE"

    async def test_init_eight_d_after_completed_physical_analysis(
        self,
        db_session: AsyncSession,
        test_user,
    ):
        complaint = await CustomerComplaintService.create_complaint(
            db=db_session,
            complaint_data=CustomerComplaintCreate(
                complaint_type=ComplaintTypeEnum.ZERO_KM,
                customer_code="CUST005",
                product_type="Module",
                defect_description="\u5ba2\u6237\u8d28\u91cf\u95ee\u9898\u5df2\u5b8c\u6210\u5b9e\u7269\u89e3\u6790\u53ef\u53d1\u8d778D",
                requires_physical_analysis=True,
            ),
            created_by_id=test_user.id,
        )

        await CustomerComplaintService.record_physical_analysis(
            db=db_session,
            complaint_id=complaint.id,
            analysis_data=PhysicalAnalysisRecordRequest(
                responsible_dept="FAE",
                responsible_user_id=test_user.id,
                analysis_status=PhysicalAnalysisStatusEnum.COMPLETED,
                failed_part_number="PN-FA-900",
                analysis_summary="\u5df2\u5b8c\u6210\u4e00\u6b21\u56e0\u5206\u6790\u5e76\u786e\u8ba4\u6839\u56e0",
            ),
            updated_by_id=test_user.id,
        )

        report = await EightDCustomerService.init_report(
            db=db_session,
            complaint_id=complaint.id,
            user_id=test_user.id,
        )
        refreshed = await CustomerComplaintService.get_complaint_by_id(db=db_session, complaint_id=complaint.id)

        assert report.complaint_id == complaint.id
        assert report.status == EightDStatus.D4_D7_IN_PROGRESS
        assert refreshed.status == ComplaintStatus.IN_RESPONSE
        assert refreshed.eight_d_report_id == report.id
        assert refreshed.eight_d_status == EightDStatus.D4_D7_IN_PROGRESS

    async def test_init_eight_d_after_disposition_plan(
        self,
        db_session: AsyncSession,
        test_user,
    ):
        complaint = await CustomerComplaintService.create_complaint(
            db=db_session,
            complaint_data=CustomerComplaintCreate(
                complaint_type=ComplaintTypeEnum.ZERO_KM,
                customer_code="CUST006",
                product_type="Housing",
                defect_description="\u4e0d\u9700\u89e3\u6790\u4f46\u9700\u8981\u76f4\u63a5\u53d1\u8d778D",
                requires_physical_analysis=False,
            ),
            created_by_id=test_user.id,
        )

        await CustomerComplaintService.record_physical_disposition(
            db=db_session,
            complaint_id=complaint.id,
            disposition_data=PhysicalDispositionRecordRequest(
                disposition_plan="\u76f4\u63a5\u6267\u884c\u590d\u5224\u5e76\u8fdb\u5165\u540e\u7eed\u5bf9\u7b56",
                disposition_status=PhysicalDispositionStatusEnum.IN_PROGRESS,
            ),
            updated_by_id=test_user.id,
        )

        report = await EightDCustomerService.init_report(
            db=db_session,
            complaint_id=complaint.id,
            user_id=test_user.id,
        )

        assert report.complaint_id == complaint.id
        assert report.status == EightDStatus.D4_D7_IN_PROGRESS


@pytest.mark.asyncio
class TestComplaintQuery:
    async def test_list_complaints_by_customer_id(
        self,
        db_session: AsyncSession,
        test_user,
        customer_master: CustomerMaster,
    ):
        await CustomerComplaintService.create_complaint(
            db=db_session,
            complaint_data=CustomerComplaintCreate(
                complaint_type=ComplaintTypeEnum.ZERO_KM,
                customer_id=customer_master.id,
                product_type="Product A",
                defect_description="\u5ba2\u6237\u53d1\u73b0\u88c5\u914d\u4e0d\u826f\u9700\u8981\u533a\u5206\u8d23\u4efb\u548c\u5904\u7406\u65b9\u5f0f",
            ),
            created_by_id=test_user.id,
        )

        complaints, total = await CustomerComplaintService.list_complaints(
            db=db_session,
            customer_id=customer_master.id,
            page=1,
            page_size=10,
        )

        assert total >= 1
        assert all(item.customer_id == customer_master.id for item in complaints)
