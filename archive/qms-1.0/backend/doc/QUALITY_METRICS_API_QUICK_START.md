# 质量数据 API 快速入门

## 概述

质量数据 API 提供了完整的质量指标查询和分析功能，支持仪表盘展示、趋势分析、下钻查询等。

## 前置条件

1. **数据准备**: 确保已运行 IMS 同步任务和指标计算任务
2. **权限配置**: 用户需要相应的权限才能访问接口
3. **认证**: 所有接口都需要 JWT Token 认证

## 认证方式

在请求头中添加 Bearer Token：

```bash
Authorization: Bearer <your_jwt_token>
```

## API 端点列表

### 1. 仪表盘数据

**端点**: `GET /api/v1/quality-metrics/dashboard`

**权限**: `quality.dashboard.read`

**示例请求**:
```bash
curl -X GET "http://localhost:8000/api/v1/quality-metrics/dashboard?target_date=2026-02-13" \
  -H "Authorization: Bearer <token>"
```

**使用场景**: 首页仪表盘展示所有核心指标

---

### 2. 指标趋势

**端点**: `GET /api/v1/quality-metrics/trend`

**权限**: `quality.metrics.read`

**示例请求**:
```bash
curl -X GET "http://localhost:8000/api/v1/quality-metrics/trend?metric_type=incoming_batch_pass_rate&start_date=2026-02-01&end_date=2026-02-13&supplier_id=1" \
  -H "Authorization: Bearer <token>"
```

**使用场景**: 查看某个指标的历史趋势图

---

### 3. 下钻查询

**端点**: `GET /api/v1/quality-metrics/drill-down`

**权限**: `quality.metrics.read`

**示例请求**:
```bash
curl -X GET "http://localhost:8000/api/v1/quality-metrics/drill-down?metric_type=process_defect_rate&metric_date=2026-02-13&line_id=LINE001" \
  -H "Authorization: Bearer <token>"
```

**使用场景**: 点击仪表盘指标查看详细数据

---

### 4. Top5 供应商清单

**端点**: `GET /api/v1/quality-metrics/top-suppliers`

**权限**: `quality.supplier-analysis.read`

**示例请求**:
```bash
curl -X GET "http://localhost:8000/api/v1/quality-metrics/top-suppliers?metric_type=material_online_ppm&period=monthly&target_date=2026-02-13" \
  -H "Authorization: Bearer <token>"
```

**使用场景**: 供应商质量排名分析

---

### 5. 制程质量分析

**端点**: `GET /api/v1/quality-metrics/process-analysis`

**权限**: `quality.process-analysis.read`

**示例请求**:
```bash
curl -X GET "http://localhost:8000/api/v1/quality-metrics/process-analysis?start_date=2026-02-01&end_date=2026-02-13" \
  -H "Authorization: Bearer <token>"
```

**使用场景**: 制程质量专项分析报告

---

### 6. 客户质量分析

**端点**: `GET /api/v1/quality-metrics/customer-analysis`

**权限**: `quality.customer-analysis.read`

**示例请求**:
```bash
curl -X GET "http://localhost:8000/api/v1/quality-metrics/customer-analysis?start_date=2026-02-01&end_date=2026-02-13" \
  -H "Authorization: Bearer <token>"
```

**使用场景**: 客户质量专项分析报告

---

## 指标类型

| 指标类型 | 说明 |
|---------|------|
| `incoming_batch_pass_rate` | 来料批次合格率 |
| `material_online_ppm` | 物料上线不良PPM |
| `process_defect_rate` | 制程不合格率 |
| `process_fpy` | 制程直通率 |
| `okm_ppm` | 0KM不良PPM |
| `mis_3_ppm` | 3MIS售后不良PPM |
| `mis_12_ppm` | 12MIS售后不良PPM |

## 权限配置

管理员需要为用户配置以下权限：

```python
# 仪表盘权限
Permission(
    user_id=user_id,
    module_path="quality.dashboard",
    operation_type=OperationType.READ,
    is_granted=True
)

# 指标查询权限
Permission(
    user_id=user_id,
    module_path="quality.metrics",
    operation_type=OperationType.READ,
    is_granted=True
)

# 供应商分析权限
Permission(
    user_id=user_id,
    module_path="quality.supplier-analysis",
    operation_type=OperationType.READ,
    is_granted=True
)

# 制程分析权限
Permission(
    user_id=user_id,
    module_path="quality.process-analysis",
    operation_type=OperationType.READ,
    is_granted=True
)

# 客户分析权限
Permission(
    user_id=user_id,
    module_path="quality.customer-analysis",
    operation_type=OperationType.READ,
    is_granted=True
)
```

## 数据隔离

- **内部员工**: 可以查看所有数据
- **供应商用户**: 仅能查看关联到自己的数据（系统自动过滤）

## 错误处理

### 常见错误

1. **403 Forbidden**: 权限不足
   - 解决方案: 联系管理员配置权限

2. **404 Not Found**: 数据不存在
   - 解决方案: 检查日期范围和筛选条件

3. **400 Bad Request**: 参数错误
   - 解决方案: 检查请求参数格式

4. **401 Unauthorized**: 未认证
   - 解决方案: 检查 Token 是否有效

## 前端集成示例

### Vue 3 + Axios

```typescript
// api/qualityMetrics.ts
import axios from 'axios';

const API_BASE_URL = '/api/v1/quality-metrics';

export const qualityMetricsApi = {
  // 获取仪表盘数据
  async getDashboard(targetDate?: string) {
    const response = await axios.get(`${API_BASE_URL}/dashboard`, {
      params: { target_date: targetDate }
    });
    return response.data;
  },

  // 获取指标趋势
  async getTrend(params: {
    metric_type: string;
    start_date: string;
    end_date: string;
    supplier_id?: number;
    product_type?: string;
  }) {
    const response = await axios.get(`${API_BASE_URL}/trend`, { params });
    return response.data;
  },

  // 获取Top5供应商
  async getTopSuppliers(params: {
    metric_type: string;
    period: string;
    target_date?: string;
  }) {
    const response = await axios.get(`${API_BASE_URL}/top-suppliers`, { params });
    return response.data;
  }
};
```

### 使用示例

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { qualityMetricsApi } from '@/api/qualityMetrics';

const dashboardData = ref(null);

onMounted(async () => {
  try {
    dashboardData.value = await qualityMetricsApi.getDashboard();
  } catch (error) {
    console.error('Failed to load dashboard:', error);
  }
});
</script>

<template>
  <div v-if="dashboardData">
    <div v-for="metric in dashboardData.metrics" :key="metric.metric_type">
      <h3>{{ metric.metric_name }}</h3>
      <p>当前值: {{ metric.current_value }}</p>
      <p>目标值: {{ metric.target_value }}</p>
      <p>状态: {{ metric.status }}</p>
    </div>
  </div>
</template>
```

## 性能建议

1. **日期范围**: 建议限制在 3 个月以内
2. **缓存**: 前端可以缓存仪表盘数据 5 分钟
3. **分页**: 对于大量数据，考虑使用分页
4. **按需加载**: 使用懒加载策略加载图表数据

## 测试

使用提供的测试脚本验证 API：

```bash
cd backend
python scripts/test_quality_metrics_api.py
```

## 文档

完整的 API 文档：
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## 支持

如有问题，请查看：
- `backend/TASK_9.4_QUALITY_METRICS_API_SUMMARY.md` - 详细实现说明
- `backend/app/api/v1/quality_metrics.py` - 源代码
- `backend/app/schemas/quality_metric.py` - 数据模型
