# Task 9.4: 质量数据 API 实现总结

## 实施日期
2026-02-13

## 任务概述
实现质量数据面板的 RESTful API 接口，提供仪表盘数据、指标趋势、下钻查询、Top5供应商清单、制程质量分析和客户质量分析功能。

## 实现的功能

### 1. API 端点

#### 1.1 GET /api/v1/quality-metrics/dashboard
**功能**: 获取仪表盘数据

**权限要求**: `quality.dashboard.read`

**特性**:
- 展示所有核心质量指标的当前值
- 支持目标值对比（红绿灯状态）
- 计算趋势（与前一天对比）
- 供应商用户仅查看关联数据

**响应数据**:
```json
{
  "date": "2026-02-13",
  "metrics": [
    {
      "metric_type": "incoming_batch_pass_rate",
      "metric_name": "来料批次合格率",
      "current_value": 98.5,
      "target_value": 99.0,
      "is_target_met": false,
      "status": "danger",
      "trend": "up",
      "change_percentage": 0.5
    }
  ],
  "summary": {
    "total_metrics": 7,
    "good_count": 5,
    "danger_count": 2
  }
}
```

#### 1.2 GET /api/v1/quality-metrics/trend
**功能**: 获取指标趋势

**权限要求**: `quality.metrics.read`

**查询参数**:
- `metric_type`: 指标类型（必填）
- `start_date`: 开始日期（必填）
- `end_date`: 结束日期（必填）
- `supplier_id`: 供应商ID（可选）
- `product_type`: 产品类型（可选）
- `line_id`: 产线ID（可选）
- `process_id`: 工序ID（可选）

**特性**:
- 支持时间范围筛选
- 支持多维度过滤
- 自动计算统计信息（平均值、最大值、最小值）
- 供应商用户自动过滤

#### 1.3 GET /api/v1/quality-metrics/drill-down
**功能**: 下钻查询（点击指标查看明细）

**权限要求**: `quality.metrics.read`

**查询参数**:
- `metric_type`: 指标类型（必填）
- `metric_date`: 指标日期（必填）
- `supplier_id`: 供应商ID（可选）
- `product_type`: 产品类型（可选）
- `line_id`: 产线ID（可选）
- `process_id`: 工序ID（可选）

**特性**:
- 查看指标明细数据
- 按不同维度分类统计
- 支持多层级下钻

#### 1.4 GET /api/v1/quality-metrics/top-suppliers
**功能**: 获取Top5供应商清单

**权限要求**: `quality.supplier-analysis.read`

**查询参数**:
- `metric_type`: 指标类型（必填，仅支持来料相关指标）
- `period`: 统计周期（daily/monthly/yearly）
- `target_date`: 目标日期（可选）

**特性**:
- 自动排序（PPM越小越好，合格率越大越好）
- 状态判断（good/warning/danger）
- 支持日/月/年统计

**响应数据**:
```json
{
  "metric_type": "material_online_ppm",
  "metric_name": "物料上线不良PPM",
  "period": "monthly",
  "date": "2026-02-13",
  "top_suppliers": [
    {
      "supplier_id": 1,
      "supplier_name": "供应商A",
      "metric_value": 85.5,
      "rank": 1,
      "status": "good"
    }
  ]
}
```

#### 1.5 GET /api/v1/quality-metrics/process-analysis
**功能**: 制程质量分析

**权限要求**: `quality.process-analysis.read`

**查询参数**:
- `start_date`: 开始日期（必填）
- `end_date`: 结束日期（必填）

**特性**:
- 按责任类别统计
- 按工序统计
- 按线体统计
- 月度趋势分析
- 趋势判断（improving/stable/worsening）

#### 1.6 GET /api/v1/quality-metrics/customer-analysis
**功能**: 客户质量分析

**权限要求**: `quality.customer-analysis.read`

**查询参数**:
- `start_date`: 开始日期（必填）
- `end_date`: 结束日期（必填）

**特性**:
- 按产品类型统计（0KM PPM、3MIS PPM、12MIS PPM）
- 月度趋势分析
- 严重度分布统计

## 文件结构

```
backend/
├── app/
│   ├── api/
│   │   └── v1/
│   │       ├── __init__.py (已更新，注册新路由)
│   │       └── quality_metrics.py (新建，质量数据API)
│   └── schemas/
│       └── quality_metric.py (新建，Pydantic模型)
└── scripts/
    └── test_quality_metrics_api.py (新建，测试脚本)
```

## 权限控制

所有接口都实现了细粒度权限控制：

1. **仪表盘**: `quality.dashboard.read`
2. **指标趋势**: `quality.metrics.read`
3. **下钻查询**: `quality.metrics.read`
4. **Top5供应商**: `quality.supplier-analysis.read`
5. **制程分析**: `quality.process-analysis.read`
6. **客户分析**: `quality.customer-analysis.read`

## 数据隔离

- **内部员工**: 查看所有数据
- **供应商用户**: 仅查看关联到自己的数据（自动过滤 `supplier_id`）

## 技术实现

### 1. 依赖项
- FastAPI: API 框架
- SQLAlchemy: ORM 和数据库查询
- Pydantic: 数据校验和序列化
- 权限引擎: 细粒度权限检查

### 2. 核心逻辑
- 使用 `metrics_calculator` 服务获取计算后的指标数据
- 支持多维度聚合查询（按供应商、产品类型、产线、工序）
- 自动计算趋势和统计信息
- 实现红绿灯状态判断

### 3. 性能优化
- 使用索引优化查询（metric_type, metric_date, supplier_id）
- 支持分页（预留）
- 缓存机制（预留）

## 测试

### 测试脚本
`backend/scripts/test_quality_metrics_api.py`

**测试内容**:
1. 创建测试数据（供应商、用户、权限、指标）
2. 测试仪表盘API
3. 测试趋势API

**运行方式**:
```bash
cd backend
python scripts/test_quality_metrics_api.py
```

## API 文档

启动服务后访问：
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

所有接口都包含详细的文档说明和示例。

## 下一步

1. **前端集成**: 创建 Vue 组件调用这些 API
2. **数据可视化**: 使用 ECharts 实现图表展示
3. **实时更新**: 考虑使用 WebSocket 推送实时数据
4. **性能优化**: 添加 Redis 缓存层
5. **导出功能**: 实现 Excel/PDF 导出

## 需求对应

- ✅ Requirements 2.4.2: 数据可视化展示
- ✅ Requirements 2.4.3: 专项数据分析
- ✅ 权限控制：用户只能查看被授权的指标
- ✅ 数据隔离：供应商仅查看关联数据

## 注意事项

1. **权限配置**: 管理员需要为用户配置相应的权限才能访问接口
2. **数据准备**: 需要先运行 IMS 同步任务和指标计算任务生成数据
3. **供应商过滤**: 供应商用户的 `supplier_id` 必须正确设置
4. **日期范围**: 建议限制查询的日期范围，避免性能问题

## 完成状态

✅ 所有 API 端点已实现
✅ 权限控制已集成
✅ 数据隔离已实现
✅ Pydantic 模型已定义
✅ 路由已注册
✅ 测试脚本已创建
✅ 文档已完善

Task 9.4 实现完成！
