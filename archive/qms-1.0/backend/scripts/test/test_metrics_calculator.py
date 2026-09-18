"""
质量指标计算引擎测试脚本
Test script for MetricsCalculator
"""
import asyncio
from datetime import date, timedelta
import sys
import os

# 添加项目根目录到 Python 路径
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.services.metrics_calculator import metrics_calculator, MetricsCalculator
from app.models.quality_metric import MetricType


async def test_metrics_calculator():
    """测试质量指标计算引擎"""
    
    print("=" * 80)
    print("质量指标计算引擎测试")
    print("=" * 80)
    
    # 创建数据库连接
    engine = create_async_engine(
        settings.DATABASE_URL,
        echo=False,
        future=True
    )
    
    async_session = sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False
    )
    
    async with async_session() as db:
        # 测试日期
        test_date = date.today() - timedelta(days=1)
        
        print(f"\n📅 测试日期: {test_date}")
        print("-" * 80)
        
        # 1. 测试来料批次合格率计算
        print("\n1️⃣ 测试来料批次合格率计算")
        result = await metrics_calculator.calculate_incoming_batch_pass_rate(
            db=db,
            target_date=test_date,
            supplier_id=1
        )
        print(f"   ✅ 来料批次合格率: {result['value']:.2f}%")
        print(f"   📊 总批次数: {result['total_batches']}, 不合格批次: {result['ng_batches']}")
        print(f"   🆔 指标ID: {result['metric_id']}")
        
        # 2. 测试物料上线不良 PPM 计算
        print("\n2️⃣ 测试物料上线不良 PPM 计算")
        result = await metrics_calculator.calculate_material_online_ppm(
            db=db,
            target_date=test_date,
            supplier_id=1
        )
        print(f"   ✅ 物料上线不良 PPM: {result['value']:.2f}")
        print(f"   📊 上线不良数: {result['online_defects']}, 入库总量: {result['total_incoming_qty']}")
        print(f"   🆔 指标ID: {result['metric_id']}")
        
        # 3. 测试制程不合格率计算
        print("\n3️⃣ 测试制程不合格率计算")
        result = await metrics_calculator.calculate_process_defect_rate(
            db=db,
            target_date=test_date,
            line_id="LINE-01",
            process_id="PROC-SMT"
        )
        print(f"   ✅ 制程不合格率: {result['value']:.2f}%")
        print(f"   📊 不合格品数: {result['process_ng_count']}, 成品产出: {result['finished_goods_count']}")
        print(f"   🏭 产线: {result['line_id']}, 工序: {result['process_id']}")
        print(f"   🆔 指标ID: {result['metric_id']}")
        
        # 4. 测试制程直通率计算
        print("\n4️⃣ 测试制程直通率 (FPY) 计算")
        result = await metrics_calculator.calculate_process_fpy(
            db=db,
            target_date=test_date,
            line_id="LINE-01",
            process_id="PROC-TEST"
        )
        print(f"   ✅ 制程直通率: {result['value']:.2f}%")
        print(f"   📊 一次通过数: {result['first_pass_count']}, 测试总数: {result['total_test_count']}")
        print(f"   🏭 产线: {result['line_id']}, 工序: {result['process_id']}")
        print(f"   🆔 指标ID: {result['metric_id']}")
        
        # 5. 测试 0KM 不良 PPM 计算
        print("\n5️⃣ 测试 0KM 不良 PPM 计算")
        result = await metrics_calculator.calculate_0km_ppm(
            db=db,
            target_date=test_date,
            product_type="MCU"
        )
        print(f"   ✅ 0KM 不良 PPM: {result['value']:.2f}")
        print(f"   📊 0KM客诉数: {result['okm_complaint_count']}, 出库总量: {result['total_shipment_qty']}")
        print(f"   📦 产品类型: {result['product_type']}")
        print(f"   🆔 指标ID: {result['metric_id']}")
        
        # 6. 测试 3MIS 售后不良 PPM 计算
        print("\n6️⃣ 测试 3MIS 售后不良 PPM 计算（滚动3个月）")
        result = await metrics_calculator.calculate_3mis_ppm(
            db=db,
            target_date=test_date,
            product_type="MCU"
        )
        print(f"   ✅ 3MIS 售后不良 PPM: {result['value']:.2f}")
        print(f"   📊 3MIS客诉数: {result['mis_3_complaint_count']}, 3个月出货量: {result['rolling_3m_shipment_qty']}")
        print(f"   📅 滚动周期: {result['rolling_period']}")
        print(f"   📦 产品类型: {result['product_type']}")
        print(f"   🆔 指标ID: {result['metric_id']}")
        
        # 7. 测试 12MIS 售后不良 PPM 计算
        print("\n7️⃣ 测试 12MIS 售后不良 PPM 计算（滚动12个月）")
        result = await metrics_calculator.calculate_12mis_ppm(
            db=db,
            target_date=test_date,
            product_type="MCU"
        )
        print(f"   ✅ 12MIS 售后不良 PPM: {result['value']:.2f}")
        print(f"   📊 12MIS客诉数: {result['mis_12_complaint_count']}, 12个月出货量: {result['rolling_12m_shipment_qty']}")
        print(f"   📅 滚动周期: {result['rolling_period']}")
        print(f"   📦 产品类型: {result['product_type']}")
        print(f"   🆔 指标ID: {result['metric_id']}")
        
        # 8. 测试批量计算所有指标
        print("\n8️⃣ 测试批量计算所有指标")
        result = await metrics_calculator.calculate_all_metrics(
            db=db,
            target_date=test_date,
            supplier_ids=[1, 2],
            product_types=["MCU", "BMS"],
            line_ids=["LINE-01", "LINE-02"],
            process_ids=["PROC-SMT", "PROC-TEST"]
        )
        print(f"   ✅ 批量计算完成")
        print(f"   📊 计算指标数量: {len(result['metrics'])}")
        print(f"   ⏱️ 开始时间: {result['started_at']}")
        print(f"   ⏱️ 完成时间: {result['completed_at']}")
        print(f"   ✔️ 整体成功: {result['overall_success']}")
        
        # 9. 测试查询指标趋势
        print("\n9️⃣ 测试查询指标趋势")
        start_date = test_date - timedelta(days=7)
        end_date = test_date
        
        trend_data = await metrics_calculator.get_metric_trend(
            db=db,
            metric_type=MetricType.INCOMING_BATCH_PASS_RATE,
            start_date=start_date,
            end_date=end_date,
            supplier_id=1
        )
        print(f"   ✅ 查询趋势数据")
        print(f"   📅 日期范围: {start_date} 至 {end_date}")
        print(f"   📊 数据点数量: {len(trend_data)}")
        
        if trend_data:
            print(f"   📈 趋势数据:")
            for metric in trend_data:
                print(f"      - {metric.metric_date}: {float(metric.value):.2f}%")
    
    print("\n" + "=" * 80)
    print("✅ 所有测试完成")
    print("=" * 80)


if __name__ == "__main__":
    asyncio.run(test_metrics_calculator())
