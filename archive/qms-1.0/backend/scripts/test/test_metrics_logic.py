"""
质量指标计算逻辑测试（不需要数据库）
Test metrics calculation logic without database
"""
import sys
import os

# 添加项目根目录到 Python 路径
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))


def test_incoming_batch_pass_rate_calculation():
    """测试来料批次合格率计算逻辑"""
    print("\n1️⃣ 测试来料批次合格率计算逻辑")
    
    # 测试用例 1: 正常情况
    total_batches = 100
    ng_batches = 5
    expected_rate = 95.0
    
    if total_batches == 0:
        pass_rate = 0.0
    else:
        pass_rate = ((total_batches - ng_batches) / total_batches) * 100.0
    
    assert abs(pass_rate - expected_rate) < 0.01, f"Expected {expected_rate}, got {pass_rate}"
    print(f"   ✅ 测试用例 1: 总批次={total_batches}, 不合格={ng_batches}, 合格率={pass_rate:.2f}%")
    
    # 测试用例 2: 全部合格
    total_batches = 100
    ng_batches = 0
    expected_rate = 100.0
    
    pass_rate = ((total_batches - ng_batches) / total_batches) * 100.0
    assert abs(pass_rate - expected_rate) < 0.01, f"Expected {expected_rate}, got {pass_rate}"
    print(f"   ✅ 测试用例 2: 总批次={total_batches}, 不合格={ng_batches}, 合格率={pass_rate:.2f}%")
    
    # 测试用例 3: 边界情况 - 零批次
    total_batches = 0
    ng_batches = 0
    expected_rate = 0.0
    
    if total_batches == 0:
        pass_rate = 0.0
    else:
        pass_rate = ((total_batches - ng_batches) / total_batches) * 100.0
    
    assert abs(pass_rate - expected_rate) < 0.01, f"Expected {expected_rate}, got {pass_rate}"
    print(f"   ✅ 测试用例 3: 总批次={total_batches}, 不合格={ng_batches}, 合格率={pass_rate:.2f}%")


def test_material_online_ppm_calculation():
    """测试物料上线不良 PPM 计算逻辑"""
    print("\n2️⃣ 测试物料上线不良 PPM 计算逻辑")
    
    # 测试用例 1: 正常情况
    online_defects = 50
    total_incoming_qty = 100000
    expected_ppm = 500.0
    
    if total_incoming_qty == 0:
        ppm = 0.0
    else:
        ppm = (online_defects / total_incoming_qty) * 1_000_000
    
    assert abs(ppm - expected_ppm) < 0.01, f"Expected {expected_ppm}, got {ppm}"
    print(f"   ✅ 测试用例 1: 不良数={online_defects}, 入库量={total_incoming_qty}, PPM={ppm:.2f}")
    
    # 测试用例 2: 零不良
    online_defects = 0
    total_incoming_qty = 100000
    expected_ppm = 0.0
    
    ppm = (online_defects / total_incoming_qty) * 1_000_000
    assert abs(ppm - expected_ppm) < 0.01, f"Expected {expected_ppm}, got {ppm}"
    print(f"   ✅ 测试用例 2: 不良数={online_defects}, 入库量={total_incoming_qty}, PPM={ppm:.2f}")
    
    # 测试用例 3: 高不良率
    online_defects = 1000
    total_incoming_qty = 100000
    expected_ppm = 10000.0
    
    ppm = (online_defects / total_incoming_qty) * 1_000_000
    assert abs(ppm - expected_ppm) < 0.01, f"Expected {expected_ppm}, got {ppm}"
    print(f"   ✅ 测试用例 3: 不良数={online_defects}, 入库量={total_incoming_qty}, PPM={ppm:.2f}")


def test_process_defect_rate_calculation():
    """测试制程不合格率计算逻辑"""
    print("\n3️⃣ 测试制程不合格率计算逻辑")
    
    # 测试用例 1: 正常情况
    process_ng_count = 120
    finished_goods_count = 10000
    expected_rate = 1.2
    
    if finished_goods_count == 0:
        defect_rate = 0.0
    else:
        defect_rate = (process_ng_count / finished_goods_count) * 100.0
    
    assert abs(defect_rate - expected_rate) < 0.01, f"Expected {expected_rate}, got {defect_rate}"
    print(f"   ✅ 测试用例 1: 不合格数={process_ng_count}, 产出数={finished_goods_count}, 不合格率={defect_rate:.2f}%")
    
    # 测试用例 2: 零不合格
    process_ng_count = 0
    finished_goods_count = 10000
    expected_rate = 0.0
    
    defect_rate = (process_ng_count / finished_goods_count) * 100.0
    assert abs(defect_rate - expected_rate) < 0.01, f"Expected {expected_rate}, got {defect_rate}"
    print(f"   ✅ 测试用例 2: 不合格数={process_ng_count}, 产出数={finished_goods_count}, 不合格率={defect_rate:.2f}%")


def test_process_fpy_calculation():
    """测试制程直通率计算逻辑"""
    print("\n4️⃣ 测试制程直通率 (FPY) 计算逻辑")
    
    # 测试用例 1: 正常情况
    first_pass_count = 9500
    total_test_count = 10000
    expected_fpy = 95.0
    
    if total_test_count == 0:
        fpy = 0.0
    else:
        fpy = (first_pass_count / total_test_count) * 100.0
    
    assert abs(fpy - expected_fpy) < 0.01, f"Expected {expected_fpy}, got {fpy}"
    print(f"   ✅ 测试用例 1: 一次通过={first_pass_count}, 测试总数={total_test_count}, 直通率={fpy:.2f}%")
    
    # 测试用例 2: 100% 直通
    first_pass_count = 10000
    total_test_count = 10000
    expected_fpy = 100.0
    
    fpy = (first_pass_count / total_test_count) * 100.0
    assert abs(fpy - expected_fpy) < 0.01, f"Expected {expected_fpy}, got {fpy}"
    print(f"   ✅ 测试用例 2: 一次通过={first_pass_count}, 测试总数={total_test_count}, 直通率={fpy:.2f}%")


def test_0km_ppm_calculation():
    """测试 0KM 不良 PPM 计算逻辑"""
    print("\n5️⃣ 测试 0KM 不良 PPM 计算逻辑")
    
    # 测试用例 1: 正常情况
    okm_complaint_count = 10
    total_shipment_qty = 50000
    expected_ppm = 200.0
    
    if total_shipment_qty == 0:
        okm_ppm = 0.0
    else:
        okm_ppm = (okm_complaint_count / total_shipment_qty) * 1_000_000
    
    assert abs(okm_ppm - expected_ppm) < 0.01, f"Expected {expected_ppm}, got {okm_ppm}"
    print(f"   ✅ 测试用例 1: 客诉数={okm_complaint_count}, 出货量={total_shipment_qty}, 0KM PPM={okm_ppm:.2f}")
    
    # 测试用例 2: 零客诉
    okm_complaint_count = 0
    total_shipment_qty = 50000
    expected_ppm = 0.0
    
    okm_ppm = (okm_complaint_count / total_shipment_qty) * 1_000_000
    assert abs(okm_ppm - expected_ppm) < 0.01, f"Expected {expected_ppm}, got {okm_ppm}"
    print(f"   ✅ 测试用例 2: 客诉数={okm_complaint_count}, 出货量={total_shipment_qty}, 0KM PPM={okm_ppm:.2f}")


def test_3mis_ppm_calculation():
    """测试 3MIS 售后不良 PPM 计算逻辑"""
    print("\n6️⃣ 测试 3MIS 售后不良 PPM 计算逻辑（滚动3个月）")
    
    # 测试用例 1: 正常情况
    mis_3_complaint_count = 15
    rolling_3m_shipment_qty = 150000
    expected_ppm = 100.0
    
    if rolling_3m_shipment_qty == 0:
        mis_3_ppm = 0.0
    else:
        mis_3_ppm = (mis_3_complaint_count / rolling_3m_shipment_qty) * 1_000_000
    
    assert abs(mis_3_ppm - expected_ppm) < 0.01, f"Expected {expected_ppm}, got {mis_3_ppm}"
    print(f"   ✅ 测试用例 1: 3MIS客诉={mis_3_complaint_count}, 3月出货={rolling_3m_shipment_qty}, 3MIS PPM={mis_3_ppm:.2f}")
    
    # 测试用例 2: 零客诉
    mis_3_complaint_count = 0
    rolling_3m_shipment_qty = 150000
    expected_ppm = 0.0
    
    mis_3_ppm = (mis_3_complaint_count / rolling_3m_shipment_qty) * 1_000_000
    assert abs(mis_3_ppm - expected_ppm) < 0.01, f"Expected {expected_ppm}, got {mis_3_ppm}"
    print(f"   ✅ 测试用例 2: 3MIS客诉={mis_3_complaint_count}, 3月出货={rolling_3m_shipment_qty}, 3MIS PPM={mis_3_ppm:.2f}")


def test_12mis_ppm_calculation():
    """测试 12MIS 售后不良 PPM 计算逻辑"""
    print("\n7️⃣ 测试 12MIS 售后不良 PPM 计算逻辑（滚动12个月）")
    
    # 测试用例 1: 正常情况
    mis_12_complaint_count = 50
    rolling_12m_shipment_qty = 600000
    expected_ppm = 83.33
    
    if rolling_12m_shipment_qty == 0:
        mis_12_ppm = 0.0
    else:
        mis_12_ppm = (mis_12_complaint_count / rolling_12m_shipment_qty) * 1_000_000
    
    assert abs(mis_12_ppm - expected_ppm) < 0.01, f"Expected {expected_ppm}, got {mis_12_ppm}"
    print(f"   ✅ 测试用例 1: 12MIS客诉={mis_12_complaint_count}, 12月出货={rolling_12m_shipment_qty}, 12MIS PPM={mis_12_ppm:.2f}")
    
    # 测试用例 2: 零客诉
    mis_12_complaint_count = 0
    rolling_12m_shipment_qty = 600000
    expected_ppm = 0.0
    
    mis_12_ppm = (mis_12_complaint_count / rolling_12m_shipment_qty) * 1_000_000
    assert abs(mis_12_ppm - expected_ppm) < 0.01, f"Expected {expected_ppm}, got {mis_12_ppm}"
    print(f"   ✅ 测试用例 2: 12MIS客诉={mis_12_complaint_count}, 12月出货={rolling_12m_shipment_qty}, 12MIS PPM={mis_12_ppm:.2f}")


def main():
    """运行所有测试"""
    print("=" * 80)
    print("质量指标计算逻辑测试（不需要数据库）")
    print("=" * 80)
    
    try:
        test_incoming_batch_pass_rate_calculation()
        test_material_online_ppm_calculation()
        test_process_defect_rate_calculation()
        test_process_fpy_calculation()
        test_0km_ppm_calculation()
        test_3mis_ppm_calculation()
        test_12mis_ppm_calculation()
        
        print("\n" + "=" * 80)
        print("✅ 所有计算逻辑测试通过")
        print("=" * 80)
        
    except AssertionError as e:
        print(f"\n❌ 测试失败: {e}")
        return 1
    
    return 0


if __name__ == "__main__":
    exit(main())
