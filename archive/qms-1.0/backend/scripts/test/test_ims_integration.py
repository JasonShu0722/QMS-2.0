"""
IMS 集成服务测试脚本
用于验证 IMS 数据集成服务的基本功能
"""
import asyncio
import sys
from pathlib import Path
from datetime import date, timedelta

# 添加项目根目录到 Python 路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.services.ims_integration_service import ims_integration_service
from app.models.ims_sync_log import SyncType


async def test_ims_integration():
    """测试 IMS 集成服务"""
    
    print("=" * 60)
    print("🧪 IMS 集成服务测试")
    print("=" * 60)
    
    # 创建数据库引擎
    engine = create_async_engine(
        settings.DATABASE_URL,
        echo=False,
        pool_pre_ping=True,
    )
    
    # 创建会话工厂
    AsyncSessionLocal = sessionmaker(
        bind=engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    
    async with AsyncSessionLocal() as db:
        try:
            # 测试日期：昨天
            test_date = date.today() - timedelta(days=1)
            
            print(f"\n📅 测试日期: {test_date}")
            print(f"🔗 IMS Base URL: {settings.IMS_BASE_URL or '未配置'}")
            
            # 检查配置
            if not settings.IMS_BASE_URL:
                print("\n⚠️  警告: IMS_BASE_URL 未配置")
                print("   请在 .env 文件中设置 IMS_BASE_URL")
                print("   示例: IMS_BASE_URL=http://ims.company.com/api")
                print("\n   继续测试将模拟失败场景...")
            
            print("\n" + "=" * 60)
            print("测试 1: 拉取入库检验数据")
            print("=" * 60)
            
            result1 = await ims_integration_service.fetch_incoming_inspection_data(
                db=db,
                start_date=test_date
            )
            
            print(f"✅ 测试完成")
            print(f"   - 成功: {result1['success']}")
            print(f"   - 记录数: {result1['records_count']}")
            if result1['error']:
                print(f"   - 错误: {result1['error']}")
            
            print("\n" + "=" * 60)
            print("测试 2: 拉取成品产出数据")
            print("=" * 60)
            
            result2 = await ims_integration_service.fetch_production_output_data(
                db=db,
                start_date=test_date
            )
            
            print(f"✅ 测试完成")
            print(f"   - 成功: {result2['success']}")
            print(f"   - 记录数: {result2['records_count']}")
            if result2['error']:
                print(f"   - 错误: {result2['error']}")
            
            print("\n" + "=" * 60)
            print("测试 3: 拉取制程测试数据")
            print("=" * 60)
            
            result3 = await ims_integration_service.fetch_process_test_data(
                db=db,
                start_date=test_date
            )
            
            print(f"✅ 测试完成")
            print(f"   - 成功: {result3['success']}")
            print(f"   - 记录数: {result3['records_count']}")
            if result3['error']:
                print(f"   - 错误: {result3['error']}")
            
            print("\n" + "=" * 60)
            print("测试 4: 同步成品入库数据（制程质量管理）")
            print("=" * 60)
            
            result4 = await ims_integration_service.sync_production_output(
                db=db,
                start_date=test_date
            )
            
            print(f"✅ 测试完成")
            print(f"   - 成功: {result4['success']}")
            print(f"   - 记录数: {result4['records_count']}")
            if result4['error']:
                print(f"   - 错误: {result4['error']}")
            
            print("\n" + "=" * 60)
            print("测试 5: 同步一次测试数据（制程质量管理）")
            print("=" * 60)
            
            result5 = await ims_integration_service.sync_first_pass_test(
                db=db,
                start_date=test_date
            )
            
            print(f"✅ 测试完成")
            print(f"   - 成功: {result5['success']}")
            print(f"   - 记录数: {result5['records_count']}")
            if result5['error']:
                print(f"   - 错误: {result5['error']}")
            
            print("\n" + "=" * 60)
            print("测试 6: 同步制程不良记录（制程质量管理）")
            print("=" * 60)
            
            result6 = await ims_integration_service.sync_process_defects(
                db=db,
                start_date=test_date
            )
            
            print(f"✅ 测试完成")
            print(f"   - 成功: {result6['success']}")
            print(f"   - 记录数: {result6['records_count']}")
            print(f"   - 保存数: {result6.get('saved_count', 0)}")
            if result6['error']:
                print(f"   - 错误: {result6['error']}")
            
            print("\n" + "=" * 60)
            print("测试 7: 同步所有数据")
            print("=" * 60)
            
            result_all = await ims_integration_service.sync_all_data(
                db=db,
                target_date=test_date
            )
            
            print(f"✅ 测试完成")
            print(f"   - 整体成功: {result_all['overall_success']}")
            print(f"   - 入库检验: {result_all['incoming_inspection']['records_count']} 条")
            print(f"   - 成品产出: {result_all['production_output']['records_count']} 条")
            print(f"   - 制程测试: {result_all['process_test']['records_count']} 条")
            print(f"   - 成品入库（新）: {result_all['sync_production_output']['records_count']} 条")
            print(f"   - 一次测试（新）: {result_all['sync_first_pass_test']['records_count']} 条")
            print(f"   - 制程不良（新）: {result_all['sync_process_defects']['records_count']} 条")
            
            print("\n" + "=" * 60)
            print("测试 8: 查询同步历史")
            print("=" * 60)
            
            logs = await ims_integration_service.get_sync_history(
                db=db,
                sync_type=SyncType.INCOMING_INSPECTION,
                limit=5
            )
            
            print(f"✅ 查询到 {len(logs)} 条同步记录")
            for log in logs:
                status_icon = "✅" if log.is_successful() else "❌"
                print(f"   {status_icon} {log.sync_date} - {log.status} - {log.records_count} 条")
            
            print("\n" + "=" * 60)
            print("🎉 所有测试完成")
            print("=" * 60)
            
            # 打印配置提示
            if not settings.IMS_BASE_URL:
                print("\n💡 提示:")
                print("   要连接真实的 IMS 系统，请配置以下环境变量:")
                print("   - IMS_BASE_URL: IMS 系统的 API 地址")
                print("   - IMS_API_KEY: IMS API 密钥（可选）")
                print("   - IMS_TIMEOUT: 请求超时时间（默认30秒）")
            
        except Exception as e:
            print(f"\n❌ 测试失败: {str(e)}")
            import traceback
            traceback.print_exc()
        
        finally:
            await engine.dispose()


if __name__ == "__main__":
    # 运行测试
    asyncio.run(test_ims_integration())
