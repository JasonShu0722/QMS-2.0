"""
测试 IQC 数据集成功能
Test IQC Data Integration
"""
import asyncio
from datetime import date, timedelta
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.services.ims_integration_service import ims_integration_service


async def test_sync_iqc_inspection_results():
    """测试同步 IQC 检验结果"""
    print("\n" + "="*60)
    print("测试 1: 同步 IQC 检验结果")
    print("="*60)
    
    # 创建数据库连接
    engine = create_async_engine(settings.DATABASE_URL, echo=False)
    async_session = sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )
    
    async with async_session() as session:
        # 测试同步昨天的数据
        target_date = date.today() - timedelta(days=1)
        
        print(f"\n📅 同步日期: {target_date}")
        
        result = await ims_integration_service.sync_iqc_inspection_results(
            db=session,
            start_date=target_date
        )
        
        print(f"\n📊 同步结果:")
        print(f"  - 成功: {result['success']}")
        print(f"  - 总记录数: {result['records_count']}")
        print(f"  - NG 记录数: {result['ng_count']}")
        print(f"  - 自动创建 SCAR 数: {result['auto_scar_count']}")
        
        if result['error']:
            print(f"  - 错误信息: {result['error']}")
        
        # 显示部分数据样本
        if result['data']:
            print(f"\n📋 数据样本 (前3条):")
            for i, record in enumerate(result['data'][:3], 1):
                print(f"  {i}. 物料: {record.get('material_code')}, "
                      f"供应商: {record.get('supplier_code')}, "
                      f"结果: {record.get('inspection_result')}")


async def test_auto_create_scar_on_ng():
    """测试 NG 自动立案逻辑"""
    print("\n" + "="*60)
    print("测试 2: NG 自动立案逻辑")
    print("="*60)
    
    # 创建数据库连接
    engine = create_async_engine(settings.DATABASE_URL, echo=False)
    async_session = sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )
    
    async with async_session() as session:
        # 模拟 NG 记录
        mock_ng_records = [
            {
                "material_code": "MAT-001",
                "supplier_code": "SUP-001",
                "defect_description": "尺寸超差",
                "defect_qty": 50,
                "batch_number": "BATCH-20240115-001"
            },
            {
                "material_code": "MAT-002",
                "supplier_code": "SUP-002",
                "defect_description": "外观不良",
                "defect_qty": 120,
                "batch_number": "BATCH-20240115-002"
            }
        ]
        
        print(f"\n📝 模拟 NG 记录数: {len(mock_ng_records)}")
        
        result = await ims_integration_service.auto_create_scar_on_ng(
            db=session,
            ng_records=mock_ng_records
        )
        
        print(f"\n📊 创建结果:")
        print(f"  - 成功创建: {result['created_count']}")
        print(f"  - 跳过: {result['skipped_count']}")
        
        if result['errors']:
            print(f"\n⚠️ 错误列表:")
            for error in result['errors']:
                print(f"  - {error}")


async def test_sync_special_approval_records():
    """测试同步特采记录"""
    print("\n" + "="*60)
    print("测试 3: 同步特采记录")
    print("="*60)
    
    # 创建数据库连接
    engine = create_async_engine(settings.DATABASE_URL, echo=False)
    async_session = sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )
    
    async with async_session() as session:
        # 测试同步昨天的数据
        target_date = date.today() - timedelta(days=1)
        
        print(f"\n📅 同步日期: {target_date}")
        
        result = await ims_integration_service.sync_special_approval_records(
            db=session,
            start_date=target_date
        )
        
        print(f"\n📊 同步结果:")
        print(f"  - 成功: {result['success']}")
        print(f"  - 总记录数: {result['records_count']}")
        
        if result['error']:
            print(f"  - 错误信息: {result['error']}")
        
        # 显示部分数据样本
        if result['data']:
            print(f"\n📋 数据样本 (前3条):")
            for i, record in enumerate(result['data'][:3], 1):
                print(f"  {i}. 物料: {record.get('material_code')}, "
                      f"批次: {record.get('batch_number')}, "
                      f"特采原因: {record.get('approval_reason')}")


async def test_sync_all_data_with_iqc():
    """测试完整数据同步（包含 IQC）"""
    print("\n" + "="*60)
    print("测试 4: 完整数据同步（包含 IQC）")
    print("="*60)
    
    # 创建数据库连接
    engine = create_async_engine(settings.DATABASE_URL, echo=False)
    async_session = sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )
    
    async with async_session() as session:
        # 测试同步昨天的数据
        target_date = date.today() - timedelta(days=1)
        
        print(f"\n📅 同步日期: {target_date}")
        
        result = await ims_integration_service.sync_all_data(
            db=session,
            target_date=target_date
        )
        
        print(f"\n📊 同步结果汇总:")
        print(f"  - 整体成功: {result['overall_success']}")
        print(f"  - 开始时间: {result['started_at']}")
        print(f"  - 完成时间: {result['completed_at']}")
        
        print(f"\n📋 各模块同步状态:")
        print(f"  1. 入库检验: {result['incoming_inspection']['success']} "
              f"({result['incoming_inspection']['records_count']} 条)")
        print(f"  2. 成品产出: {result['production_output']['success']} "
              f"({result['production_output']['records_count']} 条)")
        print(f"  3. 制程测试: {result['process_test']['success']} "
              f"({result['process_test']['records_count']} 条)")
        print(f"  4. IQC 检验: {result['iqc_results']['success']} "
              f"({result['iqc_results']['records_count']} 条, "
              f"{result['iqc_results']['ng_count']} NG, "
              f"{result['iqc_results']['auto_scar_count']} SCAR)")
        print(f"  5. 特采记录: {result['special_approval']['success']} "
              f"({result['special_approval']['records_count']} 条)")


async def main():
    """主测试函数"""
    print("\n" + "="*60)
    print("IQC 数据集成功能测试")
    print("="*60)
    
    try:
        # 测试 1: 同步 IQC 检验结果
        await test_sync_iqc_inspection_results()
        
        # 测试 2: NG 自动立案逻辑
        await test_auto_create_scar_on_ng()
        
        # 测试 3: 同步特采记录
        await test_sync_special_approval_records()
        
        # 测试 4: 完整数据同步
        await test_sync_all_data_with_iqc()
        
        print("\n" + "="*60)
        print("✅ 所有测试完成")
        print("="*60 + "\n")
        
    except Exception as e:
        print(f"\n❌ 测试失败: {str(e)}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())
