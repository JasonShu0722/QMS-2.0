"""Simple customer complaint tests."""

from datetime import date

import pytest

from app.models.customer_complaint import SeverityLevel
from app.schemas.customer_complaint import (
    ComplaintTypeEnum,
    CustomerComplaintCreate,
    PhysicalAnalysisRecordRequest,
    PhysicalAnalysisStatusEnum,
    PhysicalDispositionRecordRequest,
    PhysicalDispositionStatusEnum,
    PreliminaryAnalysisRequest,
)
from app.services.customer_complaint_service import CustomerComplaintService


class TestSeverityLevelDetermination:
    def test_critical_keywords(self):
        assert (
            CustomerComplaintService._determine_severity_level(
                "\u8f66\u8f86\u5b58\u5728\u5b89\u5168\u9690\u60a3",
                "0km",
            )
            == SeverityLevel.CRITICAL
        )
        assert (
            CustomerComplaintService._determine_severity_level(
                "\u884c\u9a76\u4e2d\u7a81\u7136\u65ad\u7535",
                "after_sales",
            )
            == SeverityLevel.CRITICAL
        )

    def test_major_keywords(self):
        assert (
            CustomerComplaintService._determine_severity_level(
                "\u6279\u91cf\u53d1\u73b0\u529f\u80fd\u5931\u6548",
                "0km",
            )
            == SeverityLevel.MAJOR
        )
        assert (
            CustomerComplaintService._determine_severity_level(
                "\u7535\u8def\u677f\u70e7\u6bc1",
                "0km",
            )
            == SeverityLevel.MAJOR
        )

    def test_minor_keywords(self):
        assert (
            CustomerComplaintService._determine_severity_level(
                "\u5916\u89c2\u8f7b\u5fae\u5212\u75d5",
                "0km",
            )
            == SeverityLevel.MINOR
        )
        assert (
            CustomerComplaintService._determine_severity_level(
                "\u5076\u53d1\u6027\u566a\u97f3",
                "after_sales",
            )
            == SeverityLevel.MINOR
        )

    def test_tbd_default(self):
        assert (
            CustomerComplaintService._determine_severity_level(
                "\u53d1\u73b0\u5f02\u5e38\u9700\u8981\u8fdb\u4e00\u6b65\u5206\u6790",
                "0km",
            )
            == SeverityLevel.TBD
        )


class TestComplaintDataValidation:
    def test_zero_km_validation(self):
        complaint = CustomerComplaintCreate(
            complaint_type=ComplaintTypeEnum.ZERO_KM,
            customer_code="CUST001",
            product_type="MCU",
            defect_description="\u5ba2\u6237\u4ea7\u7ebf\u53d1\u73b0\u529f\u80fd\u5f02\u5e38\u9700\u8981\u8ddf\u8fdb",
        )

        assert complaint.vin_code is None
        assert complaint.mileage is None
        assert complaint.purchase_date is None

    def test_after_sales_requires_trace_fields(self):
        with pytest.raises(ValueError):
            CustomerComplaintCreate(
                complaint_type=ComplaintTypeEnum.AFTER_SALES,
                customer_code="CUST002",
                product_type="BMS",
                defect_description="\u8f66\u8f86\u884c\u9a76\u4e2d\u7a81\u7136\u65ad\u7535\u9700\u7d27\u6025\u5904\u7406",
                mileage=12000,
                purchase_date=date(2024, 1, 1),
            )

        with pytest.raises(ValueError):
            CustomerComplaintCreate(
                complaint_type=ComplaintTypeEnum.AFTER_SALES,
                customer_code="CUST002",
                product_type="BMS",
                defect_description="\u8f66\u8f86\u884c\u9a76\u4e2d\u7a81\u7136\u65ad\u7535\u9700\u7d27\u6025\u5904\u7406",
                vin_code="VIN-001",
                purchase_date=date(2024, 1, 1),
            )

        complaint = CustomerComplaintCreate(
            complaint_type=ComplaintTypeEnum.AFTER_SALES,
            customer_code="CUST002",
            product_type="BMS",
            defect_description="\u8f66\u8f86\u884c\u9a76\u4e2d\u7a81\u7136\u65ad\u7535\u9700\u7d27\u6025\u5904\u7406",
            vin_code="VIN-001",
            mileage=12000,
        )
        assert complaint.purchase_date is None

    def test_customer_reference_required(self):
        with pytest.raises(ValueError):
            CustomerComplaintCreate(
                complaint_type=ComplaintTypeEnum.ZERO_KM,
                product_type="MCU",
                defect_description="\u5ba2\u6237\u7aef\u53d1\u73b0\u88c5\u914d\u4e0d\u826f\u9700\u8981\u8ddf\u8fdb",
            )


class TestRequestValidation:
    def test_preliminary_analysis_request(self):
        request = PreliminaryAnalysisRequest(
            emergency_action="\u7acb\u5373\u51bb\u7ed3\u76f8\u5173\u6279\u6b21\u5e93\u5b58\u5e76\u901a\u77e5\u73b0\u573a\u9694\u79bb",
            team_members="CQE, FAE, PE",
            problem_description_5w2h="What: abnormal. When: today. Where: line. Who: operator. How many: 20.",
            containment_action="\u7acb\u5373\u56f4\u5835\u76f8\u5173\u6279\u6b21\u6210\u54c1\u4e0e\u5728\u5236",
            containment_verification="\u73b0\u573a\u5df2\u5b8c\u6210\u9694\u79bb\u548c\u70b9\u6570",
            responsible_dept="PE",
            root_cause_preliminary="\u521d\u6b65\u6000\u7591\u710a\u63a5\u5f02\u5e38",
            ims_work_order="WO202401001",
            ims_batch_number="BATCH20240105",
        )

        assert request.responsible_dept == "PE"
        assert request.ims_work_order == "WO202401001"

    def test_physical_disposition_request(self):
        request = PhysicalDispositionRecordRequest(
            disposition_plan="\u5b89\u6392\u9000\u4ef6\u5165\u5e93\u540e\u590d\u5224\u5e76\u6267\u884c\u6539\u5236",
            disposition_status=PhysicalDispositionStatusEnum.IN_PROGRESS,
            disposition_notes="\u9996\u6279\u6837\u4ef6\u5148\u884c\u5904\u7406",
        )

        assert request.disposition_status == PhysicalDispositionStatusEnum.IN_PROGRESS
        assert request.disposition_notes == "\u9996\u6279\u6837\u4ef6\u5148\u884c\u5904\u7406"

    def test_physical_analysis_request(self):
        request = PhysicalAnalysisRecordRequest(
            responsible_dept="FAE",
            responsible_user_id=2,
            analysis_status=PhysicalAnalysisStatusEnum.ASSIGNED,
            failed_part_number="PN-FA-001",
            analysis_notes="\u5148\u5b8c\u6210\u62c6\u89e3\u4e0e\u5b9a\u4f4d",
        )

        assert request.analysis_status == PhysicalAnalysisStatusEnum.ASSIGNED
        assert request.failed_part_number == "PN-FA-001"

    def test_completed_physical_analysis_requires_summary(self):
        with pytest.raises(ValueError):
            PhysicalAnalysisRecordRequest(
                responsible_dept="FAE",
                responsible_user_id=2,
                analysis_status=PhysicalAnalysisStatusEnum.COMPLETED,
            )
