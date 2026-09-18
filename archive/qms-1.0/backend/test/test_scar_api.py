"""
SCAR 和 8D 报告 API 测试
"""
import pytest
from datetime import datetime, timedelta
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User, UserType, UserStatus
from app.models.supplier import Supplier, SupplierStatus
from app.models.scar import SCAR, SCARStatus, SCARSeverity
from app.models.eight_d import EightD, EightDStatus
from app.core.auth_strategy import LocalAuthStrategy


@pytest.mark.asyncio
async def test_create_scar(
    async_client: AsyncClient,
    db_session: AsyncSession,
    test_supplier: Supplier,
    test_internal_user: User,
    auth_headers_internal: dict
):
    """测试创建 SCAR 单"""
    # 准备测试数据
    scar_data = {
        "supplier_id": test_supplier.id,
        "material_code": "MAT-001",
        "defect_description": "物料尺寸超差",
        "defect_qty": 100,
        "severity": "high",
        "deadline": (datetime.utcnow() + timedelta(days=7)).isoformat()
    }
    
    # 发送请求
    response = await async_client.post(
        "/api/v1/scar",
        json=scar_data,
        headers=auth_headers_internal
    )
    
    # 验证响应
    assert response.status_code == 201
    data = response.json()
    assert data["supplier_id"] == test_supplier.id
    assert data["material_code"] == "MAT-001"
    assert data["status"] == "open"
    assert "SCAR-" in data["scar_number"]


@pytest.mark.asyncio
async def test_get_scar_list_supplier_filter(
    async_client: AsyncClient,
    db_session: AsyncSession,
    test_supplier: Supplier,
    test_supplier_user: User,
    auth_headers_supplier: dict
):
    """测试供应商用户只能看到自己的 SCAR"""
    # 创建测试 SCAR
    scar = SCAR(
        scar_number="SCAR-20240101-0001",
        supplier_id=test_supplier.id,
        material_code="MAT-001",
        defect_description="测试缺陷",
        defect_qty=10,
        severity=SCARSeverity.MEDIUM,
        status=SCARStatus.OPEN,
        deadline=datetime.utcnow() + timedelta(days=7),
        created_by=1
    )
    db_session.add(scar)
    await db_session.commit()
    
    # 发送请求
    response = await async_client.get(
        "/api/v1/scar",
        headers=auth_headers_supplier
    )
    
    # 验证响应
    assert response.status_code == 200
    data = response.json()
    assert data["total"] >= 1
    # 验证所有返回的 SCAR 都属于当前供应商
    for item in data["items"]:
        assert item["supplier_id"] == test_supplier.id


@pytest.mark.asyncio
async def test_submit_8d_report(
    async_client: AsyncClient,
    db_session: AsyncSession,
    test_scar: SCAR,
    test_supplier_user: User,
    auth_headers_supplier: dict
):
    """测试供应商提交 8D 报告"""
    # 准备 8D 数据
    eight_d_data = {
        "d0_d3_data": {
            "problem_description": "物料尺寸超差",
            "containment_action": "隔离不良品"
        },
        "d4_d7_data": {
            "root_cause": "模具磨损导致尺寸偏移",
            "corrective_action": "更换模具并重新校准",
            "preventive_action": "建立模具定期保养计划",
            "verification": "已验证100件产品，尺寸合格"
        },
        "d8_data": {
            "horizontal_deployment": "已推广到所有类似产品",
            "lessons_learned": "加强模具管理"
        }
    }
    
    # 发送请求
    response = await async_client.post(
        f"/api/v1/scar/{test_scar.id}/8d",
        json=eight_d_data,
        headers=auth_headers_supplier
    )
    
    # 验证响应
    assert response.status_code == 201
    data = response.json()
    assert data["scar_id"] == test_scar.id
    assert data["status"] == "submitted"
    assert data["d4_d7_data"]["root_cause"] == "模具磨损导致尺寸偏移"


@pytest.mark.asyncio
async def test_review_8d_report(
    async_client: AsyncClient,
    db_session: AsyncSession,
    test_scar: SCAR,
    test_eight_d: EightD,
    test_internal_user: User,
    auth_headers_internal: dict
):
    """测试 SQE 审核 8D 报告"""
    # 准备审核数据
    review_data = {
        "review_comments": "根本原因分析充分，纠正措施有效",
        "approved": True
    }
    
    # 发送请求
    response = await async_client.post(
        f"/api/v1/scar/{test_scar.id}/8d/review",
        json=review_data,
        headers=auth_headers_internal
    )
    
    # 验证响应
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "approved"
    assert data["review_comments"] == "根本原因分析充分，纠正措施有效"


@pytest.mark.asyncio
async def test_ai_prereview_8d(
    async_client: AsyncClient,
    test_supplier: Supplier,
    auth_headers_internal: dict
):
    """测试 AI 预审 8D 报告"""
    # 准备测试数据（包含空洞词汇）
    request_data = {
        "supplier_id": test_supplier.id,
        "eight_d_data": {
            "d4_d7_data": {
                "root_cause": "员工操作不当",
                "corrective_action": "加强培训",  # 空洞词汇
                "preventive_action": "加强管理"   # 空洞词汇
            }
        }
    }
    
    # 发送请求
    response = await async_client.post(
        "/api/v1/scar/8d/ai-prereview",
        json=request_data,
        headers=auth_headers_internal
    )
    
    # 验证响应
    assert response.status_code == 200
    data = response.json()
    assert data["passed"] == False  # 应该不通过预审
    assert len(data["issues"]) > 0  # 应该有问题列表
    assert any("加强培训" in issue for issue in data["issues"])


# Fixtures

@pytest.fixture
async def test_supplier(db_session: AsyncSession) -> Supplier:
    """创建测试供应商"""
    supplier = Supplier(
        name="测试供应商A",
        code="SUP-001",
        contact_person="张三",
        contact_email="zhangsan@supplier.com",
        contact_phone="13800138000",
        status=SupplierStatus.ACTIVE
    )
    db_session.add(supplier)
    await db_session.commit()
    await db_session.refresh(supplier)
    return supplier


@pytest.fixture
async def test_internal_user(db_session: AsyncSession) -> User:
    """创建测试内部用户"""
    user = User(
        username="sqe001",
        password_hash="hashed_password",
        full_name="SQE工程师",
        email="sqe@company.com",
        user_type=UserType.INTERNAL,
        status=UserStatus.ACTIVE,
        department="质量部",
        position="SQE"
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest.fixture
async def test_supplier_user(
    db_session: AsyncSession,
    test_supplier: Supplier
) -> User:
    """创建测试供应商用户"""
    user = User(
        username="supplier001",
        password_hash="hashed_password",
        full_name="供应商联系人",
        email="contact@supplier.com",
        user_type=UserType.SUPPLIER,
        status=UserStatus.ACTIVE,
        supplier_id=test_supplier.id,
        position="质量经理"
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest.fixture
async def test_scar(
    db_session: AsyncSession,
    test_supplier: Supplier,
    test_supplier_user: User
) -> SCAR:
    """创建测试 SCAR"""
    scar = SCAR(
        scar_number="SCAR-20240101-0001",
        supplier_id=test_supplier.id,
        material_code="MAT-001",
        defect_description="测试缺陷",
        defect_qty=10,
        severity=SCARSeverity.MEDIUM,
        status=SCARStatus.OPEN,
        current_handler_id=test_supplier_user.id,
        deadline=datetime.utcnow() + timedelta(days=7),
        created_by=1
    )
    db_session.add(scar)
    await db_session.commit()
    await db_session.refresh(scar)
    return scar


@pytest.fixture
async def test_eight_d(
    db_session: AsyncSession,
    test_scar: SCAR,
    test_supplier_user: User
) -> EightD:
    """创建测试 8D 报告"""
    eight_d = EightD(
        scar_id=test_scar.id,
        d4_d7_data={
            "root_cause": "模具磨损",
            "corrective_action": "更换模具",
            "preventive_action": "定期保养"
        },
        status=EightDStatus.SUBMITTED,
        submitted_by=test_supplier_user.id,
        submitted_at=datetime.utcnow()
    )
    db_session.add(eight_d)
    await db_session.commit()
    await db_session.refresh(eight_d)
    return eight_d


@pytest.fixture
def auth_headers_internal(test_internal_user: User) -> dict:
    """内部用户认证头"""
    token = LocalAuthStrategy().create_access_token(test_internal_user.id)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def auth_headers_supplier(test_supplier_user: User) -> dict:
    """供应商用户认证头"""
    token = LocalAuthStrategy().create_access_token(test_supplier_user.id)
    return {"Authorization": f"Bearer {token}"}
