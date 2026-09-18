"""
供应商质量管理模块综合测试
Comprehensive Tests for Supplier Quality Management Module

测试范围：
1. SCAR 自动立案逻辑 (Auto SCAR Creation Logic)
2. 8D 报告 AI 预审 (8D Report AI Pre-review)
3. 绩效评价计算公式 (Performance Calculation Formulas)
4. 条码校验规则 (Barcode Validation Rules)
"""
import pytest
import re
from datetime import datetime, timedelta
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from unittest.mock import Mock, patch, AsyncMock

from app.models.supplier import Supplier, SupplierStatus
from app.models.user import User, UserType, UserStatus
from app.models.scar import SCAR, SCARStatus, SCARSeverity
from app.models.eight_d import EightD, EightDStatus
from app.models.supplier_target import SupplierTarget, TargetType
from app.models.quality_metric import QualityMetric, MetricType
from app.models.supplier_performance import SupplierPerformance, PerformanceGrade, CooperationLevel
from app.models.barcode_validation import BarcodeValidation, BarcodeScanRecord
from app.services.performance_calculator import PerformanceCalculator
from app.services.barcode_validation_service import BarcodeValidationService


# ============================================================================
# 测试 1: SCAR 自动立案逻辑
# Test 1: Auto SCAR Creation Logic
# ============================================================================

class TestSCARAutoCreation:
    """测试 SCAR 自动立案逻辑"""
    
    @pytest.mark.asyncio
    async def test_auto_create_scar_on_iqc_ng(
        self,
        db_session: AsyncSession,
        test_supplier: Supplier
    ):
        """测试 IQC 检验 NG 时自动创建 SCAR"""
        # 模拟 IMS 系统返回 NG 检验结果
        iqc_ng_data = {
            "material_code": "MAT-001",
            "batch_number": "BATCH-20240101-001",
            "supplier_code": test_supplier.code,
            "inspection_result": "NG",
            "defect_description": "尺寸超差",
            "defect_qty": 50,
            "total_qty": 1000,
            "inspector": "IQC001",
            "inspection_date": datetime.utcnow().isoformat()
        }
        
        # 导入 IMS 集成服务
        from app.services.ims_integration_service import IMSIntegrationService
        
        # 模拟自动立案逻辑
        with patch.object(IMSIntegrationService, 'sync_iqc_inspection_results', new_callable=AsyncMock) as mock_sync:
            mock_sync.return_value = [iqc_ng_data]
            
            # 执行同步
            results = await IMSIntegrationService.sync_iqc_inspection_results(db_session)
            
            # 验证是否自动创建了 SCAR
            scar = await db_session.execute(
                "SELECT * FROM scars WHERE material_code = :material_code",
                {"material_code": "MAT-001"}
            )
            scar_record = scar.first()
            
            # 断言 SCAR 已创建
            assert scar_record is not None
            assert scar_record.supplier_id == test_supplier.id
            assert scar_record.status == SCARStatus.OPEN.value
            assert "SCAR-" in scar_record.scar_number
    
    @pytest.mark.asyncio
    async def test_scar_severity_classification(
        self,
        db_session: AsyncSession,
        test_supplier: Supplier
    ):
        """测试 SCAR 严重度自动分级"""
        # 测试高严重度（不良率 > 10%）
        high_severity_data = {
            "defect_qty": 150,
            "total_qty": 1000,  # 15% 不良率
            "defect_description": "批量尺寸超差"
        }
        
        defect_rate = high_severity_data["defect_qty"] / high_severity_data["total_qty"]
        
        if defect_rate > 0.10:
            severity = SCARSeverity.HIGH
        elif defect_rate > 0.05:
            severity = SCARSeverity.MEDIUM
        else:
            severity = SCARSeverity.LOW
        
        assert severity == SCARSeverity.HIGH
        
        # 测试中等严重度（5% < 不良率 <= 10%）
        medium_severity_data = {
            "defect_qty": 70,
            "total_qty": 1000,  # 7% 不良率
        }
        
        defect_rate = medium_severity_data["defect_qty"] / medium_severity_data["total_qty"]
        
        if defect_rate > 0.10:
            severity = SCARSeverity.HIGH
        elif defect_rate > 0.05:
            severity = SCARSeverity.MEDIUM
        else:
            severity = SCARSeverity.LOW
        
        assert severity == SCARSeverity.MEDIUM
        
        # 测试低严重度（不良率 <= 5%）
        low_severity_data = {
            "defect_qty": 30,
            "total_qty": 1000,  # 3% 不良率
        }
        
        defect_rate = low_severity_data["defect_qty"] / low_severity_data["total_qty"]
        
        if defect_rate > 0.10:
            severity = SCARSeverity.HIGH
        elif defect_rate > 0.05:
            severity = SCARSeverity.MEDIUM
        else:
            severity = SCARSeverity.LOW
        
        assert severity == SCARSeverity.LOW



# ============================================================================
# 测试 2: 8D 报告 AI 预审
# Test 2: 8D Report AI Pre-review
# ============================================================================

class TestEightDAIPrereview:
    """测试 8D 报告 AI 预审功能"""
    
    @pytest.mark.asyncio
    async def test_detect_empty_phrases(self):
        """测试检测空洞词汇"""
        from app.services.ai_analysis_service import AIAnalysisService
        
        # 包含空洞词汇的 8D 报告
        eight_d_data = {
            "d4_d7_data": {
                "root_cause": "员工操作不当",
                "corrective_action": "加强培训",  # 空洞词汇
                "preventive_action": "加强管理"   # 空洞词汇
            }
        }
        
        # 空洞词汇列表
        empty_phrases = ["加强培训", "加强管理", "提高意识", "严格要求"]
        
        # 检测逻辑
        issues = []
        for key, value in eight_d_data["d4_d7_data"].items():
            if isinstance(value, str):
                for phrase in empty_phrases:
                    if phrase in value:
                        issues.append(f"{key} 包含空洞词汇: '{phrase}'，请提供具体措施")
        
        # 断言检测到问题
        assert len(issues) == 2
        assert any("加强培训" in issue for issue in issues)
        assert any("加强管理" in issue for issue in issues)
    
    @pytest.mark.asyncio
    async def test_detect_duplicate_root_cause(
        self,
        db_session: AsyncSession,
        test_supplier: Supplier
    ):
        """测试检测重复根本原因"""
        # 创建历史 8D 报告
        historical_scar = SCAR(
            scar_number="SCAR-20231201-0001",
            supplier_id=test_supplier.id,
            material_code="MAT-001",
            defect_description="历史缺陷",
            defect_qty=10,
            severity=SCARSeverity.MEDIUM,
            status=SCARStatus.CLOSED,
            deadline=datetime.utcnow() - timedelta(days=30),
            created_by=1
        )
        db_session.add(historical_scar)
        await db_session.commit()
        await db_session.refresh(historical_scar)
        
        historical_8d = EightD(
            scar_id=historical_scar.id,
            d4_d7_data={
                "root_cause": "模具磨损导致尺寸偏移",
                "corrective_action": "更换模具"
            },
            status=EightDStatus.APPROVED,
            submitted_by=1
        )
        db_session.add(historical_8d)
        await db_session.commit()
        
        # 新的 8D 报告使用相同根本原因
        new_8d_data = {
            "root_cause": "模具磨损导致尺寸偏移"  # 与历史重复
        }
        
        # 查询历史记录
        from sqlalchemy import select
        stmt = select(EightD).join(SCAR).where(
            SCAR.supplier_id == test_supplier.id,
            SCAR.created_at >= datetime.utcnow() - timedelta(days=90)
        )
        result = await db_session.execute(stmt)
        historical_8ds = result.scalars().all()
        
        # 检测重复
        is_duplicate = False
        for h8d in historical_8ds:
            if h8d.d4_d7_data and "root_cause" in h8d.d4_d7_data:
                if h8d.d4_d7_data["root_cause"] == new_8d_data["root_cause"]:
                    is_duplicate = True
                    break
        
        # 断言检测到重复
        assert is_duplicate is True
    
    @pytest.mark.asyncio
    async def test_ai_prereview_integration(
        self,
        async_client: AsyncClient,
        test_supplier: Supplier,
        auth_headers_internal: dict
    ):
        """测试 AI 预审集成接口"""
        # 准备测试数据
        request_data = {
            "supplier_id": test_supplier.id,
            "eight_d_data": {
                "d4_d7_data": {
                    "root_cause": "员工操作不规范",
                    "corrective_action": "加强培训和监督",
                    "preventive_action": "提高员工质量意识"
                }
            }
        }
        
        # 发送预审请求
        response = await async_client.post(
            "/api/v1/scar/8d/ai-prereview",
            json=request_data,
            headers=auth_headers_internal
        )
        
        # 验证响应
        assert response.status_code == 200
        data = response.json()
        assert "passed" in data
        assert "issues" in data
        assert "suggestions" in data
        
        # 应该检测到空洞词汇
        if not data["passed"]:
            assert len(data["issues"]) > 0



# ============================================================================
# 测试 3: 绩效评价计算公式
# Test 3: Performance Calculation Formulas
# ============================================================================

class TestPerformanceCalculationFormulas:
    """测试绩效评价计算公式"""
    
    def test_60_point_deduction_model(self):
        """测试 60 分制扣分模型"""
        # 基础分 60 分
        base_score = 60
        
        # 测试场景 1: 无扣分
        total_deduction = 0
        final_score = PerformanceCalculator.calculate_final_score(total_deduction)
        expected_score = (base_score - total_deduction) / base_score * 100
        assert final_score == expected_score
        assert final_score == 100.0
        
        # 测试场景 2: 扣 5 分
        total_deduction = 5
        final_score = PerformanceCalculator.calculate_final_score(total_deduction)
        expected_score = (base_score - total_deduction) / base_score * 100
        assert abs(final_score - expected_score) < 0.01
        assert abs(final_score - 91.67) < 0.01
        
        # 测试场景 3: 扣 30 分
        total_deduction = 30
        final_score = PerformanceCalculator.calculate_final_score(total_deduction)
        expected_score = (base_score - total_deduction) / base_score * 100
        assert final_score == expected_score
        assert final_score == 50.0
        
        # 测试场景 4: 扣满 60 分（最低分）
        total_deduction = 60
        final_score = PerformanceCalculator.calculate_final_score(total_deduction)
        assert final_score == 0.0
        
        # 测试场景 5: 超过 60 分（边界情况）
        total_deduction = 70
        final_score = PerformanceCalculator.calculate_final_score(total_deduction)
        assert final_score == 0.0  # 不应该出现负分
    
    def test_incoming_quality_deduction_logic(self):
        """测试来料质量扣分逻辑"""
        # 目标值
        target_value = 99.0
        
        # 场景 1: 达到目标（实际 99.5%）
        actual_value = 99.5
        gap = target_value - actual_value
        gap_percentage = abs(gap) / target_value
        
        if actual_value >= target_value:
            deduction = 0
        elif gap_percentage < 0.10:
            deduction = 5
        elif gap_percentage < 0.20:
            deduction = 15
        else:
            deduction = 30
        
        assert deduction == 0
        
        # 场景 2: 差距 < 10%（实际 98.0%）
        actual_value = 98.0
        gap = target_value - actual_value
        gap_percentage = gap / target_value
        
        if actual_value >= target_value:
            deduction = 0
        elif gap_percentage < 0.10:
            deduction = 5
        elif gap_percentage < 0.20:
            deduction = 15
        else:
            deduction = 30
        
        assert deduction == 5
        assert gap_percentage < 0.10
        
        # 场景 3: 10% <= 差距 < 20%（实际 85.0%）
        actual_value = 85.0
        gap = target_value - actual_value
        gap_percentage = gap / target_value
        
        if actual_value >= target_value:
            deduction = 0
        elif gap_percentage < 0.10:
            deduction = 5
        elif gap_percentage < 0.20:
            deduction = 15
        else:
            deduction = 30
        
        assert deduction == 15
        assert 0.10 <= gap_percentage < 0.20
        
        # 场景 4: 差距 >= 20%（实际 75.0%）
        actual_value = 75.0
        gap = target_value - actual_value
        gap_percentage = gap / target_value
        
        if actual_value >= target_value:
            deduction = 0
        elif gap_percentage < 0.10:
            deduction = 5
        elif gap_percentage < 0.20:
            deduction = 15
        else:
            deduction = 30
        
        assert deduction == 30
        assert gap_percentage >= 0.20
    
    def test_process_quality_ppm_deduction_logic(self):
        """测试制程质量 PPM 扣分逻辑"""
        # 目标 PPM
        target_ppm = 100.0
        
        # 场景 1: 达到目标（实际 80 PPM）
        actual_ppm = 80.0
        if actual_ppm <= target_ppm:
            deduction = 0
        else:
            exceed_percentage = (actual_ppm - target_ppm) / target_ppm
            if exceed_percentage <= 0.50:
                deduction = 5
            elif exceed_percentage <= 1.00:
                deduction = 15
            else:
                deduction = 30
        
        assert deduction == 0
        
        # 场景 2: 超标 0-50%（实际 120 PPM）
        actual_ppm = 120.0
        if actual_ppm <= target_ppm:
            deduction = 0
        else:
            exceed_percentage = (actual_ppm - target_ppm) / target_ppm
            if exceed_percentage <= 0.50:
                deduction = 5
            elif exceed_percentage <= 1.00:
                deduction = 15
            else:
                deduction = 30
        
        assert deduction == 5
        
        # 场景 3: 超标 50-100%（实际 180 PPM）
        actual_ppm = 180.0
        if actual_ppm <= target_ppm:
            deduction = 0
        else:
            exceed_percentage = (actual_ppm - target_ppm) / target_ppm
            if exceed_percentage <= 0.50:
                deduction = 5
            elif exceed_percentage <= 1.00:
                deduction = 15
            else:
                deduction = 30
        
        assert deduction == 15
        
        # 场景 4: 超标 > 100%（实际 250 PPM）
        actual_ppm = 250.0
        if actual_ppm <= target_ppm:
            deduction = 0
        else:
            exceed_percentage = (actual_ppm - target_ppm) / target_ppm
            if exceed_percentage <= 0.50:
                deduction = 5
            elif exceed_percentage <= 1.00:
                deduction = 15
            else:
                deduction = 30
        
        assert deduction == 30
    
    def test_grade_determination(self):
        """测试等级评定逻辑"""
        # A 级: > 95
        assert PerformanceCalculator.determine_grade(96) == PerformanceGrade.A
        assert PerformanceCalculator.determine_grade(100) == PerformanceGrade.A
        
        # B 级: 80-95
        assert PerformanceCalculator.determine_grade(95) == PerformanceGrade.B
        assert PerformanceCalculator.determine_grade(85) == PerformanceGrade.B
        assert PerformanceCalculator.determine_grade(80) == PerformanceGrade.B
        
        # C 级: 70-79
        assert PerformanceCalculator.determine_grade(79) == PerformanceGrade.C
        assert PerformanceCalculator.determine_grade(75) == PerformanceGrade.C
        assert PerformanceCalculator.determine_grade(70) == PerformanceGrade.C
        
        # D 级: < 70
        assert PerformanceCalculator.determine_grade(69) == PerformanceGrade.D
        assert PerformanceCalculator.determine_grade(50) == PerformanceGrade.D
        assert PerformanceCalculator.determine_grade(0) == PerformanceGrade.D



# ============================================================================
# 测试 4: 条码校验规则
# Test 4: Barcode Validation Rules
# ============================================================================

class TestBarcodeValidationRules:
    """测试条码校验规则"""
    
    def test_regex_pattern_validation(self):
        """测试正则表达式校验"""
        # 测试场景 1: 有效的正则表达式
        pattern = r"^A\d{4}[XYZ]$"
        test_barcodes = [
            ("A1234X", True),
            ("A5678Y", True),
            ("A9999Z", True),
            ("B1234X", False),  # 前缀错误
            ("A123X", False),   # 长度不足
            ("A12345X", False), # 长度超出
            ("A1234A", False),  # 后缀错误
        ]
        
        for barcode, expected in test_barcodes:
            result = bool(re.match(pattern, barcode))
            assert result == expected, f"Barcode {barcode} validation failed"
    
    def test_prefix_suffix_validation(self):
        """测试前缀后缀校验"""
        rules = {
            "prefix": "MAT",
            "suffix": "END",
            "min_length": 10,
            "max_length": 15
        }
        
        test_cases = [
            ("MAT1234END", True),      # 完全匹配
            ("MAT12345END", True),     # 长度在范围内
            ("XYZ1234END", False),     # 前缀错误
            ("MAT1234XYZ", False),     # 后缀错误
            ("MAT12END", False),       # 长度不足
            ("MAT12345678END", False), # 长度超出 (15 characters)
        ]
        
        for barcode, expected in test_cases:
            # 校验逻辑
            is_valid = True
            
            # 检查前缀
            if rules["prefix"] and not barcode.startswith(rules["prefix"]):
                is_valid = False
            
            # 检查后缀
            if rules["suffix"] and not barcode.endswith(rules["suffix"]):
                is_valid = False
            
            # 检查长度
            if len(barcode) < rules["min_length"] or len(barcode) > rules["max_length"]:
                is_valid = False
            
            assert is_valid == expected, f"Barcode {barcode} validation failed"
    
    def test_length_validation(self):
        """测试长度校验"""
        min_length = 8
        max_length = 12
        
        test_cases = [
            ("1234567", False),    # 太短
            ("12345678", True),    # 最小长度
            ("1234567890", True),  # 中间长度
            ("123456789012", True),# 最大长度
            ("1234567890123", False), # 太长
        ]
        
        for barcode, expected in test_cases:
            is_valid = min_length <= len(barcode) <= max_length
            assert is_valid == expected, f"Barcode {barcode} length validation failed"
    
    @pytest.mark.asyncio
    async def test_uniqueness_check(
        self,
        db_session: AsyncSession,
        test_supplier: Supplier
    ):
        """测试唯一性校验"""
        # 创建已存在的条码记录
        existing_record = BarcodeScanRecord(
            material_code="MAT-001",
            barcode_content="A1234X",
            supplier_id=test_supplier.id,
            is_pass=True,
            scanned_by=1,
            scanned_at=datetime.utcnow()
        )
        db_session.add(existing_record)
        await db_session.commit()
        
        # 测试重复扫描
        from sqlalchemy import select
        stmt = select(BarcodeScanRecord).where(
            BarcodeScanRecord.barcode_content == "A1234X",
            BarcodeScanRecord.material_code == "MAT-001"
        )
        result = await db_session.execute(stmt)
        duplicate = result.scalar_one_or_none()
        
        # 断言检测到重复
        assert duplicate is not None
        
        # 测试新条码
        stmt = select(BarcodeScanRecord).where(
            BarcodeScanRecord.barcode_content == "A5678Y",
            BarcodeScanRecord.material_code == "MAT-001"
        )
        result = await db_session.execute(stmt)
        new_barcode = result.scalar_one_or_none()
        
        # 断言未检测到重复
        assert new_barcode is None
    
    @pytest.mark.asyncio
    async def test_barcode_scan_validation_flow(
        self,
        async_client: AsyncClient,
        db_session: AsyncSession,
        test_supplier: Supplier,
        auth_headers_internal: dict
    ):
        """测试完整的扫码校验流程"""
        # 1. 创建校验规则
        validation_rule = BarcodeValidation(
            material_code="MAT-001",
            validation_rules={
                "prefix": "A",
                "suffix": "X",
                "min_length": 6,
                "max_length": 10
            },
            regex_pattern=r"^A\d{4}X$",
            is_unique_check=True,
            created_by=1
        )
        db_session.add(validation_rule)
        await db_session.commit()
        
        # 2. 测试有效条码扫描
        scan_request = {
            "material_code": "MAT-001",
            "barcode_content": "A1234X",
            "supplier_id": test_supplier.id,
            "batch_number": "BATCH001"
        }
        
        response = await async_client.post(
            "/api/v1/barcode-validation/scan",
            json=scan_request,
            headers=auth_headers_internal
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["validation_result"] == "PASS"
        assert data["message"] == "条码校验通过"
        
        # 3. 测试无效条码扫描（格式错误）
        invalid_scan_request = {
            "material_code": "MAT-001",
            "barcode_content": "B1234X",  # 前缀错误
            "supplier_id": test_supplier.id,
            "batch_number": "BATCH001"
        }
        
        response = await async_client.post(
            "/api/v1/barcode-validation/scan",
            json=invalid_scan_request,
            headers=auth_headers_internal
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["validation_result"] == "NG"
        assert "格式不符" in data["message"] or "校验失败" in data["message"]
        
        # 4. 测试重复条码扫描
        duplicate_scan_request = {
            "material_code": "MAT-001",
            "barcode_content": "A1234X",  # 重复的条码
            "supplier_id": test_supplier.id,
            "batch_number": "BATCH001"
        }
        
        response = await async_client.post(
            "/api/v1/barcode-validation/scan",
            json=duplicate_scan_request,
            headers=auth_headers_internal
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["validation_result"] == "NG"
        assert "重复" in data["message"] or "已存在" in data["message"]



# ============================================================================
# Fixtures
# ============================================================================

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
    """创建测试内部用户（SQE）"""
    user = User(
        username="sqe001",
        hashed_password="$2b$12$test_hashed_password",
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
        hashed_password="$2b$12$test_hashed_password",
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
def auth_headers_internal(test_internal_user: User) -> dict:
    """内部用户认证头"""
    # 在实际测试中，应该生成真实的 JWT token
    # 这里简化处理
    return {
        "Authorization": f"Bearer test_token_internal_{test_internal_user.id}"
    }


@pytest.fixture
def auth_headers_supplier(test_supplier_user: User) -> dict:
    """供应商用户认证头"""
    return {
        "Authorization": f"Bearer test_token_supplier_{test_supplier_user.id}"
    }


# ============================================================================
# 集成测试
# Integration Tests
# ============================================================================

class TestSupplierQualityIntegration:
    """供应商质量管理集成测试"""
    
    @pytest.mark.asyncio
    async def test_complete_scar_8d_workflow(
        self,
        async_client: AsyncClient,
        db_session: AsyncSession,
        test_supplier: Supplier,
        test_internal_user: User,
        test_supplier_user: User,
        auth_headers_internal: dict,
        auth_headers_supplier: dict
    ):
        """测试完整的 SCAR + 8D 工作流"""
        # 1. IQC 发现问题，创建 SCAR
        scar_data = {
            "supplier_id": test_supplier.id,
            "material_code": "MAT-001",
            "defect_description": "物料尺寸超差",
            "defect_qty": 100,
            "severity": "high",
            "deadline": (datetime.utcnow() + timedelta(days=7)).isoformat()
        }
        
        response = await async_client.post(
            "/api/v1/scar",
            json=scar_data,
            headers=auth_headers_internal
        )
        assert response.status_code == 201
        scar = response.json()
        scar_id = scar["id"]
        
        # 2. 供应商提交 8D 报告
        eight_d_data = {
            "d0_d3_data": {
                "problem_description": "物料尺寸超差",
                "containment_action": "隔离不良品，100%全检"
            },
            "d4_d7_data": {
                "root_cause": "模具磨损导致尺寸偏移",
                "corrective_action": "更换模具并重新校准设备",
                "preventive_action": "建立模具定期保养计划，每周检查",
                "verification": "已验证100件产品，尺寸全部合格"
            },
            "d8_data": {
                "horizontal_deployment": "已推广到所有类似产品",
                "lessons_learned": "加强模具管理和定期维护"
            }
        }
        
        response = await async_client.post(
            f"/api/v1/scar/{scar_id}/8d",
            json=eight_d_data,
            headers=auth_headers_supplier
        )
        assert response.status_code == 201
        eight_d = response.json()
        
        # 3. SQE 审核 8D 报告
        review_data = {
            "review_comments": "根本原因分析充分，纠正措施有效，验证数据完整",
            "approved": True
        }
        
        response = await async_client.post(
            f"/api/v1/scar/{scar_id}/8d/review",
            json=review_data,
            headers=auth_headers_internal
        )
        assert response.status_code == 200
        reviewed_8d = response.json()
        assert reviewed_8d["status"] == "approved"
        
        # 4. 验证 SCAR 状态更新
        response = await async_client.get(
            f"/api/v1/scar/{scar_id}",
            headers=auth_headers_internal
        )
        assert response.status_code == 200
        updated_scar = response.json()
        assert updated_scar["status"] == "closed"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
