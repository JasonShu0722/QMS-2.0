# 发货数据集成实现文档

## 概述

本文档描述了客户质量管理模块（2.7）中发货数据集成功能的实现细节。该功能用于维护过去24个月的分月出货数据，为计算客户质量PPM指标提供准确的分母数据。

## 实现内容

### 1. 数据模型 (`app/models/shipment_data.py`)

创建了 `ShipmentData` 模型，用于存储发货记录：

**核心字段：**
- `customer_code`: 客户代码（必填，索引）
- `product_type`: 产品类型（必填，索引）
- `shipment_date`: 出货日期（必填，索引）
- `shipment_qty`: 出货数量（必填，默认0）

**可选字段：**
- `work_order`: 工单号
- `batch_number`: 批次号
- `destination`: 目的地

**索引优化：**
- 单列索引：`customer_code`, `product_type`, `shipment_date`
- 复合索引：`(customer_code, product_type, shipment_date)` - 优化按客户、产品、日期范围查询
- 日期范围索引：`shipment_date` - 优化滚动计算

### 2. 数据库迁移 (`alembic/versions/2026_02_14_1500-013_add_shipment_data_table.py`)

创建了 Alembic 迁移脚本，遵循双轨兼容原则：

**兼容性设计：**
- 所有字段均为 `nullable=True` 或带有 `server_default`
- 不影响现有表结构
- 支持 Preview 和 Stable 环境共享数据库

**迁移内容：**
- 创建 `shipment_data` 表
- 创建所有必要的索引
- 添加表和列的注释说明

### 3. IMS 集成服务扩展 (`app/services/ims_integration_service.py`)

扩展了 `IMSIntegrationService` 类，新增以下方法：

#### 3.1 `sync_shipment_data()`

**功能：**
- 从 IMS/ERP/SAP 系统同步发货记录
- 支持日期范围查询
- 自动去重（基于客户代码、产品类型、出货日期、工单号）
- 更新现有记录或插入新记录

**API 端点：**
```
GET /api/shipment/records
参数：
  - start_date: 开始日期 (YYYY-MM-DD)
  - end_date: 结束日期 (YYYY-MM-DD)
```

**预期数据格式：**
```json
{
  "data": [
    {
      "customer_code": "CUST001",
      "product_type": "MCU",
      "shipment_date": "2026-02-14",
      "shipment_qty": 5000,
      "work_order": "WO202602140001",
      "batch_number": "BATCH001",
      "destination": "上海工厂"
    }
  ]
}
```

**返回结果：**
```python
{
    "success": bool,
    "records_count": int,  # 从IMS获取的记录数
    "saved_count": int,    # 实际保存到数据库的记录数
    "data": List[Dict],
    "error": Optional[str]
}
```

#### 3.2 `_cleanup_old_shipment_data()`

**功能：**
- 自动清理超过24个月的旧发货数据
- 在每次同步后自动执行
- 确保数据库不会无限增长

**清理策略：**
- 保留过去 24 个月（约 720 天）的数据
- 删除 `shipment_date < (today - 24 months)` 的记录

#### 3.3 更新 `sync_all_data()`

**功能：**
- 在定时任务中集成发货数据同步
- 与其他数据类型（入库检验、成品产出等）一起同步

**执行顺序：**
1. 入库检验数据
2. 成品产出数据
3. 制程测试数据
4. IQC 检验结果
5. 特采记录
6. 成品入库数据
7. 一次测试数据
8. 制程不良记录
9. **发货数据（新增）**

## 使用场景

### 1. 计算 0KM 不良 PPM (2.4.1)

```python
# 公式：0KM不良PPM = (0KM客诉数 / 成品出库总量) * 1,000,000

# 查询当月出货总量
from app.models.shipment_data import ShipmentData
from sqlalchemy import select, func

query = select(func.sum(ShipmentData.shipment_qty)).where(
    ShipmentData.shipment_date >= start_of_month,
    ShipmentData.shipment_date <= end_of_month
)
total_shipment = await db.execute(query)
```

### 2. 计算 3MIS 售后不良 PPM (2.4.1)

```python
# 公式：3MIS PPM = (3MIS客诉数 / 3个月滚动出货量) * 1,000,000

# 查询过去3个月的出货总量
three_months_ago = date.today() - timedelta(days=90)
query = select(func.sum(ShipmentData.shipment_qty)).where(
    ShipmentData.shipment_date >= three_months_ago,
    ShipmentData.shipment_date <= date.today()
)
rolling_3_months_shipment = await db.execute(query)
```

### 3. 计算 12MIS 售后不良 PPM (2.4.1)

```python
# 公式：12MIS PPM = (12MIS客诉数 / 12个月滚动出货量) * 1,000,000

# 查询过去12个月的出货总量
twelve_months_ago = date.today() - timedelta(days=365)
query = select(func.sum(ShipmentData.shipment_qty)).where(
    ShipmentData.shipment_date >= twelve_months_ago,
    ShipmentData.shipment_date <= date.today()
)
rolling_12_months_shipment = await db.execute(query)
```

### 4. 按产品类型分类统计

```python
# 按产品类型分组统计出货量
query = select(
    ShipmentData.product_type,
    func.sum(ShipmentData.shipment_qty).label('total_qty')
).where(
    ShipmentData.shipment_date >= start_date,
    ShipmentData.shipment_date <= end_date
).group_by(ShipmentData.product_type)

results = await db.execute(query)
```

### 5. 按客户分类统计

```python
# 按客户代码分组统计出货量
query = select(
    ShipmentData.customer_code,
    func.sum(ShipmentData.shipment_qty).label('total_qty')
).where(
    ShipmentData.shipment_date >= start_date,
    ShipmentData.shipment_date <= end_date
).group_by(ShipmentData.customer_code)

results = await db.execute(query)
```

## Celery 定时任务配置

### 任务调度

```python
# backend/app/core/celery_app.py

from celery import Celery
from celery.schedules import crontab

celery_app = Celery('qms')

celery_app.conf.beat_schedule = {
    'sync-ims-data-daily': {
        'task': 'app.tasks.sync_ims_data',
        'schedule': crontab(hour=2, minute=0),  # 每日凌晨 02:00
        'args': ()
    },
}
```

### 任务实现

```python
# backend/app/tasks/ims_sync_tasks.py

from app.core.celery_app import celery_app
from app.services.ims_integration_service import ims_integration_service
from app.core.database import get_db

@celery_app.task(name='app.tasks.sync_ims_data')
async def sync_ims_data():
    """
    定时同步 IMS 数据任务
    每日凌晨 02:00 执行
    """
    async for db in get_db():
        result = await ims_integration_service.sync_all_data(db)
        return result
```

## 数据维护策略

### 1. 自动清理

- **触发时机**：每次同步后自动执行
- **清理规则**：删除超过24个月的数据
- **保留期限**：24个月（约720天）

### 2. 数据去重

- **去重键**：`(customer_code, product_type, shipment_date, work_order)`
- **处理策略**：
  - 如果记录已存在，更新 `shipment_qty`、`batch_number`、`destination`
  - 如果记录不存在，插入新记录

### 3. 错误处理

- **网络异常**：自动重试3次，指数退避（2秒、4秒、8秒）
- **数据异常**：记录错误日志，跳过异常记录，继续处理其他记录
- **同步日志**：记录每次同步的状态、记录数、错误信息

## 性能优化

### 1. 索引优化

- **单列索引**：加速单字段查询
- **复合索引**：优化多字段组合查询
- **日期范围索引**：优化滚动计算

### 2. 批量操作

- **批量插入**：使用 SQLAlchemy 的批量操作
- **批量更新**：减少数据库往返次数

### 3. 数据清理

- **定期清理**：防止数据库无限增长
- **异步执行**：不阻塞主线程

## 测试建议

### 1. 单元测试

```python
# backend/tests/test_shipment_data_integration.py

import pytest
from datetime import date, timedelta
from app.services.ims_integration_service import ims_integration_service

@pytest.mark.asyncio
async def test_sync_shipment_data(db_session):
    """测试发货数据同步"""
    target_date = date.today() - timedelta(days=1)
    result = await ims_integration_service.sync_shipment_data(
        db=db_session,
        start_date=target_date
    )
    
    assert result["success"] is True
    assert result["records_count"] >= 0

@pytest.mark.asyncio
async def test_cleanup_old_shipment_data(db_session):
    """测试旧数据清理"""
    deleted_count = await ims_integration_service._cleanup_old_shipment_data(
        db=db_session
    )
    
    assert deleted_count >= 0
```

### 2. 集成测试

- 测试与 IMS/ERP/SAP 系统的实际对接
- 验证数据格式和字段映射
- 测试错误处理和重试机制

### 3. 性能测试

- 测试大批量数据同步的性能
- 验证索引的查询优化效果
- 测试数据清理的执行时间

## 部署注意事项

### 1. 环境变量配置

```bash
# .env
IMS_BASE_URL=http://ims.company.com
IMS_API_KEY=your_api_key_here
IMS_TIMEOUT=30
```

### 2. 数据库迁移

```bash
# 执行迁移
alembic upgrade head

# 验证迁移
alembic current
```

### 3. Celery 启动

```bash
# 启动 Celery Worker
celery -A app.core.celery_app worker --loglevel=info

# 启动 Celery Beat（定时任务调度器）
celery -A app.core.celery_app beat --loglevel=info
```

## 监控和告警

### 1. 同步日志监控

```python
# 查询最近的同步日志
from app.models.ims_sync_log import IMSSyncLog, SyncType

recent_logs = await ims_integration_service.get_sync_history(
    db=db,
    sync_type=SyncType.SHIPMENT_DATA,
    limit=10
)

# 检查失败的同步
failed_logs = [log for log in recent_logs if log.is_failed()]
```

### 2. 数据完整性检查

```python
# 检查是否有缺失的日期
from sqlalchemy import select, func

query = select(
    func.date_trunc('day', ShipmentData.shipment_date).label('date'),
    func.count().label('count')
).group_by('date').order_by('date')

results = await db.execute(query)
```

### 3. 告警配置

- **同步失败告警**：连续3次同步失败时发送邮件
- **数据异常告警**：出货数量为0或异常大时发送预警
- **性能告警**：同步耗时超过阈值时发送通知

## 总结

本实现完成了客户质量管理模块中发货数据集成的核心功能：

✅ 创建了 `ShipmentData` 数据模型
✅ 实现了数据库迁移脚本（遵循双轨兼容原则）
✅ 扩展了 `IMSIntegrationService` 类，新增 `sync_shipment_data()` 方法
✅ 实现了自动数据清理机制（保留24个月）
✅ 集成到定时任务中（每日凌晨02:00执行）
✅ 提供了完整的错误处理和日志记录
✅ 优化了数据库索引，支持高效查询

该实现为后续的客户质量PPM指标计算（0KM、3MIS、12MIS）提供了可靠的数据基础。
