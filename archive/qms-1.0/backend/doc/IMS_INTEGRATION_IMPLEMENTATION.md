# IMS 数据集成服务实现文档

## 概述

本文档描述 IMS (Internal Management System) 数据集成服务的实现细节，包括服务架构、API 接口、定时任务配置和使用方法。

## 实现的功能

### ✅ 已完成

1. **IMSIntegrationService 类** (`app/services/ims_integration_service.py`)
   - 使用 HTTPX 异步客户端与 IMS 系统通信
   - 支持三种核心数据类型的拉取：
     - 入库检验数据 (Incoming Inspection)
     - 成品产出数据 (Production Output)
     - 制程测试数据 (Process Test)
   - 实现错误处理和自动重试机制（指数退避策略）
   - 记录详细的同步日志到数据库

2. **Celery 定时任务配置** (`app/core/celery_app.py`)
   - 配置 Celery 应用实例
   - 设置定时任务调度（每日凌晨 02:00）
   - 配置任务队列和路由规则

3. **定时任务实现** (`app/tasks/ims_sync_tasks.py`)
   - `sync_ims_data_daily`: 每日自动同步任务
   - `sync_ims_data_manual`: 手动触发同步任务（用于补录历史数据）
   - 支持异步数据库操作
   - 实现任务失败自动重试（最多3次）

## 架构设计

### 数据流向

```
┌─────────────────┐
│   IMS System    │
│  (内部管理系统)  │
└────────┬────────┘
         │ HTTP API
         │ (HTTPX Client)
         ▼
┌─────────────────────────┐
│ IMSIntegrationService   │
│ - fetch_incoming_*()    │
│ - fetch_production_*()  │
│ - fetch_process_test_*()│
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│   PostgreSQL Database   │
│ - quality_metrics       │
│ - ims_sync_logs         │
└─────────────────────────┘
         ▲
         │
┌────────┴────────────────┐
│   Celery Beat Scheduler │
│ (每日凌晨 02:00 触发)    │
└─────────────────────────┘
```

### 重试机制

采用指数退避策略（Exponential Backoff）：
- 第1次失败：等待 2 秒后重试
- 第2次失败：等待 4 秒后重试
- 第3次失败：等待 8 秒后重试
- 超过3次：记录错误日志，任务失败

## 配置说明

### 环境变量配置

在 `.env` 文件中添加以下配置：

```bash
# IMS 系统集成配置
IMS_BASE_URL=http://ims.company.com/api
IMS_API_KEY=your-ims-api-key-here
IMS_TIMEOUT=30

# Celery 任务队列配置
CELERY_BROKER_URL=redis://redis:6379/0
CELERY_RESULT_BACKEND=redis://redis:6379/0
```

### IMS API 端点约定

服务假设 IMS 系统提供以下 RESTful API 端点：

1. **入库检验数据**
   ```
   GET /api/quality/incoming-inspection
   Query Parameters:
     - start_date: YYYY-MM-DD
     - end_date: YYYY-MM-DD
   Response:
     {
       "data": [
         {
           "material_code": "M001",
           "batch_number": "B20240101",
           "inspection_result": "OK" | "NG",
           "defect_description": "...",
           "defect_qty": 10,
           "supplier_id": 1,
           ...
         }
       ]
     }
   ```

2. **成品产出数据**
   ```
   GET /api/production/output
   Query Parameters:
     - start_date: YYYY-MM-DD
     - end_date: YYYY-MM-DD
   Response:
     {
       "data": [
         {
           "work_order": "WO20240101",
           "product_type": "MCU",
           "output_qty": 1000,
           "line_id": "LINE01",
           "date": "2024-01-01",
           ...
         }
       ]
     }
   ```

3. **制程测试数据**
   ```
   GET /api/production/process-test
   Query Parameters:
     - start_date: YYYY-MM-DD
     - end_date: YYYY-MM-DD
   Response:
     {
       "data": [
         {
           "work_order": "WO20240101",
           "process_id": "P01",
           "first_pass_qty": 950,
           "total_test_qty": 1000,
           "line_id": "LINE01",
           ...
         }
       ]
     }
   ```

## 使用方法

### 1. 启动 Celery Worker

```bash
# 在 backend 目录下执行
celery -A app.core.celery_app worker --loglevel=info
```

### 2. 启动 Celery Beat (定时任务调度器)

```bash
# 在 backend 目录下执行
celery -A app.core.celery_app beat --loglevel=info
```

### 3. 在代码中使用服务

```python
from app.services.ims_integration_service import ims_integration_service
from app.core.database import get_db
from datetime import date

# 在 FastAPI 路由中使用
@router.post("/admin/ims/sync")
async def trigger_ims_sync(
    target_date: date,
    db: AsyncSession = Depends(get_db)
):
    """手动触发 IMS 数据同步"""
    result = await ims_integration_service.sync_all_data(
        db=db,
        target_date=target_date
    )
    return result
```

### 4. 手动触发 Celery 任务

```python
from app.tasks.ims_sync_tasks import sync_ims_data_manual

# 触发手动同步任务
task = sync_ims_data_manual.delay("2024-01-15")
print(f"Task ID: {task.id}")

# 查询任务状态
result = task.get(timeout=300)  # 等待最多5分钟
print(result)
```

### 5. 查询同步历史

```python
from app.services.ims_integration_service import ims_integration_service
from app.models.ims_sync_log import SyncType
from datetime import date

# 查询最近的同步记录
logs = await ims_integration_service.get_sync_history(
    db=db,
    sync_type=SyncType.INCOMING_INSPECTION,
    start_date=date(2024, 1, 1),
    limit=10
)

for log in logs:
    print(f"{log.sync_date}: {log.status} - {log.records_count} 条记录")
```

## 监控与日志

### 同步日志表 (ims_sync_logs)

每次同步操作都会在数据库中记录：
- `sync_type`: 同步类型
- `sync_date`: 同步日期
- `status`: 同步状态 (success/failed/partial/in_progress)
- `records_count`: 同步记录数量
- `error_message`: 错误信息（如果失败）
- `started_at`: 开始时间
- `completed_at`: 完成时间

### 查询同步状态

```sql
-- 查询最近的同步记录
SELECT 
    sync_type,
    sync_date,
    status,
    records_count,
    error_message,
    started_at,
    completed_at
FROM ims_sync_logs
ORDER BY created_at DESC
LIMIT 20;

-- 统计同步成功率
SELECT 
    sync_type,
    COUNT(*) as total_syncs,
    SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful_syncs,
    ROUND(
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::numeric / COUNT(*) * 100, 
        2
    ) as success_rate
FROM ims_sync_logs
WHERE sync_date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY sync_type;
```

## 错误处理

### 常见错误及解决方案

1. **IMS_BASE_URL 未配置**
   ```
   错误: ValueError: IMS_BASE_URL 未配置，请在 .env 文件中设置
   解决: 在 .env 文件中添加 IMS_BASE_URL=http://ims.company.com/api
   ```

2. **网络连接超时**
   ```
   错误: httpx.ConnectTimeout
   解决: 
   - 检查 IMS 系统是否可访问
   - 增加 IMS_TIMEOUT 配置值
   - 检查网络防火墙规则
   ```

3. **API 认证失败**
   ```
   错误: httpx.HTTPStatusError: 401 Unauthorized
   解决: 检查 IMS_API_KEY 是否正确
   ```

4. **数据格式错误**
   ```
   错误: KeyError: 'data'
   解决: 检查 IMS API 返回的数据格式是否符合约定
   ```

## 扩展功能

### 添加新的数据同步类型

1. 在 `SyncType` 枚举中添加新类型：
   ```python
   # app/models/ims_sync_log.py
   class SyncType(str, enum.Enum):
       # ... 现有类型
       NEW_DATA_TYPE = "new_data_type"
   ```

2. 在 `IMSIntegrationService` 中添加新方法：
   ```python
   async def fetch_new_data_type(
       self,
       db: AsyncSession,
       start_date: date,
       end_date: Optional[date] = None
   ) -> Dict[str, Any]:
       # 实现逻辑
       pass
   ```

3. 在 `sync_all_data` 方法中调用新方法

## 性能优化建议

1. **批量插入数据**
   - 使用 SQLAlchemy 的 `bulk_insert_mappings` 提高插入性能
   - 每次同步后批量计算质量指标

2. **并发同步**
   - 使用 `asyncio.gather` 并发拉取多种数据类型
   - 注意控制并发数量，避免压垮 IMS 系统

3. **增量同步**
   - 记录上次同步的时间戳
   - 只拉取增量数据，减少网络传输

4. **缓存机制**
   - 对于不常变化的数据（如供应商信息），使用 Redis 缓存
   - 设置合理的缓存过期时间

## 测试

### 单元测试示例

```python
# tests/test_ims_integration.py
import pytest
from datetime import date
from app.services.ims_integration_service import ims_integration_service

@pytest.mark.asyncio
async def test_fetch_incoming_inspection_data(db_session):
    """测试入库检验数据拉取"""
    result = await ims_integration_service.fetch_incoming_inspection_data(
        db=db_session,
        start_date=date(2024, 1, 1)
    )
    
    assert result["success"] is True
    assert result["records_count"] >= 0
    assert "data" in result
```

## 部署检查清单

- [ ] 配置 IMS_BASE_URL 环境变量
- [ ] 配置 IMS_API_KEY 环境变量
- [ ] 配置 CELERY_BROKER_URL (Redis)
- [ ] 启动 Celery Worker 进程
- [ ] 启动 Celery Beat 调度器
- [ ] 验证 IMS API 连通性
- [ ] 执行一次手动同步测试
- [ ] 检查同步日志表是否正常记录
- [ ] 配置监控告警（同步失败时发送通知）

## 相关文档

- [质量数据模型实现](./QUALITY_DATA_MODELS_IMPLEMENTATION.md)
- [Celery 官方文档](https://docs.celeryproject.org/)
- [HTTPX 官方文档](https://www.python-httpx.org/)

## 更新日志

### 2024-02-13
- ✅ 实现 IMSIntegrationService 核心服务
- ✅ 实现 Celery 定时任务配置
- ✅ 实现每日凌晨 02:00 自动同步
- ✅ 实现错误处理和重试机制
- ✅ 添加同步日志记录功能
