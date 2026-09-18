"""
AI 智能诊断服务测试脚本
用于验证 AI 服务的基本功能
"""
import asyncio
from datetime import date

# 测试服务导入
def test_imports():
    """测试模块导入"""
    print("=== 测试模块导入 ===")
    
    try:
        from app.services.ai_analysis_service import ai_analysis_service
        print("✓ AI 服务导入成功")
    except Exception as e:
        print(f"✗ AI 服务导入失败: {e}")
        return False
    
    try:
        from app.schemas.ai_analysis import (
            AnomalyDiagnoseRequest,
            AnomalyDiagnoseResponse,
            NaturalLanguageQueryRequest,
            NaturalLanguageQueryResponse,
            ChartGenerationRequest,
            ChartGenerationResponse
        )
        print("✓ AI 数据模型导入成功")
    except Exception as e:
        print(f"✗ AI 数据模型导入失败: {e}")
        return False
    
    try:
        from app.api.v1 import ai
        print("✓ AI API 路由导入成功")
        print(f"  - 路由前缀: {ai.router.prefix}")
        print(f"  - 路由数量: {len(ai.router.routes)}")
    except Exception as e:
        print(f"✗ AI API 路由导入失败: {e}")
        return False
    
    return True


def test_service_initialization():
    """测试服务初始化"""
    print("\n=== 测试服务初始化 ===")
    
    try:
        from app.services.ai_analysis_service import ai_analysis_service
        
        if ai_analysis_service._is_available():
            print("✓ AI 服务已配置并可用")
            print("  - OpenAI API 密钥已配置")
        else:
            print("⚠ AI 服务未配置（需要配置 OPENAI_API_KEY）")
            print("  - 这是正常的，配置后即可使用")
        
        return True
    except Exception as e:
        print(f"✗ 服务初始化失败: {e}")
        return False


def test_data_models():
    """测试数据模型"""
    print("\n=== 测试数据模型 ===")
    
    try:
        from app.schemas.ai_analysis import (
            AnomalyDiagnoseRequest,
            NaturalLanguageQueryRequest,
            ChartGenerationRequest
        )
        
        # 测试异常诊断请求模型
        diagnose_req = AnomalyDiagnoseRequest(
            metric_type="material_online_ppm",
            metric_date=date(2024, 1, 15),
            current_value=850.5,
            historical_avg=320.0,
            supplier_id=1,
            product_type="MCU"
        )
        print("✓ AnomalyDiagnoseRequest 模型验证通过")
        
        # 测试自然语言查询请求模型
        query_req = NaturalLanguageQueryRequest(
            question="查询上个月来料批次合格率最低的5个供应商"
        )
        print("✓ NaturalLanguageQueryRequest 模型验证通过")
        
        # 测试图表生成请求模型
        chart_req = ChartGenerationRequest(
            description="生成一个折线图，展示过去7天的制程不合格率趋势",
            data=[
                {"date": "2024-01-08", "value": 2.5},
                {"date": "2024-01-09", "value": 2.3}
            ]
        )
        print("✓ ChartGenerationRequest 模型验证通过")
        
        return True
    except Exception as e:
        print(f"✗ 数据模型测试失败: {e}")
        return False


def test_api_routes():
    """测试 API 路由"""
    print("\n=== 测试 API 路由 ===")
    
    try:
        from app.api.v1 import ai
        
        routes = ai.router.routes
        expected_routes = [
            "/diagnose",
            "/query",
            "/generate-chart"
        ]
        
        route_paths = [route.path for route in routes]
        
        for expected in expected_routes:
            if expected in route_paths:
                print(f"✓ 路由 {expected} 已注册")
            else:
                print(f"✗ 路由 {expected} 未找到")
                return False
        
        return True
    except Exception as e:
        print(f"✗ API 路由测试失败: {e}")
        return False


def main():
    """运行所有测试"""
    print("=" * 60)
    print("AI 智能诊断服务测试")
    print("=" * 60)
    
    results = []
    
    # 运行测试
    results.append(("模块导入", test_imports()))
    results.append(("服务初始化", test_service_initialization()))
    results.append(("数据模型", test_data_models()))
    results.append(("API 路由", test_api_routes()))
    
    # 输出总结
    print("\n" + "=" * 60)
    print("测试总结")
    print("=" * 60)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for name, result in results:
        status = "✓ 通过" if result else "✗ 失败"
        print(f"{name}: {status}")
    
    print(f"\n总计: {passed}/{total} 测试通过")
    
    if passed == total:
        print("\n🎉 所有测试通过！AI 服务已准备就绪。")
        print("\n下一步:")
        print("1. 配置 OPENAI_API_KEY 环境变量")
        print("2. 启动 FastAPI 服务: uvicorn app.main:app --reload")
        print("3. 访问 API 文档: http://localhost:8000/docs")
        print("4. 测试 AI 接口")
    else:
        print("\n⚠ 部分测试失败，请检查错误信息。")
    
    return passed == total


if __name__ == "__main__":
    import sys
    sys.path.insert(0, ".")
    
    success = main()
    sys.exit(0 if success else 1)
