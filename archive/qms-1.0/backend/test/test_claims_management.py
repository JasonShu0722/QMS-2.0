"""
Claims Management Module Tests
索赔管理模块测试 - 测试客户索赔和供应商索赔的完整功能
"""
import pytest
from datetime import date, datetime
from decimal import Decimal
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.customer_complaint import CustomerComplaint, ComplaintType, ComplaintStatus, SeverityLevel
from app.models.customer_claim import CustomerClaim
from app.models.supplier_claim import SupplierClaim, SupplierClaimStatus
from app.models.supplier import Supplier
from app.models.user import User, UserType
from app.schemas.customer_claim import CustomerClaimCreate, CustomerClaimUpdate
from app.schemas.supplier_claim import (
    SupplierClaimCreate,
    SupplierClaimFromComplaint,
    SupplierClaimUpdate
)
from app.services.customer_claim_service import CustomerClaimService
from app.services.supplier_claim_service import SupplierClaimService


@pytest.fixture
async def test_user(db_session: AsyncSession):
    """创建测试用户"""
    user = User(
        username="test_cqe",
        hashed_password="hashed_password",
        full_name="测试CQE",
        email="cqe@test.com",
        user_type=UserType.INTERNAL,
        status="active"
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


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


@pytest.fixture
async def test_complaint(db_session: AsyncSession, test_user: User):
    """创建测试客诉单"""
    complaint = CustomerComplaint(
        complaint_number="COMP-2026-001",
        complaint_type=ComplaintType.ZERO_KM,
        customer_code="CUST001",
        product_type="MCU控制器",
        defect_description="产品功能失效",
        severity_level=SeverityLevel.MAJOR,
        status=ComplaintStatus.PENDING,
        created_by=test_user.id
    )
    db_session.add(complaint)
    await db_session.commit()
    await db_session.refresh(complaint)
    return complaint


class TestCustomerClaimService:
    """客户索赔服务测试"""

    @pytest.mark.asyncio
    async def test_create_customer_claim(
        self,
        db_session: AsyncSession,
        test_complaint: CustomerComplaint,
        test_user: User
    ):
        """测试创建客户索赔记录"""
        # 准备数据
        claim_data = CustomerClaimCreate(
            complaint_id=test_complaint.id,
            claim_amount=Decimal("50000.00"),
            claim_currency="CNY",
            claim_date=date.today(),
            customer_name="某汽车制造商",
            claim_description="产品质量问题导致产线停工",
            claim_reference="CLAIM-2026-001"
        )
        
        # 创建索赔
        claim = await CustomerClaimService.create_claim(
            db=db_session,
            claim_data=claim_data,
            created_by=test_user.id
        )
        
        # 验证结果
        assert claim.id is not None
        assert claim.complaint_id == test_complaint.id
        assert claim.claim_amount == Decimal("50000.00")
        assert claim.claim_currency == "CNY"
        assert claim.customer_name == "某汽车制造商"
        assert claim.created_by == test_user.id

    @pytest.mark.asyncio
    async def test_create_customer_claim_invalid_complaint(
        self,
        db_session: AsyncSession,
        test_user: User
    ):
        """测试创建客户索赔 - 客诉单不存在"""
        claim_data = CustomerClaimCreate(
            complaint_id=99999,  # 不存在的客诉单ID
            claim_amount=Decimal("10000.00"),
            claim_currency="CNY",
            claim_date=date.today(),
            customer_name="测试客户"
        )
        
        # 应该抛出异常
        with pytest.raises(ValueError, match="客诉单ID 99999 不存在"):
            await CustomerClaimService.create_claim(
                db=db_session,
                claim_data=claim_data,
                created_by=test_user.id
            )

    @pytest.mark.asyncio
    async def test_list_customer_claims(
        self,
        db_session: AsyncSession,
        test_complaint: CustomerComplaint,
        test_user: User
    ):
        """测试获取客户索赔列表"""
        # 创建多个索赔记录
        for i in range(3):
            claim_data = CustomerClaimCreate(
                complaint_id=test_complaint.id,
                claim_amount=Decimal(f"{10000 * (i + 1)}.00"),
                claim_currency="CNY",
                claim_date=date.today(),
                customer_name=f"客户{i + 1}"
            )
            await CustomerClaimService.create_claim(
                db=db_session,
                claim_data=claim_data,
                created_by=test_user.id
            )
        
        # 获取列表
        claims, total = await CustomerClaimService.list_claims(
            db=db_session,
            skip=0,
            limit=10
        )
        
        # 验证结果
        assert total == 3
        assert len(claims) == 3
        assert claims[0].claim_amount >= claims[1].claim_amount  # 按日期倒序

    @pytest.mark.asyncio
    async def test_update_customer_claim(
        self,
        db_session: AsyncSession,
        test_complaint: CustomerComplaint,
        test_user: User
    ):
        """测试更新客户索赔记录"""
        # 创建索赔
        claim_data = CustomerClaimCreate(
            complaint_id=test_complaint.id,
            claim_amount=Decimal("10000.00"),
            claim_currency="CNY",
            claim_date=date.today(),
            customer_name="原客户名称"
        )
        claim = await CustomerClaimService.create_claim(
            db=db_session,
            claim_data=claim_data,
            created_by=test_user.id
        )
        
        # 更新索赔
        update_data = CustomerClaimUpdate(
            claim_amount=Decimal("15000.00"),
            customer_name="更新后的客户名称"
        )
        updated_claim = await CustomerClaimService.update_claim(
            db=db_session,
            claim_id=claim.id,
            claim_data=update_data
        )
        
        # 验证结果
        assert updated_claim.claim_amount == Decimal("15000.00")
        assert updated_claim.customer_name == "更新后的客户名称"

    @pytest.mark.asyncio
    async def test_get_customer_claim_statistics(
        self,
        db_session: AsyncSession,
        test_complaint: CustomerComplaint,
        test_user: User
    ):
        """测试获取客户索赔统计数据"""
        # 创建多个索赔记录
        claim_data_1 = CustomerClaimCreate(
            complaint_id=test_complaint.id,
            claim_amount=Decimal("10000.00"),
            claim_currency="CNY",
            claim_date=date.today(),
            customer_name="客户A"
        )
        await CustomerClaimService.create_claim(
            db=db_session,
            claim_data=claim_data_1,
            created_by=test_user.id
        )
        
        claim_data_2 = CustomerClaimCreate(
            complaint_id=test_complaint.id,
            claim_amount=Decimal("20000.00"),
            claim_currency="CNY",
            claim_date=date.today(),
            customer_name="客户A"
        )
        await CustomerClaimService.create_claim(
            db=db_session,
            claim_data=claim_data_2,
            created_by=test_user.id
        )
        
        # 获取统计数据
        statistics = await CustomerClaimService.get_statistics(db=db_session)
        
        # 验证结果
        assert statistics.total_claims == 2
        assert statistics.total_amount == Decimal("30000.00")
        assert "客户A" in statistics.by_customer
        assert statistics.by_customer["客户A"] == Decimal("30000.00")


class TestSupplierClaimService:
    """供应商索赔服务测试"""

    @pytest.mark.asyncio
    async def test_create_supplier_claim(
        self,
        db_session: AsyncSession,
        test_supplier: Supplier,
        test_user: User
    ):
        """测试创建供应商索赔记录"""
        # 准备数据
        claim_data = SupplierClaimCreate(
            supplier_id=test_supplier.id,
            claim_amount=Decimal("30000.00"),
            claim_currency="CNY",
            claim_date=date.today(),
            claim_description="来料不良导致批量返工",
            material_code="MAT001",
            defect_qty=500
        )
        
        # 创建索赔
        claim = await SupplierClaimService.create_claim(
            db=db_session,
            claim_data=claim_data,
            created_by=test_user.id
        )
        
        # 验证结果
        assert claim.id is not None
        assert claim.supplier_id == test_supplier.id
        assert claim.claim_amount == Decimal("30000.00")
        assert claim.status == SupplierClaimStatus.DRAFT
        assert claim.material_code == "MAT001"
        assert claim.defect_qty == 500

    @pytest.mark.asyncio
    async def test_create_supplier_claim_from_complaint(
        self,
        db_session: AsyncSession,
        test_complaint: CustomerComplaint,
        test_supplier: Supplier,
        test_user: User
    ):
        """测试从客诉单一键转嫁生成供应商索赔"""
        # 准备转嫁数据
        claim_data = SupplierClaimFromComplaint(
            complaint_id=test_complaint.id,
            supplier_id=test_supplier.id,
            claim_amount=Decimal("50000.00"),
            claim_currency="CNY",
            material_code="MAT001",
            defect_qty=1000,
            claim_description="客诉转嫁 - 供应商来料问题"
        )
        
        # 创建转嫁索赔
        claim = await SupplierClaimService.create_claim_from_complaint(
            db=db_session,
            claim_data=claim_data,
            created_by=test_user.id
        )
        
        # 验证结果
        assert claim.id is not None
        assert claim.complaint_id == test_complaint.id
        assert claim.supplier_id == test_supplier.id
        assert claim.claim_amount == Decimal("50000.00")
        assert claim.status == SupplierClaimStatus.DRAFT
        assert "客诉转嫁" in claim.claim_description or test_complaint.complaint_number in claim.claim_description

    @pytest.mark.asyncio
    async def test_update_supplier_claim_status(
        self,
        db_session: AsyncSession,
        test_supplier: Supplier,
        test_user: User
    ):
        """测试更新供应商索赔状态"""
        # 创建索赔
        claim_data = SupplierClaimCreate(
            supplier_id=test_supplier.id,
            claim_amount=Decimal("10000.00"),
            claim_currency="CNY",
            claim_date=date.today()
        )
        claim = await SupplierClaimService.create_claim(
            db=db_session,
            claim_data=claim_data,
            created_by=test_user.id
        )
        
        # 更新状态和协商记录
        update_data = SupplierClaimUpdate(
            status=SupplierClaimStatus.UNDER_NEGOTIATION,
            negotiation_notes="已与供应商沟通，正在协商金额",
            final_amount=Decimal("8000.00")
        )
        updated_claim = await SupplierClaimService.update_claim(
            db=db_session,
            claim_id=claim.id,
            claim_data=update_data
        )
        
        # 验证结果
        assert updated_claim.status == SupplierClaimStatus.UNDER_NEGOTIATION
        assert updated_claim.negotiation_notes == "已与供应商沟通，正在协商金额"
        assert updated_claim.final_amount == Decimal("8000.00")

    @pytest.mark.asyncio
    async def test_list_supplier_claims_with_filters(
        self,
        db_session: AsyncSession,
        test_supplier: Supplier,
        test_user: User
    ):
        """测试获取供应商索赔列表（带筛选）"""
        # 创建多个索赔记录
        for i in range(3):
            claim_data = SupplierClaimCreate(
                supplier_id=test_supplier.id,
                claim_amount=Decimal(f"{5000 * (i + 1)}.00"),
                claim_currency="CNY",
                claim_date=date.today()
            )
            await SupplierClaimService.create_claim(
                db=db_session,
                claim_data=claim_data,
                created_by=test_user.id
            )
        
        # 按供应商筛选
        claims, total = await SupplierClaimService.list_claims(
            db=db_session,
            supplier_id=test_supplier.id,
            skip=0,
            limit=10
        )
        
        # 验证结果
        assert total == 3
        assert len(claims) == 3
        assert all(claim.supplier_id == test_supplier.id for claim in claims)

    @pytest.mark.asyncio
    async def test_get_supplier_claim_statistics(
        self,
        db_session: AsyncSession,
        test_supplier: Supplier,
        test_user: User
    ):
        """测试获取供应商索赔统计数据"""
        # 创建多个索赔记录
        claim_data_1 = SupplierClaimCreate(
            supplier_id=test_supplier.id,
            claim_amount=Decimal("10000.00"),
            claim_currency="CNY",
            claim_date=date.today()
        )
        await SupplierClaimService.create_claim(
            db=db_session,
            claim_data=claim_data_1,
            created_by=test_user.id
        )
        
        claim_data_2 = SupplierClaimCreate(
            supplier_id=test_supplier.id,
            claim_amount=Decimal("20000.00"),
            claim_currency="CNY",
            claim_date=date.today()
        )
        claim_2 = await SupplierClaimService.create_claim(
            db=db_session,
            claim_data=claim_data_2,
            created_by=test_user.id
        )
        
        # 更新一个索赔的状态
        await SupplierClaimService.update_claim(
            db=db_session,
            claim_id=claim_2.id,
            claim_data=SupplierClaimUpdate(status=SupplierClaimStatus.ACCEPTED)
        )
        
        # 获取统计数据
        statistics = await SupplierClaimService.get_statistics(db=db_session)
        
        # 验证结果
        assert statistics.total_claims == 2
        assert statistics.total_amount == Decimal("30000.00")
        assert test_supplier.name in statistics.by_supplier
        assert statistics.by_supplier[test_supplier.name] == Decimal("30000.00")
        assert statistics.by_status["draft"] == 1
        assert statistics.by_status["accepted"] == 1


class TestClaimsIntegration:
    """索赔管理集成测试"""

    @pytest.mark.asyncio
    async def test_complete_claim_workflow(
        self,
        db_session: AsyncSession,
        test_complaint: CustomerComplaint,
        test_supplier: Supplier,
        test_user: User
    ):
        """测试完整的索赔工作流程"""
        # 1. 创建客户索赔
        customer_claim_data = CustomerClaimCreate(
            complaint_id=test_complaint.id,
            claim_amount=Decimal("100000.00"),
            claim_currency="CNY",
            claim_date=date.today(),
            customer_name="某汽车制造商",
            claim_description="批量质量问题导致召回"
        )
        customer_claim = await CustomerClaimService.create_claim(
            db=db_session,
            claim_data=customer_claim_data,
            created_by=test_user.id
        )
        
        assert customer_claim.id is not None
        
        # 2. 从客诉单一键转嫁给供应商
        supplier_claim_data = SupplierClaimFromComplaint(
            complaint_id=test_complaint.id,
            supplier_id=test_supplier.id,
            claim_amount=Decimal("80000.00"),  # 部分转嫁
            claim_currency="CNY",
            material_code="MAT001",
            defect_qty=1000
        )
        supplier_claim = await SupplierClaimService.create_claim_from_complaint(
            db=db_session,
            claim_data=supplier_claim_data,
            created_by=test_user.id
        )
        
        assert supplier_claim.id is not None
        assert supplier_claim.complaint_id == test_complaint.id
        
        # 3. 更新供应商索赔状态（协商过程）
        await SupplierClaimService.update_claim(
            db=db_session,
            claim_id=supplier_claim.id,
            claim_data=SupplierClaimUpdate(
                status=SupplierClaimStatus.UNDER_NEGOTIATION,
                negotiation_notes="供应商同意承担70%责任"
            )
        )
        
        # 4. 最终确认索赔金额
        final_claim = await SupplierClaimService.update_claim(
            db=db_session,
            claim_id=supplier_claim.id,
            claim_data=SupplierClaimUpdate(
                status=SupplierClaimStatus.ACCEPTED,
                final_amount=Decimal("56000.00"),  # 80000 * 0.7
                payment_date=date.today()
            )
        )
        
        # 验证最终结果
        assert final_claim.status == SupplierClaimStatus.ACCEPTED
        assert final_claim.final_amount == Decimal("56000.00")
        assert final_claim.payment_date is not None
        
        # 5. 验证统计数据
        customer_stats = await CustomerClaimService.get_statistics(db=db_session)
        supplier_stats = await SupplierClaimService.get_statistics(db=db_session)
        
        assert customer_stats.total_claims == 1
        assert customer_stats.total_amount == Decimal("100000.00")
        assert supplier_stats.total_claims == 1
        assert supplier_stats.total_amount == Decimal("80000.00")
