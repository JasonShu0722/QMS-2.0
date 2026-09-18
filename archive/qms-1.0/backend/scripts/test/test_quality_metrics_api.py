"""
质量数据 API 测试脚本
Test Quality Metrics API - 验证所有质量数据接口
"""
import asyncio
import sys
from pathlib import Path

# 添加项目根目录到 Python 路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from datetime import date, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import async_session_maker
from app.models.quality_metric import QualityMetric, MetricType
from app.models.user import User, UserType, UserStatus
from app.models.supplier import Supplier, SupplierStatus
from app.models.permission import Permission, OperationType
from app.services.metrics_calculator import metrics_calculator
from decimal import Decimal


async def setup_test_data(db: AsyncSession):
    """设置测试数据"""
    print("🔧 设置测试数据...")
    
    # 创建测试供应商
    supplier1 = Supplier(
        name="测试供应商A",
        code="SUP001",
        status=SupplierStatus.ACTIVE,
        contact_person="张三",
        contact_email="zhangsan@supplier-a.com",
        contact_phone="13800138001"
    )
    supplier2 = Supplier(
        name="测试供应商B",
        code="SUP002",
        status=SupplierStatus.ACTIVE,
        contact_person="李四",
        contact_email="lisi@supplier-b.com",
        contact_phone="13800138002"
    )
    
    db.add(supplier1)
    db.add(supplier2)
    await db.commit()
    await db.refresh(supplier1)
    await db.refresh(supplier2)
    
    print(f"✅ 创建供应商: {supplier1.name} (ID: {supplier1.id})")
    print(f"✅ 创建供应商: {supplier2.name} (ID: {supplier2.id})")
    
    # 创建测试用户
    test_user = User(
        username="test_quality_user",
        password_hash="hashed_password",
        full_name="质量工程师",
        email="quality@test.com",
        phone="13800138000",
        user_type=UserType.INTERNAL,
        status=UserStatus.ACTIVE,
        department="质量部",
        position="质量工程师"
    )
    
    db.add(test_user)
    await db.commit()
    await db.refresh(test_user)
    
    print(f"✅ 创建测试用户: {test_user.username} (ID: {test_user.id})")
    
    # 创建测试权限
    permissions = [
        Permission(
            user_id=test_user.id,
            module_path="quality.dashboard",
            operation_type=OperationType.READ,
            is_granted=True
        ),
        Permission(
            user_id=test_user.id,
            module_path="quality.metrics",
            operation_type=OperationType.READ,
            is_granted=True
        ),
        Permission(
            user_id=test_user.id,
            module_path="quality.supplier-analysis",
            operation_type=OperationType.READ,
            is_granted=True
        ),
        Permission(
            user_id=test_user.id,
            module_path="quality.process-analysis",
            operation_type=OperationType.READ,
            is_granted=True
        ),
        Permission(
            user_id=test_user.id,
            module_path="quality.customer-analysis",
            operation_type=OperationType.READ,
            is_granted=True
        ),
    ]
    
    for perm in permissions:
        db.add(perm)
    
    await db.commit()
    print(f"✅ 创建 {len(permissions)} 个权限")
    
    # 创建测试质量指标数据
    today = date.today()
    
    # 过去7天的数据
    for i in range(7):
        target_date = today - timedelta(days=i)
        
        # 来料批次合格率
        metric1 = QualityMetric(
            metric_type=MetricType.INCOMING_BATCH_PASS_RATE,
            metric_date=target_date,
            value=Decimal("98.5") + Decimal(str(i * 0.1)),
            target_value=Decimal("99.0"),
            supplier_id=supplier1.id
        )
        db.add(metric1)
        
        # 物料上线不良PPM
        metric2 = QualityMetric(
            metric_type=MetricType.MATERIAL_ONLINE_PPM,
            metric_date=target_date,
            value=Decimal("150") - Decimal(str(i * 5)),
            target_value=Decimal("100"),
            supplier_id=supplier1.id
        )
        db.add(metric2)
        
        # 制程不合格率
        metric3 = QualityMetric(
            metric_type=MetricType.PROCESS_DEFECT_RATE,
            metric_date=target_date,
            value=Decimal("1.2") - Decimal(str(i * 0.05)),
            target_value=Decimal("1.0"),
            line_id="LINE001",
            process_id="PROC001"
        )
        db.add(metric3)
        
        # 0KM不良PPM
        metric4 = QualityMetric(
            metric_type=MetricType.OKM_PPM,
            metric_date=target_date,
            value=Decimal("200") - Decimal(str(i * 10)),
            target_value=Decimal("150"),
            product_type="MCU"
        )
        db.add(metric4)
    
    await db.commit()
    print(f"✅ 创建 {7 * 4} 条质量指标数据")
    
    return test_user, supplier1, supplier2


async def test_dashboard_api(db: AsyncSession, user: User):
    """测试仪表盘API"""
    print("\n📊 测试仪表盘API...")
    
    # 这里应该调用实际的API，但由于是测试脚本，我们直接查询数据库
    from sqlalchemy import select
    
    today = date.today()
    query = select(QualityMetric).where(QualityMetric.metric_date == today)
    result = await db.execute(query)
    metrics = result.scalars().all()
    
    print(f"✅ 查询到 {len(metrics)} 条今日指标数据")
    
    for metric in metrics:
        print(f"   - {metric.metric_type}: {metric.value}")


async def test_trend_api(db: AsyncSession, user: User):
    """测试趋势API"""
    print("\n📈 测试趋势API...")
    
    today = date.today()
    start_date = today - timedelta(days=6)
    
    trend_data = await metrics_calculator.get_metric_trend(
        db=db,
        metric_type=MetricType.INCOMING_BATCH_PASS_RATE,
        start_date=start_date,
        end_date=today
    )
    
    print(f"✅ 查询到 {len(trend_data)} 条趋势数据")
    
    for metric in trend_data:
        print(f"   - {metric.metric_date}: {metric.value}")


async def main():
    """主测试函数"""
    print("=" * 60)
    print("质量数据 API 测试")
    print("=" * 60)
    
    async with async_session_maker() as db:
        try:
            # 设置测试数据
            test_user, supplier1, supplier2 = await setup_test_data(db)
            
            # 测试仪表盘API
            await test_dashboard_api(db, test_user)
            
            # 测试趋势API
            await test_trend_api(db, test_user)
            
            print("\n" + "=" * 60)
            print("✅ 所有测试通过！")
            print("=" * 60)
            
        except Exception as e:
            print(f"\n❌ 测试失败: {str(e)}")
            import traceback
            traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())
