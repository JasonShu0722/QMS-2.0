# IQC 数据集成实现指南

## 概述

本文档描述 IQC（Incoming Quality Control，入库质量控制）数据集成功能的实现细节。该功能扩展了 `IMSIntegrationService` 类，实现了与 IMS 系统的 IQC 数据同步、NG 自动立案以及特采记录管理。

## 功能模块

### 1. sync_iqc_inspection_results()

**功能描述**：从 IMS 系统同步 IQC 检验结果数据

**用途**：
- 为 2.4.1 质量数据中心提供计算源数据
- 触发 NG 自动立案逻辑 (2.5.1)
- 流向 2.5.4 绩效评分

**API 端点**：`GET /api/quality/iqc-inspection-results`

**请求参数**：
```python
{
    "start_date": "2024-01-15",  # 开始日期
    "end_date": "2024-01-15"     # 结束日期（可选）
}
```

**响应数据结构**：
```python
{
    "data": [
        {
            "material_code": "MAT-001",           # 物料编码
            "supplier_code": "SUP-001",           # 供应商代码
            "batch_number": "BATCH-20240115-001", # 批次号
            "inspection_result": "NG",            # 检验结果 (OK/NG)
            "defect_description": "尺寸超差",      # 不良描述
            "defect_qty": 50,                     # 不良数量
            "inspector": "张三",                   # 检验员
            "inspection_date": "2024-01-15"       # 检验日期
        }
    ]
}
```

**返回结果**：
```python
{
    "success": True,              # 是否成功
    "records_count": 100,         # 总记录数
    "ng_count": 5,                # NG 记录数量
    "auto_scar_count": 3,         # 自动创建的 SCAR 数量
    "data": [...],                # 原始数据
    "error": None                 # 错误信息（如有）
}
```

**核心逻辑**：
1. 调用 IMS API 获取 IQC 检验结果
2. 统计 NG 记录数量
3. 对 NG 记录触发自动立案逻辑
4. 记录同步日志到 `ims_sync_logs` 表

### 2. auto_create_scar_on_ng()

**功能描述**：NG 自动立案逻辑，当检测到不合格记录时自动生成 SCAR 单

**触发条件**：`inspection_result == "NG"`

**SCAR 编号生成规则**：
- 格式：`SCAR-YYYYMMDD-XXXX`
- 示例：`SCAR-20240115-0001`
- 序号从 0001 开始，每天重新计数

**严重度判定规则**：
```python
if defect_qty >= 100:
    severity = CRITICAL  # 严重
elif defect_qty >= 50:
    severity = HIGH      # 高
elif defect_qty >= 10:
    severity = MEDIUM    # 中
else:
    severity = LOW       # 低
```

**截止日期设置**：
- 默认：创建日期 + 7 个工作日

**必填字段验证**：
- `material_code`：物料编码
- `supplier_code`：供应商代码

**错误处理**：
- 供应商不存在：跳过该记录，记录错误
- 字段缺失：跳过该记录，记录错误
- 创建失败：跳过该记录，记录错误

**返回结果**：
```python
{
    "created_count": 3,      # 成功创建数量
    "skipped_count": 2,      # 跳过数量
    "errors": [              # 错误列表
        "未找到供应商: SUP-999",
        "记录缺少必填字段: material_code=None"
    ]
}
```

### 3. sync_special_approval_records()

**功能描述**：同步特采（特殊批准）记录

**用途**：
- 标记特采批次
- 用于后续追踪该批次物料在产线上的表现
- 为质量追溯提供数据支持

**API 端点**：`GET /api/quality/special-approval-records`

**请求参数**：
```python
{
    "start_date": "2024-01-15",  # 开始日期
    "end_date": "2024-01-15"     # 结束日期（可选）
}
```

**响应数据结构**：
```python
{
    "data": [
        {
            "material_code": "MAT-001",           # 物料编码
            "batch_number": "BATCH-20240115-001", # 批次号
            "approval_reason": "紧急生产需求",     # 特采原因
            "approval_date": "2024-01-15",        # 批准日期
            "approver": "李四",                    # 批准人
            "expiry_date": "2024-01-20"           # 有效期
        }
    ]
}
```

**返回结果**：
```python
{
    "success": True,              # 是否成功
    "records_count": 10,          # 总记录数
    "data": [...],                # 原始数据
    "error": None                 # 错误信息（如有）
}
```

## 集成到 sync_all_data()

`sync_all_data()` 方法已更新，现在包含 IQC 相关的数据同步：

**同步顺序**：
1. 入库检验数据 (`incoming_inspection`)
2. 成品产出数据 (`production_output`)
3. 制程测试数据 (`process_test`)
4. **IQC 检验结果** (`iqc_results`) ← 新增
5. **特采记录** (`special_approval`) ← 新增

**返回结果结构**：
```python
{
    "date": "2024-01-15",
    "started_at": "2024-01-16T02:00:00",
    "completed_at": "2024-01-16T02:05:30",
    "overall_success": True,
    "incoming_inspection": {...},
    "production_output": {...},
    "process_test": {...},
    "iqc_results": {              # 新增
        "success": True,
        "records_count": 100,
        "ng_count": 5,
        "auto_scar_count": 3
    },
    "special_approval": {         # 新增
        "success": True,
        "records_count": 10
    }
}
```

## 数据库表结构

### ims_sync_logs 表

**新增同步类型**：
- `IQC_RESULTS`：IQC 检验结果
- `SPECIAL_APPROVAL`：特采记录

这些类型已在 `SyncType` 枚举中定义。

### scars 表

**自动创建的字段**：
- `scar_number`：自动生成（SCAR-YYYYMMDD-XXXX）
- `supplier_id`：从供应商代码查询
- `material_code`：来自 IMS 数据
- `defect_description`：来自 IMS 数据 + 批次号
- `defect_qty`：来自 IMS 数据
- `severity`：根据不良数量自动判定
- `status`：默认为 `OPEN`
- `current_handler_id`：初始为 `None`（待指派）
- `deadline`：创建日期 + 7 天
- `created_by`：`None`（系统自动创建）

## 使用示例

### 1. 单独同步 IQC 检验结果

```python
from datetime import date
from app.services.ims_integration_service import ims_integration_service

# 同步昨天的 IQC 数据
result = await ims_integration_service.sync_iqc_inspection_results(
    db=session,
    start_date=date.today() - timedelta(days=1)
)

print(f"同步成功: {result['success']}")
print(f"总记录数: {result['records_count']}")
print(f"NG 记录数: {result['ng_count']}")
print(f"自动创建 SCAR: {result['auto_scar_count']}")
```

### 2. 手动触发 NG 立案

```python
# 模拟 NG 记录
ng_records = [
    {
        "material_code": "MAT-001",
        "supplier_code": "SUP-001",
        "defect_description": "尺寸超差",
        "defect_qty": 50,
        "batch_number": "BATCH-20240115-001"
    }
]

result = await ims_integration_service.auto_create_scar_on_ng(
    db=session,
    ng_records=ng_records
)

print(f"成功创建: {result['created_count']}")
print(f"跳过: {result['skipped_count']}")
```

### 3. 同步特采记录

```python
result = await ims_integration_service.sync_special_approval_records(
    db=session,
    start_date=date.today() - timedelta(days=1)
)

print(f"同步成功: {result['success']}")
print(f"特采记录数: {result['records_count']}")
```

### 4. 完整数据同步（包含 IQC）

```python
# 同步所有类型的数据
result = await ims_integration_service.sync_all_data(
    db=session,
    target_date=date.today() - timedelta(days=1)
)

print(f"整体成功: {result['overall_success']}")
print(f"IQC 检验: {result['iqc_results']['success']}")
print(f"特采记录: {result['special_approval']['success']}")
```

## Celery 定时任务配置

在 `backend/app/core/celery_tasks.py` 中配置定时任务：

```python
from celery import Celery
from celery.schedules import crontab

@celery.task
async def sync_ims_data_daily():
    """每日凌晨 02:00 同步 IMS 数据"""
    async with get_db_session() as session:
        result = await ims_integration_service.sync_all_data(
            db=session,
            target_date=date.today() - timedelta(days=1)
        )
        return result

# 配置定时任务
celery.conf.beat_schedule = {
    'sync-ims-data-daily': {
        'task': 'app.core.celery_tasks.sync_ims_data_daily',
        'schedule': crontab(hour=2, minute=0),  # 每天凌晨 02:00
    },
}
```

## 错误处理

### 网络错误

- 自动重试 3 次
- 指数退避：2秒、4秒、8秒
- 记录详细错误信息到 `ims_sync_logs` 表

### 数据验证错误

- 跳过无效记录
- 记录错误原因到返回结果的 `errors` 列表
- 继续处理其他记录

### 数据库错误

- 事务回滚
- 记录错误信息
- 返回失败状态

## 监控与日志

### 同步日志查询

```python
# 查询最近的 IQC 同步记录
logs = await ims_integration_service.get_sync_history(
    db=session,
    sync_type=SyncType.IQC_RESULTS,
    limit=10
)

for log in logs:
    print(f"日期: {log.sync_date}, 状态: {log.status}, 记录数: {log.records_count}")
```

### 控制台输出

```
🔄 开始同步 IMS 数据: 2024-01-15
✅ IQC 检验结果同步成功: 100 条记录, 5 条 NG, 自动创建 3 个 SCAR
  ✅ 自动创建 SCAR: SCAR-20240115-0001 (供应商: 供应商A, 物料: MAT-001)
  ✅ 自动创建 SCAR: SCAR-20240115-0002 (供应商: 供应商B, 物料: MAT-002)
  ✅ 自动创建 SCAR: SCAR-20240115-0003 (供应商: 供应商C, 物料: MAT-003)
✅ 特采记录同步成功: 10 条记录
✅ IMS 数据同步完成: 2024-01-15
```

## 测试

运行测试脚本：

```bash
cd backend
python scripts/test_iqc_integration.py
```

测试覆盖：
1. 同步 IQC 检验结果
2. NG 自动立案逻辑
3. 同步特采记录
4. 完整数据同步（包含 IQC）

## 注意事项

1. **IMS API 配置**：确保 `.env` 文件中配置了正确的 `IMS_BASE_URL` 和 `IMS_API_KEY`
2. **供应商数据**：NG 自动立案前，确保供应商数据已在系统中存在
3. **SCAR 编号唯一性**：系统自动确保每天的 SCAR 编号唯一
4. **事务处理**：所有 SCAR 创建操作在同一事务中，确保数据一致性
5. **性能考虑**：大批量 NG 记录可能导致创建大量 SCAR，建议监控性能

## 后续扩展

1. **邮件通知**：SCAR 创建后自动发送邮件给供应商
2. **严重度规则配置**：将严重度判定规则配置化，支持动态调整
3. **批量处理优化**：对大批量 NG 记录进行批量插入优化
4. **数据去重**：避免重复创建相同的 SCAR
5. **审批流程**：特采记录关联审批流程

## 相关文档

- [IMS 集成服务文档](./ims_integration_guide.md)
- [SCAR 管理文档](./scar_management_guide.md)
- [质量数据面板文档](./quality_dashboard_guide.md)
