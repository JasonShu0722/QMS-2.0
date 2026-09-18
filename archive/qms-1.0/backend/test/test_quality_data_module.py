"""
质量数据模块测试
测试 IMS 数据同步逻辑、指标计算公式准确性、AI 诊断服务
Requirements: 2.4.1, 2.4.4
"""
import pytest
from datetime import date, datetime, timedelta
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.ims_integration_service import IMSIntegrationService
from app.services.metrics_calculator import MetricsCalculator
from app.services.ai_analysis_service import AIAnalysisService
from app.models.quality_metric import QualityMetric, MetricType
from app.models.ims_sync_log import IMSSyncLog, SyncType, SyncStatus
from app.models.supplier import Supplier


# ============================================================================
# IMS 数据同步逻辑测试
# ============================================================================

class TestIMSIntegrationService:
    """测试 IMS 数据同步服务"""
    
    @pytest.fixture
    async def ims_service(self):
        """创建 IMS 集成服务实例"""
        return IMSIntegrationService()
    
    @pytest.fixture
    async def test_supplier(self, db_session: AsyncSession) -> Supplier:
        """创建测试供应商"""
        supplier = Supplier(
            name="测试供应商A",
            code="SUP001",
            contact_person="张三",
            contact_email="zhangsan@supplier.com",
            contact_phone="13800138001",
            status="active",
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        db_session.add(supplier)
        await db_session.commit()
        await db_session.refresh(supplier)
        return supplier

    @pytest.mark.asyncio
    async def test_fetch_incoming_inspection_data_success(
        self, ims_service, db_session, test_supplier
    ):
        """测试成功拉取入库检验数据"""
        # Mock IMS API 响应
        mock_response = {
            "success": True,
            "data": [
                {
                    "material_code": "MAT001",
                    "batch_number": "BATCH001",
                    "supplier_code": "SUP001",
                    "inspection_date": "2024-01-15",
                    "inspection_result": "OK",
                    "incoming_qty": 1000,
                    "defect_qty": 0
                },
                {
                    "material_code": "MAT002",
                    "batch_number": "BATCH002",
                    "supplier_code": "SUP001",
                    "inspection_date": "2024-01-15",
                    "inspection_result": "NG",
                    "incoming_qty": 500,
                    "defect_qty": 50
                }
            ]
        }
        
        with patch.object(
            ims_service, '_make_request', 
            return_value=mock_response
        ) as mock_request:
            # 执行同步
            result = await ims_service.fetch_incoming_inspection_data(
                db_session,
                start_date=date(2024, 1, 15),
                end_date=date(2024, 1, 15)
            )
            
            # 验证结果
            assert result["success"] is True
            assert result["records_count"] == 2
            assert "批次数据" in result["message"]
            
            # 验证 API 调用
            mock_request.assert_called_once()

    @pytest.mark.asyncio
    async def test_fetch_incoming_inspection_data_api_error(
        self, ims_service, db_session
    ):
        """测试 IMS API 返回错误"""
        # Mock IMS API 错误响应
        with patch.object(
            ims_service, '_make_request',
            side_effect=Exception("IMS 连接超时")
        ):
            # 执行同步
            result = await ims_service.fetch_incoming_inspection_data(
                db_session,
                start_date=date(2024, 1, 15),
                end_date=date(2024, 1, 15)
            )
            
            # 验证错误处理
            assert result["success"] is False
            assert "IMS 连接超时" in result["error_message"]
            
            # 验证同步日志记录
            sync_log = await db_session.execute(
                "SELECT * FROM ims_sync_logs WHERE sync_type = 'incoming_inspection' ORDER BY id DESC LIMIT 1"
            )
            log = sync_log.first()
            if log:
                assert log.status == SyncStatus.FAILED.value


# ============================================================================
# 指标计算公式准确性测试
# ============================================================================

class TestMetricsCalculator:
    """测试指标计算引擎"""
    
    @pytest.fixture
    async def calculator(self):
        """创建指标计算器实例"""
        return MetricsCalculator()

    @pytest.mark.asyncio
    async def test_calculate_incoming_batch_pass_rate(
        self, calculator, db_session, test_supplier
    ):
        """测试来料批次合格率计算公式
        公式: ((总批次数 - 不合格批次数) / 总批次数) * 100%
        """
        # 准备测试数据：10个批次，2个不合格
        test_date = date(2024, 1, 15)
        
        # Mock 数据库查询结果
        mock_data = {
            "total_batches": 10,
            "ng_batches": 2,
            "supplier_id": test_supplier.id
        }
        
        with patch.object(
            db_session, 'execute',
            return_value=AsyncMock(
                fetchall=lambda: [(mock_data["total_batches"], mock_data["ng_batches"])]
            )
        ):
            # 执行计算
            result = await calculator.calculate_incoming_batch_pass_rate(
                db_session,
                calculation_date=test_date,
                supplier_id=test_supplier.id
            )
            
            # 验证计算结果
            expected_rate = ((10 - 2) / 10) * 100  # 80%
            assert result["success"] is True
            assert len(result["metrics"]) > 0
            
            metric = result["metrics"][0]
            assert float(metric["value"]) == pytest.approx(expected_rate, rel=0.01)
            assert metric["metric_type"] == MetricType.INCOMING_BATCH_PASS_RATE.value

    @pytest.mark.asyncio
    async def test_calculate_material_online_ppm(
        self, calculator, db_session, test_supplier
    ):
        """测试物料上线不良PPM计算公式
        公式: (物料上线不良数 / 物料入库总数量) * 1,000,000
        """
        test_date = date(2024, 1, 15)
        
        # Mock 数据：入库10000个，不良50个
        mock_data = {
            "total_incoming_qty": 10000,
            "defect_qty": 50,
            "supplier_id": test_supplier.id
        }
        
        with patch.object(
            db_session, 'execute',
            return_value=AsyncMock(
                fetchall=lambda: [(mock_data["total_incoming_qty"], mock_data["defect_qty"])]
            )
        ):
            # 执行计算
            result = await calculator.calculate_material_online_ppm(
                db_session,
                calculation_date=test_date,
                supplier_id=test_supplier.id
            )
            
            # 验证计算结果
            expected_ppm = (50 / 10000) * 1_000_000  # 5000 PPM
            assert result["success"] is True
            assert len(result["metrics"]) > 0
            
            metric = result["metrics"][0]
            assert float(metric["value"]) == pytest.approx(expected_ppm, rel=0.01)
            assert metric["metric_type"] == MetricType.MATERIAL_ONLINE_PPM.value

    @pytest.mark.asyncio
    async def test_calculate_process_defect_rate(
        self, calculator, db_session
    ):
        """测试制程不合格率计算公式
        公式: (完成制程不合格品数 / 成品产出入库数) * 100%
        """
        test_date = date(2024, 1, 15)
        
        # Mock 数据：产出1000个，不合格30个
        mock_data = {
            "finished_goods_count": 1000,
            "process_ng_count": 30
        }
        
        with patch.object(
            db_session, 'execute',
            return_value=AsyncMock(
                fetchall=lambda: [(mock_data["finished_goods_count"], mock_data["process_ng_count"])]
            )
        ):
            # 执行计算
            result = await calculator.calculate_process_defect_rate(
                db_session,
                calculation_date=test_date
            )
            
            # 验证计算结果
            expected_rate = (30 / 1000) * 100  # 3%
            assert result["success"] is True
            assert len(result["metrics"]) > 0
            
            metric = result["metrics"][0]
            assert float(metric["value"]) == pytest.approx(expected_rate, rel=0.01)
            assert metric["metric_type"] == MetricType.PROCESS_DEFECT_RATE.value

    @pytest.mark.asyncio
    async def test_calculate_process_fpy(
        self, calculator, db_session
    ):
        """测试制程直通率计算公式
        公式: (一次测试通过数 / 一次测试总数量) * 100%
        """
        test_date = date(2024, 1, 15)
        
        # Mock 数据：测试1000个，通过950个
        mock_data = {
            "first_pass_count": 950,
            "total_test_count": 1000
        }
        
        with patch.object(
            db_session, 'execute',
            return_value=AsyncMock(
                fetchall=lambda: [(mock_data["first_pass_count"], mock_data["total_test_count"])]
            )
        ):
            # 执行计算
            result = await calculator.calculate_process_fpy(
                db_session,
                calculation_date=test_date
            )
            
            # 验证计算结果
            expected_fpy = (950 / 1000) * 100  # 95%
            assert result["success"] is True
            assert len(result["metrics"]) > 0
            
            metric = result["metrics"][0]
            assert float(metric["value"]) == pytest.approx(expected_fpy, rel=0.01)
            assert metric["metric_type"] == MetricType.PROCESS_FPY.value

    @pytest.mark.asyncio
    async def test_calculate_0km_ppm(
        self, calculator, db_session
    ):
        """测试0KM不良PPM计算公式
        公式: (0KM客诉数 / 成品出库总量) * 1,000,000
        """
        test_date = date(2024, 1, 15)
        
        # Mock 数据：出货100000个，0KM客诉5个
        mock_data = {
            "shipment_qty": 100000,
            "complaint_count": 5
        }
        
        with patch.object(
            db_session, 'execute',
            return_value=AsyncMock(
                fetchall=lambda: [(mock_data["shipment_qty"], mock_data["complaint_count"])]
            )
        ):
            # 执行计算
            result = await calculator.calculate_0km_ppm(
                db_session,
                calculation_date=test_date
            )
            
            # 验证计算结果
            expected_ppm = (5 / 100000) * 1_000_000  # 50 PPM
            assert result["success"] is True
            assert len(result["metrics"]) > 0
            
            metric = result["metrics"][0]
            assert float(metric["value"]) == pytest.approx(expected_ppm, rel=0.01)
            assert metric["metric_type"] == MetricType.OKM_PPM.value

    @pytest.mark.asyncio
    async def test_calculate_3mis_ppm(
        self, calculator, db_session
    ):
        """测试3MIS售后不良PPM计算公式（滚动3个月）
        公式: (3mis客诉数 / 3个月滚动出货量) * 1,000,000
        """
        test_date = date(2024, 1, 15)
        
        # Mock 数据：3个月出货300000个，客诉10个
        mock_data = {
            "rolling_shipment_qty": 300000,
            "complaint_count": 10
        }
        
        with patch.object(
            db_session, 'execute',
            return_value=AsyncMock(
                fetchall=lambda: [(mock_data["rolling_shipment_qty"], mock_data["complaint_count"])]
            )
        ):
            # 执行计算
            result = await calculator.calculate_3mis_ppm(
                db_session,
                calculation_date=test_date
            )
            
            # 验证计算结果
            expected_ppm = (10 / 300000) * 1_000_000  # 33.33 PPM
            assert result["success"] is True
            assert len(result["metrics"]) > 0
            
            metric = result["metrics"][0]
            assert float(metric["value"]) == pytest.approx(expected_ppm, rel=0.01)
            assert metric["metric_type"] == MetricType.MIS_3_PPM.value

    @pytest.mark.asyncio
    async def test_calculate_12mis_ppm(
        self, calculator, db_session
    ):
        """测试12MIS售后不良PPM计算公式（滚动12个月）
        公式: (12mis客诉数 / 12个月滚动出货量) * 1,000,000
        """
        test_date = date(2024, 1, 15)
        
        # Mock 数据：12个月出货1200000个，客诉30个
        mock_data = {
            "rolling_shipment_qty": 1200000,
            "complaint_count": 30
        }
        
        with patch.object(
            db_session, 'execute',
            return_value=AsyncMock(
                fetchall=lambda: [(mock_data["rolling_shipment_qty"], mock_data["complaint_count"])]
            )
        ):
            # 执行计算
            result = await calculator.calculate_12mis_ppm(
                db_session,
                calculation_date=test_date
            )
            
            # 验证计算结果
            expected_ppm = (30 / 1200000) * 1_000_000  # 25 PPM
            assert result["success"] is True
            assert len(result["metrics"]) > 0
            
            metric = result["metrics"][0]
            assert float(metric["value"]) == pytest.approx(expected_ppm, rel=0.01)
            assert metric["metric_type"] == MetricType.MIS_12_PPM.value


# ============================================================================
# AI 诊断服务测试
# ============================================================================

class TestAIAnalysisService:
    """测试 AI 智能诊断服务"""
    
    @pytest.fixture
    async def ai_service(self):
        """创建 AI 分析服务实例"""
        return AIAnalysisService()

    @pytest.mark.asyncio
    async def test_analyze_anomaly_with_api_key(
        self, ai_service, db_session
    ):
        """测试异常诊断功能（有API密钥）"""
        # Mock OpenAI API 响应
        mock_ai_response = {
            "analysis": "检测到今日制程不合格率飙升至5%。关联分析显示：发生批量不良。",
            "root_causes": [
                "物料批次异常",
                "设备参数漂移"
            ],
            "recommendations": [
                "立即隔离问题批次",
                "检查设备校准状态"
            ]
        }
        
        with patch.dict('os.environ', {'OPENAI_API_KEY': 'test-key'}):
            with patch('openai.ChatCompletion.acreate') as mock_openai:
                mock_openai.return_value = AsyncMock(
                    choices=[
                        MagicMock(
                            message=MagicMock(
                                content=str(mock_ai_response)
                            )
                        )
                    ]
                )
                
                # 执行异常诊断
                result = await ai_service.analyze_anomaly(
                    db_session,
                    metric_type="process_defect_rate",
                    current_value=5.0,
                    historical_avg=2.0,
                    analysis_date=date(2024, 1, 15)
                )
                
                # 验证结果
                assert result["success"] is True
                assert "analysis" in result
                assert len(result["root_causes"]) > 0

    @pytest.mark.asyncio
    async def test_analyze_anomaly_without_api_key(
        self, ai_service, db_session
    ):
        """测试异常诊断功能（无API密钥）"""
        with patch.dict('os.environ', {}, clear=True):
            # 执行异常诊断
            result = await ai_service.analyze_anomaly(
                db_session,
                metric_type="process_defect_rate",
                current_value=5.0,
                historical_avg=2.0,
                analysis_date=date(2024, 1, 15)
            )
            
            # 验证降级处理
            assert result["success"] is False
            assert "AI服务未配置" in result.get("error", "")
    
    @pytest.mark.asyncio
    async def test_natural_language_query_with_api_key(
        self, ai_service, db_session
    ):
        """测试自然语言查询功能（有API密钥）"""
        # Mock OpenAI API 响应
        mock_sql = "SELECT * FROM quality_metrics WHERE metric_type = 'okm_ppm' AND metric_date >= '2023-10-01'"
        
        with patch.dict('os.environ', {'OPENAI_API_KEY': 'test-key'}):
            with patch('openai.ChatCompletion.acreate') as mock_openai:
                mock_openai.return_value = AsyncMock(
                    choices=[
                        MagicMock(
                            message=MagicMock(
                                content=f"```sql\n{mock_sql}\n```"
                            )
                        )
                    ]
                )
                
                # 执行自然语言查询
                result = await ai_service.natural_language_query(
                    db_session,
                    user_query="帮我把过去三个月MCU产品的0KM不良率趋势画成折线图"
                )
                
                # 验证结果
                assert result["success"] is True
                assert "generated_sql" in result
                assert "SELECT" in result["generated_sql"]

    @pytest.mark.asyncio
    async def test_natural_language_query_without_api_key(
        self, ai_service, db_session
    ):
        """测试自然语言查询功能（无API密钥）"""
        with patch.dict('os.environ', {}, clear=True):
            # 执行自然语言查询
            result = await ai_service.natural_language_query(
                db_session,
                user_query="查询过去三个月的0KM不良率"
            )
            
            # 验证降级处理
            assert result["success"] is False
            assert "AI服务未配置" in result.get("error", "")


# ============================================================================
# 集成测试：端到端数据流
# ============================================================================

class TestQualityDataIntegration:
    """测试质量数据模块的端到端集成"""
    
    @pytest.mark.asyncio
    async def test_full_data_pipeline(
        self, db_session, test_supplier
    ):
        """测试完整数据流：IMS同步 -> 指标计算 -> 数据存储"""
        # 1. 模拟 IMS 数据同步
        ims_service = IMSIntegrationService()
        calculator = MetricsCalculator()
        
        test_date = date(2024, 1, 15)
        
        # Mock IMS 数据
        mock_ims_data = {
            "success": True,
            "data": [
                {
                    "material_code": "MAT001",
                    "batch_number": "BATCH001",
                    "supplier_code": "SUP001",
                    "inspection_date": "2024-01-15",
                    "inspection_result": "OK",
                    "incoming_qty": 1000,
                    "defect_qty": 0
                }
            ]
        }
        
        with patch.object(ims_service, '_make_request', return_value=mock_ims_data):
            sync_result = await ims_service.fetch_incoming_inspection_data(
                db_session,
                start_date=test_date,
                end_date=test_date
            )
            
            assert sync_result["success"] is True
        
        # 2. 执行指标计算（使用 Mock 数据）
        with patch.object(
            db_session, 'execute',
            return_value=AsyncMock(fetchall=lambda: [(10, 2)])
        ):
            calc_result = await calculator.calculate_incoming_batch_pass_rate(
                db_session,
                calculation_date=test_date,
                supplier_id=test_supplier.id
            )
            
            assert calc_result["success"] is True
            assert len(calc_result["metrics"]) > 0
