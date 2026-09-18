# AI 智能诊断服务快速开始指南

## 快速配置

### 1. 安装依赖

```bash
cd backend
pip install -r requirements.txt
```

### 2. 配置 API 密钥

编辑 `.env` 文件：

```bash
# 使用 OpenAI
OPENAI_API_KEY=sk-your-openai-api-key
OPENAI_BASE_URL=https://api.openai.com/v1

# 或使用 DeepSeek（更便宜）
OPENAI_API_KEY=sk-your-deepseek-api-key
OPENAI_BASE_URL=https://api.deepseek.com/v1
```

### 3. 启动服务

```bash
uvicorn app.main:app --reload
```

## 快速测试

### 测试脚本

创建 `test_ai_api.py`：

```python
import asyncio
import httpx
from datetime import date

# 配置
BASE_URL = "http://localhost:8000"
TOKEN = "your_jwt_token_here"  # 从登录接口获取

headers = {
    "Authorization": f"Bearer {TOKEN}",
    "Content-Type": "application/json"
}

async def test_diagnose():
    """测试异常诊断"""
    print("\n=== 测试异常诊断 ===")
    
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{BASE_URL}/api/v1/ai/diagnose",
            json={
                "metric_type": "material_online_ppm",
                "metric_date": "2024-01-15",
                "current_value": 850.5,
                "historical_avg": 320.0,
                "supplier_id": 1,
                "product_type": "MCU"
            },
            headers=headers,
            timeout=30.0
        )
        
        print(f"状态码: {response.status_code}")
        result = response.json()
        
        if result.get("anomaly_detected"):
            print(f"严重程度: {result['severity']}")
            print(f"变化幅度: {result['change_percentage']:.2f}%")
            print("\n可能原因:")
            for cause in result.get("root_causes", []):
                print(f"  - {cause}")
            print("\n建议措施:")
            for rec in result.get("recommendations", []):
                print(f"  - {rec}")
        else:
            print(f"错误: {result.get('error', '未知错误')}")

async def test_query():
    """测试自然语言查询"""
    print("\n=== 测试自然语言查询 ===")
    
    questions = [
        "查询上个月来料批次合格率最低的5个供应商",
        "帮我把过去三个月MCU产品的0KM不良率趋势画成折线图",
        "对比今年和去年同期的制程不合格率"
    ]
    
    async with httpx.AsyncClient() as client:
        for question in questions:
            print(f"\n问题: {question}")
            
            response = await client.post(
                f"{BASE_URL}/api/v1/ai/query",
                json={"question": question},
                headers=headers,
                timeout=30.0
            )
            
            result = response.json()
            
            if result.get("success"):
                print(f"理解: {result['understood_query']}")
                print(f"SQL: {result['sql_query']}")
                print(f"图表类型: {result['chart_type']}")
                print(f"返回行数: {result['row_count']}")
                print(f"解释: {result['explanation']}")
            else:
                print(f"错误: {result.get('error', '未知错误')}")

async def test_chart():
    """测试图表生成"""
    print("\n=== 测试图表生成 ===")
    
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{BASE_URL}/api/v1/ai/generate-chart",
            json={
                "description": "生成一个折线图，展示过去7天的制程不合格率趋势",
                "data": [
                    {"date": "2024-01-08", "value": 2.5},
                    {"date": "2024-01-09", "value": 2.3},
                    {"date": "2024-01-10", "value": 2.8},
                    {"date": "2024-01-11", "value": 2.1},
                    {"date": "2024-01-12", "value": 2.4},
                    {"date": "2024-01-13", "value": 2.6},
                    {"date": "2024-01-14", "value": 2.2}
                ]
            },
            headers=headers,
            timeout=30.0
        )
        
        result = response.json()
        
        if result.get("success"):
            print(f"图表类型: {result['chart_type']}")
            print(f"说明: {result['description']}")
            print("\nECharts 配置:")
            import json
            print(json.dumps(result['echarts_config'], indent=2, ensure_ascii=False))
        else:
            print(f"错误: {result.get('error', '未知错误')}")

async def main():
    """运行所有测试"""
    try:
        await test_diagnose()
        await test_query()
        await test_chart()
    except Exception as e:
        print(f"\n测试失败: {str(e)}")

if __name__ == "__main__":
    asyncio.run(main())
```

### 运行测试

```bash
python test_ai_api.py
```

## 使用 curl 测试

### 1. 获取 Token

```bash
curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "your_password",
    "user_type": "internal"
  }'
```

### 2. 测试异常诊断

```bash
curl -X POST http://localhost:8000/api/v1/ai/diagnose \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "metric_type": "material_online_ppm",
    "metric_date": "2024-01-15",
    "current_value": 850.5,
    "historical_avg": 320.0,
    "supplier_id": 1,
    "product_type": "MCU"
  }'
```

### 3. 测试自然语言查询

```bash
curl -X POST http://localhost:8000/api/v1/ai/query \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "question": "查询上个月来料批次合格率最低的5个供应商"
  }'
```

### 4. 测试图表生成

```bash
curl -X POST http://localhost:8000/api/v1/ai/generate-chart \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "生成一个折线图，展示过去7天的制程不合格率趋势",
    "data": [
      {"date": "2024-01-08", "value": 2.5},
      {"date": "2024-01-09", "value": 2.3},
      {"date": "2024-01-10", "value": 2.8}
    ]
  }'
```

## API 文档

启动服务后，访问：

- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

在文档中可以找到 "AI智能诊断" 标签下的所有接口。

## 常见问题

### 1. AI 服务不可用

**错误信息：** `"error": "AI 服务未配置或不可用"`

**解决方法：**
- 检查 `.env` 文件中是否配置了 `OPENAI_API_KEY`
- 确认 API 密钥有效
- 检查网络连接

### 2. 权限不足

**错误信息：** `"detail": "权限不足：需要 'quality.ai-diagnose.read' 权限"`

**解决方法：**
- 使用管理员账号登录
- 在权限管理界面为用户分配相应权限：
  - `quality.ai-diagnose.read`
  - `quality.ai-query.read`
  - `quality.ai-chart.read`

### 3. SQL 查询失败

**错误信息：** `"error": "查询执行失败: ..."`

**解决方法：**
- 检查数据库连接
- 确认表结构正确
- 查看生成的 SQL 语句是否有语法错误

### 4. API 调用超时

**解决方法：**
- 增加超时时间（默认 30 秒）
- 检查 OpenAI API 服务状态
- 考虑使用更快的模型（如 gpt-4o-mini）

## 成本估算

使用 OpenAI gpt-4o-mini 模型：

- 输入：$0.150 / 1M tokens
- 输出：$0.600 / 1M tokens

每次查询大约消耗：
- 异常诊断：500-1000 tokens
- 自然语言查询：300-800 tokens
- 图表生成：400-1000 tokens

月度成本估算（假设每天 100 次查询）：
- 约 $5-15 / 月

使用 DeepSeek 可以降低成本约 90%。

## 下一步

1. 配置权限系统
2. 集成到前端界面
3. 添加缓存机制
4. 监控 API 使用情况
5. 优化提示词（Prompt）

## 相关文档

- [完整实现文档](./AI_ANALYSIS_SERVICE_IMPLEMENTATION.md)
- [API 参考](http://localhost:8000/docs)
- [OpenAI API 文档](https://platform.openai.com/docs)
- [DeepSeek API 文档](https://platform.deepseek.com/docs)
