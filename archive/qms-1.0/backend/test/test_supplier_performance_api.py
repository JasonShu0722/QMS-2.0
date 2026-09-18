"""
供应商绩效评价 API 测试
Test Supplier Performance API
"""
import pytest
from datetime import datetime
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.supplier import Supplier, SupplierStatus
from app.models.supplier_target import SupplierTarget, TargetType
from app.models.quality_metric import QualityMetric, MetricType
from app.models.supplier_performance import SupplierPerformance, PerformanceGrade, CooperationLevel
from app.services.performance_calculator import PerformanceCalculator


@pytest.fixture
async def test_supplier(db: AsyncSession):
    """创建测试供应商"""
    supplier = Supplier(
        name="测试供应商A",
        code="SUP001",
        contact_person="张三",
        contact_email="zhangsan@example.com",
        contact_phone="13800138000",
        status=SupplierStatus.ACTIVE
    )
    db.add(supplier)
    await db.commit()
    await db.refresh(supplier)
    return supplier


@pytest.fixture
async def test_target(db: AsyncSession, test_supplier: Supplier):
    """创建测试目标"""
    target = SupplierTarget(
        supplier_id=test_supplier.id,
        year=2024,
        target_type=TargetType.INCOMING_PASS_RATE,
        target_value=99.0,
        is_individual=False,
        is_signed=True,
        is_approved=True,
        created_by=1
    )
    db.add(target)
    await db.commit()
    await db.refresh(target)
    return target


@pytest.fixture
async def test_quality_metrics(db: AsyncSession, test_supplier: Supplier):
    """创建测试质量指标"""
    metrics = [
        QualityMetric(
            metric_type=MetricType.INCOMING_BATCH_PASS_RATE,
            metric_date=datetime(2024, 1, 1).date(),
            value=98.5,
            supplier_id=test_supplier.id
        ),
        QualityMetric(
            metric_type=MetricType.INCOMING_BATCH_PASS_RATE,
            metric_date=datetime(2024, 1, 2).date(),
            value=98.0,
            supplier_id=test_supplier.id
        ),
    ]
    for metric in metrics:
        db.add(metric)
    await db.commit()
    return metrics


class TestPerformanceCalculator:
    """测试绩效计算器"""
    
    def test_calculate_final_score(self):
        """测试最终得分计算"""
        # 测试无扣分
        assert PerformanceCalculator.calculate_final_score(0) == 100.0
        
        # 测试扣5分
        assert PerformanceCalculator.calculate_final_score(5) == 91.67
        
        # 测试扣30分
        assert PerformanceCalculator.calculate_final_score(30) == 50.0
        
        # 测试扣60分（最低分）
        assert PerformanceCalculator.calculate_final_score(60) == 0.0
        
        # 测试超过60分（不应该出现，但要处理）
        assert PerformanceCalculator.calculate_final_score(70) == 0.0
    
    def test_determine_grade(self):
        """测试等级评定"""
        assert PerformanceCalculator.determine_grade(96) == PerformanceGrade.A
        assert PerformanceCalculator.determine_grade(95) == PerformanceGrade.B
        assert PerformanceCalculator.determine_grade(85) == PerformanceGrade.B
        assert PerformanceCalculator.determine_grade(80) == PerformanceGrade.B
        assert PerformanceCalculator.determine_grade(75) == PerformanceGrade.C
        assert PerformanceCalculator.determine_grade(70) == PerformanceGrade.C
        assert PerformanceCalculator.determine_grade(65) == PerformanceGrade.D
    
    def test_calculate_cooperation_deduction(self):
        """测试配合度扣分计算"""
        deduction, reason = PerformanceCalculator.calculate_cooperation_deduction(CooperationLevel.HIGH)
        assert deduction == 0
        assert "high" in reason
        
        deduction, reason = PerformanceCalculator.calculate_cooperation_deduction(CooperationLevel.MEDIUM)
        assert deduction == 5
        assert "medium" in reason
        
        deduction, reason = PerformanceCalculator.calculate_cooperation_deduction(CooperationLevel.LOW)
        assert deduction == 10
        assert "low" in reason
        
        deduction, reason = PerformanceCalculator.calculate_cooperation_deduction(None)
        assert deduction == 0
        assert "未评价" in reason
    
    @pytest.mark.asyncio
    async def test_calculate_incoming_quality_deduction(
        self,
        db: AsyncSession,
        test_supplier: Supplier,
        test_target: SupplierTarget,
        test_quality_metrics: list
    ):
        """测试来料质量扣分计算"""
        deduction, reason = await PerformanceCalculator.calculate_incoming_quality_deduction(
            db, test_supplier.id, 2024, 1
        )
        
        # 目标99%，实际98.25%（平均值），差距0.75%，应该扣5分
        assert deduction == 5
        assert "差距" in reason


class TestSupplierPerformanceAPI:
    """测试供应商绩效评价 API"""
    
    @pytest.mark.asyncio
    async def test_calculate_performance(
        self,
        client: AsyncClient,
        db: AsyncSession,
        test_supplier: Supplier,
        test_target: SupplierTarget,
        test_quality_metrics: list,
        auth_headers: dict
    ):
        """测试手动触发绩效计算"""
        response = await client.post(
            f"/api/v1/supplier-performance/calculate/{test_supplier.id}",
            params={
                "year": 2024,
                "month": 1,
                "cooperation_level": "high"
            },
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "performance_id" in data
        assert "final_score" in data
        assert "grade" in data
    
    @pytest.mark.asyncio
    async def test_get_performances(
        self,
        client: AsyncClient,
        db: AsyncSession,
        test_supplier: Supplier,
        auth_headers: dict
    ):
        """测试获取绩效列表"""
        # 先创建一条绩效记录
        performance = SupplierPerformance(
            supplier_id=test_supplier.id,
            year=2024,
            month=1,
            incoming_quality_deduction=5.0,
            process_quality_deduction=0.0,
            cooperation_deduction=0.0,
            zero_km_deduction=0.0,
            total_deduction=5.0,
            final_score=91.67,
            grade=PerformanceGrade.B.value,
            is_reviewed=False
        )
        db.add(performance)
        await db.commit()
        
        # 查询绩效列表
        response = await client.get(
            "/api/v1/supplier-performance",
            params={
                "supplier_id": test_supplier.id,
                "year": 2024,
                "page": 1,
                "page_size": 20
            },
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["total"] >= 1
        assert len(data["items"]) >= 1
        assert data["items"][0]["supplier_id"] == test_supplier.id
    
    @pytest.mark.asyncio
    async def test_get_performance_card(
        self,
        client: AsyncClient,
        db: AsyncSession,
        test_supplier: Supplier,
        auth_headers: dict
    ):
        """测试获取绩效卡"""
        # 创建绩效记录
        performance = SupplierPerformance(
            supplier_id=test_supplier.id,
            year=2024,
            month=1,
            incoming_quality_deduction=5.0,
            process_quality_deduction=0.0,
            cooperation_deduction=0.0,
            zero_km_deduction=0.0,
            total_deduction=5.0,
            final_score=91.67,
            grade=PerformanceGrade.B.value,
            is_reviewed=False
        )
        db.add(performance)
        await db.commit()
        
        # 获取绩效卡
        response = await client.get(
            f"/api/v1/supplier-performance/card/{test_supplier.id}",
            params={
                "year": 2024,
                "month": 1
            },
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["supplier_id"] == test_supplier.id
        assert data["current_score"] == 91.67
        assert data["current_grade"] == "B"
        assert "deduction_detail" in data
        assert "historical_scores" in data
        assert "requires_meeting" in data
    
    @pytest.mark.asyncio
    async def test_evaluate_cooperation(
        self,
        client: AsyncClient,
        db: AsyncSession,
        test_supplier: Supplier,
        auth_headers: dict
    ):
        """测试配合度评价"""
        # 创建绩效记录
        performance = SupplierPerformance(
            supplier_id=test_supplier.id,
            year=2024,
            month=1,
            incoming_quality_deduction=5.0,
            process_quality_deduction=0.0,
            cooperation_deduction=0.0,
            zero_km_deduction=0.0,
            total_deduction=5.0,
            final_score=91.67,
            grade=PerformanceGrade.B.value,
            is_reviewed=False
        )
        db.add(performance)
        await db.commit()
        await db.refresh(performance)
        
        # 评价配合度
        response = await client.post(
            f"/api/v1/supplier-performance/{performance.id}/evaluate-cooperation",
            json={
                "cooperation_level": "medium",
                "cooperation_comment": "响应速度一般"
            },
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["cooperation_level"] == "medium"
        assert data["cooperation_deduction"] == 5.0
    
    @pytest.mark.asyncio
    async def test_review_performance(
        self,
        client: AsyncClient,
        db: AsyncSession,
        test_supplier: Supplier,
        auth_headers: dict
    ):
        """测试人工校核"""
        # 创建绩效记录
        performance = SupplierPerformance(
            supplier_id=test_supplier.id,
            year=2024,
            month=1,
            incoming_quality_deduction=15.0,
            process_quality_deduction=0.0,
            cooperation_deduction=0.0,
            zero_km_deduction=0.0,
            total_deduction=15.0,
            final_score=75.0,
            grade=PerformanceGrade.C.value,
            is_reviewed=False
        )
        db.add(performance)
        await db.commit()
        await db.refresh(performance)
        
        # 人工校核（核减5分）
        response = await client.post(
            f"/api/v1/supplier-performance/{performance.id}/review",
            json={
                "review_comment": "考虑到供应商积极配合整改，核减5分",
                "manual_adjustment": 5.0
            },
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["is_reviewed"] is True
        assert data["manual_adjustment"] == 5.0
        # 核减后得分应该提高
        assert data["final_score"] > 75.0
    
    @pytest.mark.asyncio
    async def test_get_performance_statistics(
        self,
        client: AsyncClient,
        db: AsyncSession,
        test_supplier: Supplier,
        auth_headers: dict
    ):
        """测试绩效统计"""
        # 创建多条绩效记录
        performances = [
            SupplierPerformance(
                supplier_id=test_supplier.id,
                year=2024,
                month=1,
                incoming_quality_deduction=0.0,
                process_quality_deduction=0.0,
                cooperation_deduction=0.0,
                zero_km_deduction=0.0,
                total_deduction=0.0,
                final_score=100.0,
                grade=PerformanceGrade.A.value,
                is_reviewed=False
            ),
            SupplierPerformance(
                supplier_id=test_supplier.id + 1,  # 假设有另一个供应商
                year=2024,
                month=1,
                incoming_quality_deduction=30.0,
                process_quality_deduction=0.0,
                cooperation_deduction=0.0,
                zero_km_deduction=0.0,
                total_deduction=30.0,
                final_score=50.0,
                grade=PerformanceGrade.D.value,
                is_reviewed=False
            ),
        ]
        for p in performances:
            db.add(p)
        await db.commit()
        
        # 获取统计
        response = await client.get(
            "/api/v1/supplier-performance/statistics/2024/1",
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "total_suppliers" in data
        assert "grade_distribution" in data
        assert "average_score" in data
        assert "top_suppliers" in data
        assert "bottom_suppliers" in data
        assert "requires_attention" in data
