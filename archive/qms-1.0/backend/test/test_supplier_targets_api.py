"""
供应商质量目标管理 API 测试
Test Supplier Target API - 测试目标设定、签署、审批功能
"""
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime

from app.models.user import User, UserType
from app.models.supplier import Supplier
from app.models.supplier_target import SupplierTarget, TargetType


@pytest.fixture
async def test_supplier(db_session: AsyncSession):
    """创建测试供应商"""
    supplier = Supplier(
        name="测试供应商A",
        code="SUP001",
        contact_person="张三",
        contact_email="zhangsan@supplier.com",
        contact_phone="13800138000",
        status="active"
    )
    db_session.add(supplier)
    await db_session.commit()
    await db_session.refresh(supplier)
    return supplier


@pytest.fixture
async def test_sqe_user(db_session: AsyncSession):
    """创建测试SQE用户"""
    user = User(
        username="sqe_test",
        hashed_password="hashed_password",
        full_name="SQE测试用户",
        email="sqe@company.com",
        user_type=UserType.INTERNAL,
        department="质量部",
        position="SQE",
        status="active"
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest.fixture
async def test_supplier_user(db_session: AsyncSession, test_supplier: Supplier):
    """创建测试供应商用户"""
    user = User(
        username="supplier_test",
        hashed_password="hashed_password",
        full_name="供应商测试用户",
        email="user@supplier.com",
        user_type=UserType.SUPPLIER,
        supplier_id=test_supplier.id,
        status="active"
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest.mark.asyncio
class TestBatchTargetCreation:
    """测试批量设定目标"""
    
    async def test_batch_create_targets_success(
        self,
        client: AsyncClient,
        test_sqe_user: User,
        test_supplier: Supplier,
        db_session: AsyncSession
    ):
        """测试批量创建目标成功"""
        # 创建多个供应商
        suppliers = []
        for i in range(3):
            supplier = Supplier(
                name=f"供应商{i}",
                code=f"SUP00{i+2}",
                contact_person=f"联系人{i}",
                contact_email=f"contact{i}@supplier.com",
                status="active"
            )
            db_session.add(supplier)
            suppliers.append(supplier)
        
        await db_session.commit()
        supplier_ids = [s.id for s in suppliers]
        
        # 批量设定目标
        response = await client.post(
            "/api/v1/supplier-targets/batch",
            json={
                "year": 2026,
                "target_type": "incoming_pass_rate",
                "target_value": 99.8,
                "supplier_ids": supplier_ids
            },
            headers={"Authorization": f"Bearer {test_sqe_user.id}"}
        )
        
        assert response.status_code == 201
        data = response.json()
        assert data["success_count"] == 3
        assert data["failed_count"] == 0
        assert len(data["created_targets"]) == 3
    
    async def test_batch_create_targets_skip_individual(
        self,
        client: AsyncClient,
        test_sqe_user: User,
        test_supplier: Supplier,
        db_session: AsyncSession
    ):
        """测试批量设定不覆盖单独设定"""
        # 先创建单独设定
        individual_target = SupplierTarget(
            supplier_id=test_supplier.id,
            year=2026,
            target_type=TargetType.INCOMING_PASS_RATE,
            target_value=99.9,
            is_individual=True,
            created_by=test_sqe_user.id
        )
        db_session.add(individual_target)
        await db_session.commit()
        
        # 批量设定
        response = await client.post(
            "/api/v1/supplier-targets/batch",
            json={
                "year": 2026,
                "target_type": "incoming_pass_rate",
                "target_value": 99.8,
                "supplier_ids": [test_supplier.id]
            },
            headers={"Authorization": f"Bearer {test_sqe_user.id}"}
        )
        
        assert response.status_code == 201
        data = response.json()
        assert data["success_count"] == 0
        assert data["failed_count"] == 1
        assert "单独设定" in data["failed_suppliers"][0]["reason"]


@pytest.mark.asyncio
class TestIndividualTargetCreation:
    """测试单独设定目标"""
    
    async def test_create_individual_target_success(
        self,
        client: AsyncClient,
        test_sqe_user: User,
        test_supplier: Supplier
    ):
        """测试单独创建目标成功"""
        response = await client.post(
            "/api/v1/supplier-targets/individual",
            json={
                "supplier_id": test_supplier.id,
                "year": 2026,
                "target_type": "material_ppm",
                "target_value": 500.0,
                "previous_year_actual": 650.0
            },
            headers={"Authorization": f"Bearer {test_sqe_user.id}"}
        )
        
        assert response.status_code == 201
        data = response.json()
        assert data["supplier_id"] == test_supplier.id
        assert data["year"] == 2026
        assert data["target_type"] == "material_ppm"
        assert data["target_value"] == 500.0
        assert data["is_individual"] is True
        assert data["previous_year_actual"] == 650.0
    
    async def test_create_individual_target_override_batch(
        self,
        client: AsyncClient,
        test_sqe_user: User,
        test_supplier: Supplier,
        db_session: AsyncSession
    ):
        """测试单独设定覆盖批量设定"""
        # 先创建批量设定
        batch_target = SupplierTarget(
            supplier_id=test_supplier.id,
            year=2026,
            target_type=TargetType.MATERIAL_PPM,
            target_value=600.0,
            is_individual=False,
            created_by=test_sqe_user.id
        )
        db_session.add(batch_target)
        await db_session.commit()
        
        # 单独设定
        response = await client.post(
            "/api/v1/supplier-targets/individual",
            json={
                "supplier_id": test_supplier.id,
                "year": 2026,
                "target_type": "material_ppm",
                "target_value": 500.0
            },
            headers={"Authorization": f"Bearer {test_sqe_user.id}"}
        )
        
        assert response.status_code == 201
        data = response.json()
        assert data["is_individual"] is True
        assert data["target_value"] == 500.0
    
    async def test_update_individual_target_reset_approval(
        self,
        client: AsyncClient,
        test_sqe_user: User,
        test_supplier: Supplier,
        db_session: AsyncSession
    ):
        """测试更新目标后重置审批状态"""
        # 创建已审批的目标
        target = SupplierTarget(
            supplier_id=test_supplier.id,
            year=2026,
            target_type=TargetType.MATERIAL_PPM,
            target_value=500.0,
            is_individual=True,
            is_approved=True,
            approved_by=test_sqe_user.id,
            approved_at=datetime.utcnow(),
            created_by=test_sqe_user.id
        )
        db_session.add(target)
        await db_session.commit()
        await db_session.refresh(target)
        
        # 更新目标值
        response = await client.put(
            f"/api/v1/supplier-targets/individual/{target.id}",
            json={
                "target_value": 480.0
            },
            headers={"Authorization": f"Bearer {test_sqe_user.id}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["target_value"] == 480.0
        assert data["is_approved"] is False  # 审批状态已重置
        assert data["approved_at"] is None


@pytest.mark.asyncio
class TestTargetSigning:
    """测试供应商签署目标"""
    
    async def test_sign_target_success(
        self,
        client: AsyncClient,
        test_supplier_user: User,
        test_supplier: Supplier,
        test_sqe_user: User,
        db_session: AsyncSession
    ):
        """测试签署目标成功"""
        # 创建已审批的目标
        target = SupplierTarget(
            supplier_id=test_supplier.id,
            year=2026,
            target_type=TargetType.INCOMING_PASS_RATE,
            target_value=99.8,
            is_individual=True,
            is_approved=True,
            approved_by=test_sqe_user.id,
            approved_at=datetime.utcnow(),
            created_by=test_sqe_user.id
        )
        db_session.add(target)
        await db_session.commit()
        await db_session.refresh(target)
        
        # 供应商签署
        response = await client.post(
            f"/api/v1/supplier-targets/{target.id}/sign",
            json={"confirm": True},
            headers={"Authorization": f"Bearer {test_supplier_user.id}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["is_signed"] is True
        assert data["signed_by"] == test_supplier_user.id
        assert data["signed_at"] is not None
    
    async def test_sign_target_not_approved(
        self,
        client: AsyncClient,
        test_supplier_user: User,
        test_supplier: Supplier,
        test_sqe_user: User,
        db_session: AsyncSession
    ):
        """测试签署未审批的目标失败"""
        # 创建未审批的目标
        target = SupplierTarget(
            supplier_id=test_supplier.id,
            year=2026,
            target_type=TargetType.INCOMING_PASS_RATE,
            target_value=99.8,
            is_individual=True,
            is_approved=False,
            created_by=test_sqe_user.id
        )
        db_session.add(target)
        await db_session.commit()
        await db_session.refresh(target)
        
        # 供应商签署
        response = await client.post(
            f"/api/v1/supplier-targets/{target.id}/sign",
            json={"confirm": True},
            headers={"Authorization": f"Bearer {test_supplier_user.id}"}
        )
        
        assert response.status_code == 400
        assert "尚未审批" in response.json()["detail"]
    
    async def test_sign_target_wrong_supplier(
        self,
        client: AsyncClient,
        test_supplier_user: User,
        test_sqe_user: User,
        db_session: AsyncSession
    ):
        """测试签署其他供应商的目标失败"""
        # 创建另一个供应商
        other_supplier = Supplier(
            name="其他供应商",
            code="SUP999",
            contact_person="李四",
            contact_email="lisi@supplier.com",
            status="active"
        )
        db_session.add(other_supplier)
        await db_session.commit()
        
        # 创建其他供应商的目标
        target = SupplierTarget(
            supplier_id=other_supplier.id,
            year=2026,
            target_type=TargetType.INCOMING_PASS_RATE,
            target_value=99.8,
            is_individual=True,
            is_approved=True,
            approved_by=test_sqe_user.id,
            approved_at=datetime.utcnow(),
            created_by=test_sqe_user.id
        )
        db_session.add(target)
        await db_session.commit()
        await db_session.refresh(target)
        
        # 供应商签署
        response = await client.post(
            f"/api/v1/supplier-targets/{target.id}/sign",
            json={"confirm": True},
            headers={"Authorization": f"Bearer {test_supplier_user.id}"}
        )
        
        assert response.status_code == 400
        assert "无权签署" in response.json()["detail"]


@pytest.mark.asyncio
class TestTargetApproval:
    """测试质量经理审批目标"""
    
    async def test_approve_targets_success(
        self,
        client: AsyncClient,
        test_sqe_user: User,
        test_supplier: Supplier,
        db_session: AsyncSession
    ):
        """测试批量审批目标成功"""
        # 创建多个目标
        targets = []
        for i in range(3):
            target = SupplierTarget(
                supplier_id=test_supplier.id,
                year=2026,
                target_type=TargetType.INCOMING_PASS_RATE,
                target_value=99.8,
                is_individual=True,
                is_approved=False,
                created_by=test_sqe_user.id
            )
            db_session.add(target)
            targets.append(target)
        
        await db_session.commit()
        target_ids = [t.id for t in targets]
        
        # 批量审批
        response = await client.post(
            "/api/v1/supplier-targets/approve",
            json={
                "target_ids": target_ids,
                "approve": True,
                "comment": "目标设定合理，批准发布"
            },
            headers={"Authorization": f"Bearer {test_sqe_user.id}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["success_count"] == 3
        assert data["failed_count"] == 0


@pytest.mark.asyncio
class TestTargetQuery:
    """测试目标查询"""
    
    async def test_get_targets_list(
        self,
        client: AsyncClient,
        test_sqe_user: User,
        test_supplier: Supplier,
        db_session: AsyncSession
    ):
        """测试查询目标列表"""
        # 创建多个目标
        for i in range(5):
            target = SupplierTarget(
                supplier_id=test_supplier.id,
                year=2026,
                target_type=TargetType.INCOMING_PASS_RATE,
                target_value=99.8 + i * 0.1,
                is_individual=i % 2 == 0,
                created_by=test_sqe_user.id
            )
            db_session.add(target)
        
        await db_session.commit()
        
        # 查询列表
        response = await client.get(
            "/api/v1/supplier-targets",
            params={"supplier_id": test_supplier.id, "year": 2026},
            headers={"Authorization": f"Bearer {test_sqe_user.id}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 5
        assert len(data["items"]) == 5
    
    async def test_supplier_user_only_see_own_targets(
        self,
        client: AsyncClient,
        test_supplier_user: User,
        test_supplier: Supplier,
        test_sqe_user: User,
        db_session: AsyncSession
    ):
        """测试供应商用户仅能查看自己的目标"""
        # 创建本供应商的目标
        target1 = SupplierTarget(
            supplier_id=test_supplier.id,
            year=2026,
            target_type=TargetType.INCOMING_PASS_RATE,
            target_value=99.8,
            is_individual=True,
            created_by=test_sqe_user.id
        )
        db_session.add(target1)
        
        # 创建其他供应商
        other_supplier = Supplier(
            name="其他供应商",
            code="SUP999",
            contact_person="李四",
            contact_email="lisi@supplier.com",
            status="active"
        )
        db_session.add(other_supplier)
        await db_session.flush()
        
        # 创建其他供应商的目标
        target2 = SupplierTarget(
            supplier_id=other_supplier.id,
            year=2026,
            target_type=TargetType.INCOMING_PASS_RATE,
            target_value=99.5,
            is_individual=True,
            created_by=test_sqe_user.id
        )
        db_session.add(target2)
        await db_session.commit()
        
        # 供应商用户查询
        response = await client.get(
            "/api/v1/supplier-targets",
            headers={"Authorization": f"Bearer {test_supplier_user.id}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 1  # 仅能看到自己的目标
        assert data["items"][0]["supplier_id"] == test_supplier.id


@pytest.mark.asyncio
class TestSigningPermission:
    """测试签署互锁机制"""
    
    async def test_check_signing_permission_all_signed(
        self,
        client: AsyncClient,
        test_supplier_user: User,
        test_supplier: Supplier,
        test_sqe_user: User,
        db_session: AsyncSession
    ):
        """测试所有目标已签署，拥有申诉权限"""
        # 创建已签署的目标
        target = SupplierTarget(
            supplier_id=test_supplier.id,
            year=2026,
            target_type=TargetType.INCOMING_PASS_RATE,
            target_value=99.8,
            is_individual=True,
            is_approved=True,
            is_signed=True,
            signed_by=test_supplier_user.id,
            signed_at=datetime.utcnow(),
            created_by=test_sqe_user.id
        )
        db_session.add(target)
        await db_session.commit()
        
        # 检查权限
        response = await client.get(
            f"/api/v1/supplier-targets/check-permission/{test_supplier.id}/2026",
            headers={"Authorization": f"Bearer {test_supplier_user.id}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["has_appeal_permission"] is True
    
    async def test_check_signing_permission_unsigned(
        self,
        client: AsyncClient,
        test_supplier_user: User,
        test_supplier: Supplier,
        test_sqe_user: User,
        db_session: AsyncSession
    ):
        """测试存在未签署目标，申诉权限受限"""
        # 创建未签署的目标
        target = SupplierTarget(
            supplier_id=test_supplier.id,
            year=2026,
            target_type=TargetType.INCOMING_PASS_RATE,
            target_value=99.8,
            is_individual=True,
            is_approved=True,
            is_signed=False,
            created_by=test_sqe_user.id
        )
        db_session.add(target)
        await db_session.commit()
        
        # 检查权限
        response = await client.get(
            f"/api/v1/supplier-targets/check-permission/{test_supplier.id}/2026",
            headers={"Authorization": f"Bearer {test_supplier_user.id}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["has_appeal_permission"] is False
        assert "申诉权限受限" in data["message"]
