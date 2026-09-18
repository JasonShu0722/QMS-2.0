# AI 智能诊断服务实现文档

## 概述

本文档描述 Task 9.5 - AI 智能诊断服务的实现细节。该服务集成 OpenAI API（兼容 DeepSeek 等）实现质量数据的智能分析和自然语言查询功能。

## 实现的功能

### 1. 异常自动寻源 (Anomaly Diagnosis)

**功能描述：**
当监控到某项质量指标突发飙升时，AI 自动触发分析，寻找强相关性因子。

**API 端点：**
```
POST /api/v1/ai/diagnose
```

**请求示例：**
```json
{
  "metric_type": "material_online_ppm",
  "metric_date": "2024-01-15",
  "current_value": 850.5,
  "historical_avg": 320.0,
  "supplier_id": 1,
  "product_type": "MCU"
}
```

**响应示例：**
```json
{
  "anomaly_detected": true,
  "severity": "high",
  "change_percentage": 165.78,
  "root_causes": [
    "供应商来料批次质量波动",
    "检验标准执行不严格",
    "物料存储环境异常"
  ],
  "recommendations": [
    "立即对该供应商进行驻厂审核",
    "加强来料检验抽样频率",
    "检查仓库温湿度记录"
  ],
  "related_indicators": [
    "来料批次合格率",
    "制程不合格率"
  ],
  "context": {
    "metric_type": "material_online_ppm",
    "metric_date": "2024-01-15",
    "current_value": 850.5,
    "historical_avg": 320.0,
    "change_percentage": 165.78,
    "supplier_name": "供应商A",
    "product_type": "MCU",
    "related_metrics": [...],
    "historical_trend": [...]
  }
}
```

**分析逻辑：**
1. 计算异常程度（变化百分比）
2. 判断严重程度（low/medium/high）
3. 查询相关数据：
   - 同日期其他指标
   - 过去7天历史趋势
   - 供应商信息
4. 调用 AI 进行根本原因分析
5. 生成改善建议

### 2. 自然语言查询 (Natural Language Query)

**功能描述：**
用户可以用自然语言提问，AI 自动转化为 SQL 查询数据库并返回数据详情以及图表。

**API 端点：**
```
POST /api/v1/ai/query
```

**请求示例：**
```json
{
  "question": "帮我把过去三个月MCU产品的0KM不良率趋势画成折线图，并对比一下去年同期的数据"
}
```

**响应示例：**
```json
{
  "success": true,
  "understood_query": "查询过去三个月MCU产品的0KM不良率趋势",
  "sql_query": "SELECT metric_date, value FROM quality_metrics WHERE metric_type='okm_ppm' AND product_type='MCU' AND metric_date >= '2024-10-01' ORDER BY metric_date",
  "data": [
    {"metric_date": "2024-10-01", "value": 120.5},
    {"metric_date": "2024-11-01", "value": 98.3},
    {"metric_date": "2024-12-01", "value": 85.7}
  ],
  "chart_type": "line",
  "explanation": "数据显示MCU产品的0KM不良率呈下降趋势，从120.5 PPM降至85.7 PPM",
  "row_count": 3
}
```

**查询流程：**
1. AI 理解用户自然语言问题
2. 生成对应的 SQL 查询语句
3. 安全检查（仅允许 SELECT 查询）
4. 执行 SQL 查询
5. 返回结构化数据和图表建议
6. 提供结果解释

**安全限制：**
- 仅支持 SELECT 查询
- 不允许 UPDATE/DELETE/INSERT 操作
- SQL 注入防护

### 3. 生成趋势图表 (Generate Trend Chart)

**功能描述：**
根据用户描述自动生成 ECharts 图表配置。

**API 端点：**
```
POST /api/v1/ai/generate-chart
```

**请求示例：**
```json
{
  "description": "生成一个折线图，展示过去7天的制程不合格率趋势",
  "data": [
    {"date": "2024-01-08", "value": 2.5},
    {"date": "2024-01-09", "value": 2.3},
    {"date": "2024-01-10", "value": 2.8}
  ]
}
```

**响应示例：**
```json
{
  "success": true,
  "chart_type": "line",
  "echarts_config": {
    "title": {"text": "制程不合格率趋势"},
    "tooltip": {"trigger": "axis"},
    "xAxis": {
      "type": "category",
      "data": ["2024-01-08", "2024-01-09", "2024-01-10"]
    },
    "yAxis": {
      "type": "value",
      "name": "不合格率(%)"
    },
    "series": [{
      "type": "line",
      "data": [2.5, 2.3, 2.8]
    }]
  },
  "description": "展示过去7天的制程不合格率变化趋势"
}
```

## 技术实现

### 核心服务类

**文件：** `backend/app/services/ai_analysis_service.py`

**主要方法：**

1. `analyze_anomaly()` - 异常自动寻源
2. `natural_language_query()` - 自然语言查询
3. `generate_trend_chart()` - 生成图表配置

### API 路由

**文件：** `backend/app/api/v1/ai.py`

**端点：**
- `POST /api/v1/ai/diagnose` - 异常诊断
- `POST /api/v1/ai/query` - 自然语言查询
- `POST /api/v1/ai/generate-chart` - 生成图表

### 数据模型

**文件：** `backend/app/schemas/ai_analysis.py`

**模型：**
- `AnomalyDiagnoseRequest` / `AnomalyDiagnoseResponse`
- `NaturalLanguageQueryRequest` / `NaturalLanguageQueryResponse`
- `ChartGenerationRequest` / `ChartGenerationResponse`

## 配置说明

### 环境变量

在 `.env` 文件中配置：

```bash
# OpenAI API 配置
OPENAI_API_KEY=your_openai_api_key
OPENAI_BASE_URL=https://api.openai.com/v1
```

**支持的 API 提供商：**
- OpenAI (默认)
- DeepSeek (设置 `OPENAI_BASE_URL=https://api.deepseek.com/v1`)
- 其他兼容 OpenAI API 的服务

### 权限配置

需要配置以下权限：

1. `quality.ai-diagnose.read` - 异常诊断权限
2. `quality.ai-query.read` - 自然语言查询权限
3. `quality.ai-chart.read` - 图表生成权限

## 使用示例

### 1. 异常诊断

```python
import httpx

async def diagnose_anomaly():
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "http://localhost:8000/api/v1/ai/diagnose",
            json={
                "metric_type": "material_online_ppm",
                "metric_date": "2024-01-15",
                "current_value": 850.5,
                "historical_avg": 320.0,
                "supplier_id": 1,
                "product_type": "MCU"
            },
            headers={"Authorization": f"Bearer {token}"}
        )
        return response.json()
```

### 2. 自然语言查询

```python
async def natural_language_query():
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "http://localhost:8000/api/v1/ai/query",
            json={
                "question": "查询上个月来料批次合格率最低的5个供应商"
            },
            headers={"Authorization": f"Bearer {token}"}
        )
        return response.json()
```

### 3. 生成图表

```python
async def generate_chart():
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "http://localhost:8000/api/v1/ai/generate-chart",
            json={
                "description": "生成一个柱状图，展示各供应商的不良率对比",
                "data": [
                    {"supplier": "供应商A", "ppm": 120},
                    {"supplier": "供应商B", "ppm": 85},
                    {"supplier": "供应商C", "ppm": 200}
                ]
            },
            headers={"Authorization": f"Bearer {token}"}
        )
        return response.json()
```

## 前端集成

### Vue 3 组件示例

```vue
<template>
  <div class="ai-assistant">
    <!-- AI 对话框 -->
    <el-card class="ai-chat-box">
      <template #header>
        <span>AI 智能助手</span>
      </template>
      
      <div class="chat-messages">
        <div v-for="msg in messages" :key="msg.id" :class="['message', msg.type]">
          <div class="message-content">{{ msg.content }}</div>
        </div>
      </div>
      
      <el-input
        v-model="userInput"
        placeholder="输入您的问题..."
        @keyup.enter="sendQuery"
      >
        <template #append>
          <el-button @click="sendQuery" :loading="loading">
            发送
          </el-button>
        </template>
      </el-input>
    </el-card>
    
    <!-- 图表展示 -->
    <el-card v-if="chartConfig" class="chart-display">
      <div ref="chartRef" style="width: 100%; height: 400px;"></div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import * as echarts from 'echarts'
import { aiApi } from '@/api/ai'

const userInput = ref('')
const messages = ref([])
const loading = ref(false)
const chartConfig = ref(null)
const chartRef = ref(null)
let chartInstance = null

async function sendQuery() {
  if (!userInput.value.trim()) return
  
  // 添加用户消息
  messages.value.push({
    id: Date.now(),
    type: 'user',
    content: userInput.value
  })
  
  const question = userInput.value
  userInput.value = ''
  loading.value = true
  
  try {
    // 调用自然语言查询 API
    const response = await aiApi.query({ question })
    
    if (response.success) {
      // 添加 AI 响应
      messages.value.push({
        id: Date.now(),
        type: 'ai',
        content: response.explanation
      })
      
      // 如果有数据，生成图表
      if (response.data && response.data.length > 0) {
        const chartResponse = await aiApi.generateChart({
          description: question,
          data: response.data
        })
        
        if (chartResponse.success) {
          chartConfig.value = chartResponse.echarts_config
        }
      }
    } else {
      messages.value.push({
        id: Date.now(),
        type: 'error',
        content: response.error || '查询失败'
      })
    }
  } catch (error) {
    messages.value.push({
      id: Date.now(),
      type: 'error',
      content: '网络错误，请稍后重试'
    })
  } finally {
    loading.value = false
  }
}

// 监听图表配置变化，渲染图表
watch(chartConfig, (newConfig) => {
  if (newConfig && chartRef.value) {
    if (!chartInstance) {
      chartInstance = echarts.init(chartRef.value)
    }
    chartInstance.setOption(newConfig)
  }
})
</script>
```

## 测试

### 单元测试

创建测试文件 `backend/tests/test_ai_service.py`：

```python
import pytest
from app.services.ai_analysis_service import ai_analysis_service

@pytest.mark.asyncio
async def test_analyze_anomaly(db_session):
    """测试异常诊断功能"""
    result = await ai_analysis_service.analyze_anomaly(
        db=db_session,
        metric_type="material_online_ppm",
        metric_date="2024-01-15",
        current_value=850.5,
        historical_avg=320.0,
        supplier_id=1,
        product_type="MCU"
    )
    
    assert result["anomaly_detected"] is True
    assert "severity" in result
    assert "root_causes" in result
    assert "recommendations" in result

@pytest.mark.asyncio
async def test_natural_language_query(db_session):
    """测试自然语言查询功能"""
    result = await ai_analysis_service.natural_language_query(
        db=db_session,
        user_question="查询上个月的来料批次合格率"
    )
    
    assert result["success"] is True
    assert "sql_query" in result
    assert "data" in result
```

## 注意事项

1. **API 密钥安全：**
   - 不要将 API 密钥提交到版本控制
   - 使用环境变量管理敏感信息
   - 定期轮换 API 密钥

2. **成本控制：**
   - 监控 API 调用次数
   - 设置合理的 token 限制
   - 考虑使用缓存减少重复查询

3. **错误处理：**
   - AI 服务可能不可用，需要优雅降级
   - SQL 查询可能失败，需要捕获异常
   - 用户输入需要验证和清理

4. **性能优化：**
   - 异步调用 AI API
   - 缓存常见查询结果
   - 限制查询结果数量

## 依赖项

新增依赖：
```
openai==1.58.1
```

已在 `requirements.txt` 中添加。

## Requirements 映射

本实现满足以下需求：

- **Requirements 2.4.4** - AI 智能诊断与辅助决策
  - ✅ 异常自动寻源
  - ✅ 自然语言查询
  - ✅ 根据用户描述生成图表

## 总结

AI 智能诊断服务已完整实现，包括：

1. ✅ AIAnalysisService 类（集成 OpenAI API / DeepSeek）
2. ✅ analyze_anomaly() 异常自动寻源
3. ✅ natural_language_query() 自然语言查询
4. ✅ generate_trend_chart() 根据用户描述生成图表
5. ✅ POST /api/v1/ai/diagnose 异常诊断接口
6. ✅ POST /api/v1/ai/query 自然语言查询接口
7. ✅ POST /api/v1/ai/generate-chart 图表生成接口

所有功能已实现并集成到系统中，可以通过配置 OpenAI API 密钥启用。
