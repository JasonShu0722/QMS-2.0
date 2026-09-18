"""
Comprehensive Customer Quality Management Module Tests
客户质量管理模块综合测试

测试范围：
- 出货数据同步和滚动计算 (2.7.1)
- 8D 闭环流程和时效监控 (2.7.3)
- 索赔转嫁逻辑 (2.7.4)
"""
import pytest
from datetime import date, datetime, timedelta
from decimal import Decimal
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.shipment_data import ShipmentData
from app.models.customer_complaint import CustomerComplaint, ComplaintType, ComplaintStatus
from app.models.eight_d_customer import EightDCustomer, EightDStatus, ApprovalLevel
from app.models.customer_claim import CustomerClaim
from app.models.supplier_claim import SupplierClaim
from app.models.supplier import Supplier
from app.models.user import User, UserType
from app.services.ims_integration_service import IMSIntegrationService
from app.services.customer_complaint_service import CustomerComplaintService
from app.services.eight_d_customer_service import EightDCustomerService
from app.services.customer_claim_service import CustomerClaimService
from app.services.supplier_claim_service import SupplierClaimService


@pytest.fixture
async def test_users(db_session: AsyncSession):
    """创建测试用户"""
    cqe = User(
        username="test_cqe",
        hashed_password="hashed",
        full_name="测试CQE",
        email="cqe@test.com",
        user_type=UserType.INTERNAL,
        department="质量部",
        position="CQE工程师",
        status="active"
    )
    
    design_engineer = User(
        username="test_design",
        hashed_password="hashed",
        full_name="测试设计工程师",
        email="design@test.com",
        user_type=UserType.INTERNAL,
        department="设计部",
        position="设计工程师",
        status="active"
    )
    
    db_session.add_all([cqe, design_engineer])
    await db_session.commit()
    await db_session.refresh(cqe)
    await db_session.refresh(design_engineer)
    
    return {"cqe": cqe, "design_engineer": design_engineer}


@pytest.fixture
async def test_supplier(db_session: AsyncSession):
    """创建测试供应商"""
    supplier = Supplier(
        name="测试供应商A",
        code="SUP001",
        contact_person="张三",
        contact_email="supplier@test.com",
        contact_phone="13800138000",
        status="active"
    )
    db_session.add(supplier)
    await db_session.commit()
    await db_session.refresh(supplier)
    return supplier


# ============================================================================
# 测试组 1: 出货数据同步和滚动计算 (Requirements: 2.7.1)
# ============================================================================

@pytest.mark.asyncio
class TestShipmentDataSync:
    """测试出货数据同步功能"""
    
    async def test_sync_shipment_data_basic(self, db_session: AsyncSession):
        """测试基本的出货数据同步"""
        # 执行同步
        result = await IMSIntegrationService.sync_shipment_data(db=db_session)
        
        assert result["status"] == "success"
        assert result["records_synced"] > 0
        
        # 验证数据已写入数据库
        stmt = select(ShipmentData)
        result = await db_session.execute(stmt)
        shipments = result.scalars().all()
        
        assert len(shipments) > 0
        
        # 验证数据字段完整性
        first_shipment = shipments[0]
        assert first_shipment.customer_code is not None
        assert first_shipment.product_type is not None
        assert first_shipment.shipment_date is not None
        assert first_shipment.quantity > 0
    
    async def test_sync_shipment_data_with_date_range(self, db_session: AsyncSession):
        """测试指定日期范围的出货数据同步"""
        start_date = date.today() - timedelta(days=90)
        end_date = date.today()
        
        result = await IMSIntegrationService.sync_shipment_data(
            db=db_session,
            start_date=start_date,
            end_date=end_date
        )
        
        assert result["status"] == "success"
        
        # 验证同步的数据在指定日期范围内
        stmt = select(ShipmentData).where(
            ShipmentData.shipment_date >= start_date,
            ShipmentData.shipment_date <= end_date
        )
        result = await db_session.execute(stmt)
        shipments = result.scalars().all()
        
        for shipment in shipments:
            assert start_date <= shipment.shipment_date <= end_date

    async def test_rolling_shipment_calculation_3_months(self, db_session: AsyncSession):
        """测试3个月滚动出货量计算"""
        # 创建测试数据：过去3个月的出货记录
        today = date.today()
        product_type = "MCU控制器"
        
        for i in range(3):
            month_date = today - timedelta(days=30 * i)
            shipment = ShipmentData(
                customer_code="CUST001",
                product_type=product_type,
                shipment_date=month_date,
                quantity=1000
            )
            db_session.add(shipment)
        
        await db_session.commit()
        
        # 计算3个月滚动出货量
        rolling_qty = await IMSIntegrationService.calculate_rolling_shipment(
            db=db_session,
            product_type=product_type,
            months=3
        )
        
        # 应该是 3000 (1000 * 3个月)
        assert rolling_qty == 3000
    
    async def test_rolling_shipment_calculation_12_months(self, db_session: AsyncSession):
        """测试12个月滚动出货量计算"""
        today = date.today()
        product_type = "电池管理系统"
        
        # 创建12个月的出货数据
        for i in range(12):
            month_date = today - timedelta(days=30 * i)
            shipment = ShipmentData(
                customer_code="CUST002",
                product_type=product_type,
                shipment_date=month_date,
                quantity=500
            )
            db_session.add(shipment)
        
        await db_session.commit()
        
        # 计算12个月滚动出货量
        rolling_qty = await IMSIntegrationService.calculate_rolling_shipment(
            db=db_session,
            product_type=product_type,
            months=12
        )
        
        # 应该是 6000 (500 * 12个月)
        assert rolling_qty == 6000
    
    async def test_rolling_shipment_by_customer(self, db_session: AsyncSession):
        """测试按客户分组的滚动出货量计算"""
        today = date.today()
        product_type = "产品A"
        
        # 为不同客户创建出货数据
        for customer_code in ["CUST001", "CUST002"]:
            for i in range(3):
                month_date = today - timedelta(days=30 * i)
                shipment = ShipmentData(
                    customer_code=customer_code,
                    product_type=product_type,
                    shipment_date=month_date,
                    quantity=1000
                )
                db_session.add(shipment)
        
        await db_session.commit()
        
        # 计算特定客户的滚动出货量
        rolling_qty_cust1 = await IMSIntegrationService.calculate_rolling_shipment(
            db=db_session,
            product_type=product_type,
            customer_code="CUST001",
            months=3
        )
        
        assert rolling_qty_cust1 == 3000


# ============================================================================
# 测试组 2: 8D 闭环流程和时效监控 (Requirements: 2.7.3)
# ============================================================================

@pytest.mark.asyncio
class TestEightDWorkflowAndSLA:
    """测试8D闭环流程和时效管理"""

    async def test_8d_workflow_complete_cycle(self, db_session: AsyncSession, test_users: dict):
        """测试完整的8D闭环流程"""
        cqe = test_users["cqe"]
        design_engineer = test_users["design_engineer"]
        
        # 1. 创建客诉单
        from app.schemas.customer_complaint import CustomerComplaintCreate, ComplaintTypeEnum
        complaint_data = CustomerComplaintCreate(
            complaint_type=ComplaintTypeEnum.ZERO_KM,
            customer_code="CUST001",
            product_type="MCU控制器",
            defect_description="功能测试失败"
        )
        complaint = await CustomerComplaintService.create_complaint(
            db=db_session,
            complaint_data=complaint_data,
            created_by_id=cqe.id
        )
        
        # 2. CQE提交D0-D3一次因解析
        from app.schemas.customer_complaint import PreliminaryAnalysisRequest
        analysis_data = PreliminaryAnalysisRequest(
            emergency_action="冻结库存",
            team_members="CQE团队",
            problem_description_5w2h="问题描述",
            containment_action="围堵措施",
            containment_verification="验证完成",
            responsible_dept="设计部",
            root_cause_preliminary="初步原因分析"
        )
        complaint = await CustomerComplaintService.submit_preliminary_analysis(
            db=db_session,
            complaint_id=complaint.id,
            analysis_data=analysis_data,
            cqe_id=cqe.id
        )
        
        # 3. 责任板块提交D4-D7
        from app.schemas.eight_d_customer import EightDD4D7Request
        d4_d7_data = EightDD4D7Request(
            root_cause_analysis="根本原因：设计缺陷",
            root_cause_method="5Why分析",
            corrective_action="修改设计方案",
            corrective_action_responsible="设计工程师",
            corrective_action_deadline=date.today() + timedelta(days=30),
            verification_plan="验证计划",
            verification_result="验证通过",
            verification_evidence_files=["evidence.pdf"],
            standardization_required=True,
            standardization_documents=["PFMEA_v2.0.pdf"]
        )
        
        eight_d = await EightDCustomerService.submit_d4_d7(
            db=db_session,
            complaint_id=complaint.id,
            d4_d7_data=d4_d7_data,
            submitted_by_id=design_engineer.id
        )
        
        assert eight_d.status == EightDStatus.PENDING_D8
        
        # 4. 提交D8水平展开
        from app.schemas.eight_d_customer import EightDD8Request
        d8_data = EightDD8Request(
            horizontal_deployment="已推送到类似产品",
            similar_products=["产品B", "产品C"],
            lesson_learned_title="设计缺陷经验教训",
            lesson_learned_content="详细经验教训内容",
            preventive_action="预防措施"
        )
        
        eight_d = await EightDCustomerService.submit_d8(
            db=db_session,
            complaint_id=complaint.id,
            d8_data=d8_data,
            submitted_by_id=design_engineer.id
        )
        
        assert eight_d.status == EightDStatus.PENDING_APPROVAL
        
        # 5. 审批通过
        eight_d = await EightDCustomerService.approve_8d(
            db=db_session,
            complaint_id=complaint.id,
            approved_by_id=cqe.id,
            approval_comments="审批通过"
        )
        
        assert eight_d.status == EightDStatus.APPROVED
        
        # 验证客诉单状态更新
        await db_session.refresh(complaint)
        assert complaint.status == ComplaintStatus.CLOSED

    async def test_8d_sla_monitoring_7_days(self, db_session: AsyncSession, test_users: dict):
        """测试8D报告7天提交时效监控"""
        cqe = test_users["cqe"]
        
        # 创建客诉单（模拟8天前创建）
        from app.schemas.customer_complaint import CustomerComplaintCreate, ComplaintTypeEnum
        complaint_data = CustomerComplaintCreate(
            complaint_type=ComplaintTypeEnum.ZERO_KM,
            customer_code="CUST001",
            product_type="产品A",
            defect_description="测试缺陷"
        )
        complaint = await CustomerComplaintService.create_complaint(
            db=db_session,
            complaint_data=complaint_data,
            created_by_id=cqe.id
        )
        
        # 手动修改创建时间为8天前（模拟逾期）
        complaint.created_at = datetime.now() - timedelta(days=8)
        await db_session.commit()
        
        # 检查SLA状态
        sla_status = await EightDCustomerService.check_sla_status(
            db=db_session,
            complaint_id=complaint.id
        )
        
        assert sla_status["is_overdue"] is True
        assert sla_status["days_overdue"] >= 1
        assert sla_status["sla_type"] == "8d_submission"
    
    async def test_8d_sla_monitoring_10_days_archive(self, db_session: AsyncSession, test_users: dict):
        """测试8D报告10天归档时效监控"""
        cqe = test_users["cqe"]
        design_engineer = test_users["design_engineer"]
        
        # 创建客诉单并完成D0-D7
        from app.schemas.customer_complaint import CustomerComplaintCreate, ComplaintTypeEnum, PreliminaryAnalysisRequest
        complaint_data = CustomerComplaintCreate(
            complaint_type=ComplaintTypeEnum.ZERO_KM,
            customer_code="CUST001",
            product_type="产品A",
            defect_description="测试缺陷"
        )
        complaint = await CustomerComplaintService.create_complaint(
            db=db_session,
            complaint_data=complaint_data,
            created_by_id=cqe.id
        )
        
        # 提交D0-D3
        analysis_data = PreliminaryAnalysisRequest(
            emergency_action="冻结",
            team_members="团队",
            problem_description_5w2h="描述",
            containment_action="围堵",
            containment_verification="验证",
            responsible_dept="设计部"
        )
        await CustomerComplaintService.submit_preliminary_analysis(
            db=db_session,
            complaint_id=complaint.id,
            analysis_data=analysis_data,
            cqe_id=cqe.id
        )
        
        # 提交D4-D7
        from app.schemas.eight_d_customer import EightDD4D7Request
        d4_d7_data = EightDD4D7Request(
            root_cause_analysis="根本原因",
            root_cause_method="5Why",
            corrective_action="纠正措施",
            corrective_action_responsible="工程师",
            corrective_action_deadline=date.today() + timedelta(days=30),
            verification_plan="验证计划",
            verification_result="验证结果",
            verification_evidence_files=["file.pdf"],
            standardization_required=False
        )
        await EightDCustomerService.submit_d4_d7(
            db=db_session,
            complaint_id=complaint.id,
            d4_d7_data=d4_d7_data,
            submitted_by_id=design_engineer.id
        )
        
        # 修改创建时间为11天前（模拟归档逾期）
        complaint.created_at = datetime.now() - timedelta(days=11)
        await db_session.commit()
        
        # 检查归档SLA
        sla_status = await EightDCustomerService.check_sla_status(
            db=db_session,
            complaint_id=complaint.id
        )
        
        assert sla_status["is_overdue"] is True
        assert sla_status["sla_type"] == "8d_archive"

    async def test_8d_rejection_workflow(self, db_session: AsyncSession, test_users: dict):
        """测试8D报告驳回流程"""
        cqe = test_users["cqe"]
        design_engineer = test_users["design_engineer"]
        
        # 创建客诉单并提交到D4-D7阶段
        from app.schemas.customer_complaint import CustomerComplaintCreate, ComplaintTypeEnum, PreliminaryAnalysisRequest
        complaint_data = CustomerComplaintCreate(
            complaint_type=ComplaintTypeEnum.ZERO_KM,
            customer_code="CUST001",
            product_type="产品A",
            defect_description="测试缺陷"
        )
        complaint = await CustomerComplaintService.create_complaint(
            db=db_session,
            complaint_data=complaint_data,
            created_by_id=cqe.id
        )
        
        analysis_data = PreliminaryAnalysisRequest(
            emergency_action="冻结",
            team_members="团队",
            problem_description_5w2h="描述",
            containment_action="围堵",
            containment_verification="验证",
            responsible_dept="设计部"
        )
        await CustomerComplaintService.submit_preliminary_analysis(
            db=db_session,
            complaint_id=complaint.id,
            analysis_data=analysis_data,
            cqe_id=cqe.id
        )
        
        from app.schemas.eight_d_customer import EightDD4D7Request
        d4_d7_data = EightDD4D7Request(
            root_cause_analysis="根本原因分析不充分",
            root_cause_method="5Why",
            corrective_action="措施",
            corrective_action_responsible="工程师",
            corrective_action_deadline=date.today() + timedelta(days=30),
            verification_plan="计划",
            verification_result="结果",
            verification_evidence_files=["file.pdf"],
            standardization_required=False
        )
        eight_d = await EightDCustomerService.submit_d4_d7(
            db=db_session,
            complaint_id=complaint.id,
            d4_d7_data=d4_d7_data,
            submitted_by_id=design_engineer.id
        )
        
        # 驳回8D报告
        eight_d = await EightDCustomerService.reject_8d(
            db=db_session,
            complaint_id=complaint.id,
            rejected_by_id=cqe.id,
            rejection_reason="根本原因分析不充分，请使用鱼骨图深入分析"
        )
        
        assert eight_d.status == EightDStatus.REJECTED
        assert eight_d.review_comments == "根本原因分析不充分，请使用鱼骨图深入分析"
        
        # 验证客诉单状态回退
        await db_session.refresh(complaint)
        assert complaint.status == ComplaintStatus.IN_RESPONSE


# ============================================================================
# 测试组 3: 索赔转嫁逻辑 (Requirements: 2.7.4)
# ============================================================================

@pytest.mark.asyncio
class TestClaimsTransferLogic:
    """测试索赔管理和转嫁逻辑"""
    
    async def test_create_customer_claim(self, db_session: AsyncSession, test_users: dict):
        """测试创建客户索赔"""
        cqe = test_users["cqe"]
        
        # 先创建客诉单
        from app.schemas.customer_complaint import CustomerComplaintCreate, ComplaintTypeEnum
        complaint_data = CustomerComplaintCreate(
            complaint_type=ComplaintTypeEnum.ZERO_KM,
            customer_code="CUST001",
            product_type="产品A",
            defect_description="批量不良"
        )
        complaint = await CustomerComplaintService.create_complaint(
            db=db_session,
            complaint_data=complaint_data,
            created_by_id=cqe.id
        )

        # 创建客户索赔
        from app.schemas.customer_claim import CustomerClaimCreate
        claim_data = CustomerClaimCreate(
            customer_name="客户A公司",
            claim_amount=Decimal("50000.00"),
            claim_currency="CNY",
            claim_date=date.today(),
            claim_reason="批量不良导致产线停工",
            related_complaint_ids=[complaint.id]
        )
        
        claim = await CustomerClaimService.create_claim(
            db=db_session,
            claim_data=claim_data,
            created_by_id=cqe.id
        )
        
        assert claim.id is not None
        assert claim.customer_name == "客户A公司"
        assert claim.claim_amount == Decimal("50000.00")
        assert claim.claim_currency == "CNY"
        assert len(claim.related_complaint_ids) == 1
        assert claim.related_complaint_ids[0] == complaint.id
    
    async def test_link_multiple_complaints_to_claim(self, db_session: AsyncSession, test_users: dict):
        """测试将多个客诉单关联到一个索赔"""
        cqe = test_users["cqe"]
        
        # 创建多个客诉单
        from app.schemas.customer_complaint import CustomerComplaintCreate, ComplaintTypeEnum
        complaint_ids = []
        for i in range(3):
            complaint_data = CustomerComplaintCreate(
                complaint_type=ComplaintTypeEnum.ZERO_KM,
                customer_code="CUST001",
                product_type=f"产品{i}",
                defect_description=f"缺陷{i}"
            )
            complaint = await CustomerComplaintService.create_complaint(
                db=db_session,
                complaint_data=complaint_data,
                created_by_id=cqe.id
            )
            complaint_ids.append(complaint.id)
        
        # 创建索赔并关联多个客诉单
        from app.schemas.customer_claim import CustomerClaimCreate
        claim_data = CustomerClaimCreate(
            customer_name="客户B公司",
            claim_amount=Decimal("100000.00"),
            claim_currency="CNY",
            claim_date=date.today(),
            claim_reason="多批次质量问题",
            related_complaint_ids=complaint_ids
        )
        
        claim = await CustomerClaimService.create_claim(
            db=db_session,
            claim_data=claim_data,
            created_by_id=cqe.id
        )
        
        assert len(claim.related_complaint_ids) == 3
        assert set(claim.related_complaint_ids) == set(complaint_ids)
    
    async def test_transfer_claim_to_supplier(self, db_session: AsyncSession, test_users: dict, test_supplier: Supplier):
        """测试一键转嫁索赔到供应商"""
        cqe = test_users["cqe"]
        
        # 创建客诉单（责任判定为供应商来料问题）
        from app.schemas.customer_complaint import CustomerComplaintCreate, ComplaintTypeEnum, PreliminaryAnalysisRequest
        complaint_data = CustomerComplaintCreate(
            complaint_type=ComplaintTypeEnum.ZERO_KM,
            customer_code="CUST001",
            product_type="产品A",
            defect_description="物料不良"
        )
        complaint = await CustomerComplaintService.create_complaint(
            db=db_session,
            complaint_data=complaint_data,
            created_by_id=cqe.id
        )
        
        # 提交一次因解析，判定为供应商责任
        analysis_data = PreliminaryAnalysisRequest(
            emergency_action="冻结库存",
            team_members="团队",
            problem_description_5w2h="供应商来料不良",
            containment_action="围堵",
            containment_verification="验证",
            responsible_dept="供应商",
            root_cause_preliminary="供应商物料质量问题"
        )
        await CustomerComplaintService.submit_preliminary_analysis(
            db=db_session,
            complaint_id=complaint.id,
            analysis_data=analysis_data,
            cqe_id=cqe.id
        )

        # 创建客户索赔
        from app.schemas.customer_claim import CustomerClaimCreate
        customer_claim_data = CustomerClaimCreate(
            customer_name="客户C公司",
            claim_amount=Decimal("80000.00"),
            claim_currency="CNY",
            claim_date=date.today(),
            claim_reason="供应商来料不良",
            related_complaint_ids=[complaint.id]
        )
        customer_claim = await CustomerClaimService.create_claim(
            db=db_session,
            claim_data=customer_claim_data,
            created_by_id=cqe.id
        )
        
        # 一键转嫁到供应商
        supplier_claim = await SupplierClaimService.transfer_from_customer_claim(
            db=db_session,
            customer_claim_id=customer_claim.id,
            supplier_id=test_supplier.id,
            material_code="MAT001",
            transfer_ratio=Decimal("1.0"),  # 100%转嫁
            created_by_id=cqe.id
        )
        
        assert supplier_claim.id is not None
        assert supplier_claim.supplier_id == test_supplier.id
        assert supplier_claim.claim_amount == Decimal("80000.00")
        assert supplier_claim.material_code == "MAT001"
        assert supplier_claim.source_customer_claim_id == customer_claim.id
        assert len(supplier_claim.related_complaint_ids) == 1
    
    async def test_partial_transfer_claim_to_supplier(self, db_session: AsyncSession, test_users: dict, test_supplier: Supplier):
        """测试部分转嫁索赔到供应商"""
        cqe = test_users["cqe"]
        
        # 创建客诉单
        from app.schemas.customer_complaint import CustomerComplaintCreate, ComplaintTypeEnum
        complaint_data = CustomerComplaintCreate(
            complaint_type=ComplaintTypeEnum.ZERO_KM,
            customer_code="CUST001",
            product_type="产品A",
            defect_description="混合责任问题"
        )
        complaint = await CustomerComplaintService.create_complaint(
            db=db_session,
            complaint_data=complaint_data,
            created_by_id=cqe.id
        )
        
        # 创建客户索赔
        from app.schemas.customer_claim import CustomerClaimCreate
        customer_claim_data = CustomerClaimCreate(
            customer_name="客户D公司",
            claim_amount=Decimal("100000.00"),
            claim_currency="CNY",
            claim_date=date.today(),
            claim_reason="混合责任",
            related_complaint_ids=[complaint.id]
        )
        customer_claim = await CustomerClaimService.create_claim(
            db=db_session,
            claim_data=customer_claim_data,
            created_by_id=cqe.id
        )
        
        # 部分转嫁（60%）到供应商
        supplier_claim = await SupplierClaimService.transfer_from_customer_claim(
            db=db_session,
            customer_claim_id=customer_claim.id,
            supplier_id=test_supplier.id,
            material_code="MAT002",
            transfer_ratio=Decimal("0.6"),  # 60%转嫁
            created_by_id=cqe.id
        )
        
        # 验证转嫁金额
        assert supplier_claim.claim_amount == Decimal("60000.00")  # 100000 * 0.6
    
    async def test_claim_statistics(self, db_session: AsyncSession, test_users: dict, test_supplier: Supplier):
        """测试索赔统计功能"""
        cqe = test_users["cqe"]
        
        # 创建多个客户索赔
        from app.schemas.customer_claim import CustomerClaimCreate
        for i in range(3):
            claim_data = CustomerClaimCreate(
                customer_name=f"客户{i}",
                claim_amount=Decimal(f"{(i+1) * 10000}.00"),
                claim_currency="CNY",
                claim_date=date.today(),
                claim_reason=f"原因{i}"
            )
            await CustomerClaimService.create_claim(
                db=db_session,
                claim_data=claim_data,
                created_by_id=cqe.id
            )
        
        # 获取统计数据
        stats = await CustomerClaimService.get_claim_statistics(
            db=db_session,
            start_date=date.today() - timedelta(days=30),
            end_date=date.today()
        )
        
        assert stats["total_claims"] >= 3
        assert stats["total_amount"] >= Decimal("60000.00")  # 10000 + 20000 + 30000


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
