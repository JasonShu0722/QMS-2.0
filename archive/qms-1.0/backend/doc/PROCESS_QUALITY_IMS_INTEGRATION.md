# 制程质量管理 - IMS 数据集成实现文档

## 概述

本文档描述了为制程质量管理模块（2.6）实现的 IMS 数据集成功能。根据任务 11.2 的要求，扩展了 `IMSIntegrationService` 类，新增了三个数据同步方法。

## 实现的方法

### 1. sync_production_output()

**用途**: 同步成品入库数据

**功能说明**:
- 从 IMS 系统拉取成品入库统计数据
- 为核心指标计算提供准确的"分母"数据
- 用于计算制程不合格率 (2.4.1)
- 支持试产数据自动抓取 (2.8.3)

**维度要求**:
- 日期 (date)
- 工单号 (work_order)
- 工序 (process_id)
- 产线 (line_id)
- 产出数量 (output_qty)
- 产品类型 (product_type)

**API 端点**: `GET /api/production/finished-goods-input`

**返回数据格式**:
```json
{
  "success": true,
  "records_count": 100,
  "data": [
    {
      "date": "2026-02-14",
      "work_order": "WO202602140001",
      "process_id": "P001",
      "line_id": "LINE01",
      "output_qty": 1000,
      "product_type": "MCU"
    }
  ],
  "error": null
}
```

### 2. sync_first_pass_test()

**用途**: 同步一次测试数据

**功能说明**:
- 从 IMS 系统拉取一次测试通过数和总数量
- 用于计算制程直通率 (FPY) (2.4.1)
- 支持多维度的钻取分析

**维度要求**:
- 日期 (date)
- 工单号 (work_order)
- 工序 (process_id)
- 产线 (line_id)
- 一次测试通过数 (first_pass_qty)
- 一次测试总数量 (total_test_qty)
- 产品类型 (product_type)

**API 端点**: `GET /api/production/first-pass-test`

**返回数据格式**:
```json
{
  "success": true,
  "records_count": 100,
  "data": [
    {
      "date": "2026-02-14",
      "work_order": "WO202602140001",
      "process_id": "P001",
      "line_id": "LINE01",
      "first_pass_qty": 950,
      "total_test_qty": 1000,
      "product_type": "MCU"
    }
  ],
  "error": null
}
```

### 3. sync_process_defects()

**用途**: 同步制程不良记录

**功能说明**:
- 从 IMS 系统拉取制程不良记录
- 自动保存到 `process_defects` 表
- 支持按责任类别进行区分统计
- 为 2.6.2 不合格品数据录入提供 IMS 自动同步的数据源

**维度要求**:
- 日期 (date)
- 工单号 (work_order)
- 工序 (process_id)
- 产线 (line_id)
- 不良类型 (defect_type)
- 不良数量 (defect_qty)
- 责任类别 (responsibility_category)

**责任类别枚举**:
- `material_defect`: 物料不良
- `operation_defect`: 作业不良
- `equipment_defect`: 设备不良
- `process_defect`: 工艺不良
- `design_defect`: 设计不良

**API 端点**: `GET /api/production/process-defects`

**返回数据格式**:
```json
{
  "success": true,
  "records_count": 50,
  "saved_count": 48,
  "data": [
    {
      "date": "2026-02-14",
      "work_order": "WO202602140001",
      "process_id": "P001",
      "line_id": "LINE01",
      "defect_type": "焊接不良",
      "defect_qty": 5,
      "responsibility_category": "operation_defect",
      "operator_id": 123,
      "material_code": "MAT001",
      "supplier_code": "SUP001",
      "remarks": "备注信息"
    }
  ],
  "error": null
}
```

**特殊处理**:
- 当责任类别为 `material_defect` 时，自动查询并关联供应商 ID
- 系统自动创建的记录，`recorded_by` 字段使用系统账号 ID (1)
- 如果部分记录保存失败，返回 `PARTIAL` 状态并记录错误信息

## 同步日志类型

在 `IMSSyncLog` 模型中，已预定义以下同步类型：

- `PRODUCTION_OUTPUT`: 成品产出数据（旧方法，保持兼容）
- `FIRST_PASS_TEST`: 一次测试数据（新增）
- `PROCESS_DEFECTS`: 制程不良记录（新增）

## 集成到 sync_all_data()

`sync_all_data()` 方法已更新，现在包含以下同步任务：

1. 入库检验数据 (incoming_inspection)
2. 成品产出数据 (production_output) - 旧方法
3. 制程测试数据 (process_test)
4. IQC 检验结果 (iqc_results)
5. 特采记录 (special_approval)
6. **成品入库数据 (sync_production_output)** - 新增
7. **一次测试数据 (sync_first_pass_test)** - 新增
8. **制程不良记录 (sync_process_defects)** - 新增

## 使用示例

### 单独调用

```python
from datetime import date
from app.services.ims_integration_service import ims_integration_service

# 同步成品入库数据
result = await ims_integration_service.sync_production_output(
    db=db,
    start_date=date(2026, 2, 14)
)

# 同步一次测试数据
result = await ims_integration_service.sync_first_pass_test(
    db=db,
    start_date=date(2026, 2, 14)
)

# 同步制程不良记录
result = await ims_integration_service.sync_process_defects(
    db=db,
    start_date=date(2026, 2, 14)
)
```

### 通过 Celery 定时任务

```python
from celery import shared_task
from datetime import date, timedelta

@shared_task
def sync_ims_data_daily():
    """每日凌晨 02:00 同步 IMS 数据"""
    target_date = date.today() - timedelta(days=1)
    
    async with get_db() as db:
        result = await ims_integration_service.sync_all_data(
            db=db,
            target_date=target_date
        )
    
    return result
```

## 错误处理

所有方法都实现了完善的错误处理机制：

1. **网络异常**: 自动重试 3 次，使用指数退避策略（2秒、4秒、8秒）
2. **数据验证**: 验证必填字段，跳过不完整的记录
3. **数据库异常**: 记录详细错误信息到同步日志
4. **部分失败**: 支持部分成功状态，记录失败原因

## 测试

运行测试脚本验证实现：

```bash
python backend/scripts/test_ims_integration.py
```

测试脚本包含以下测试用例：

1. 拉取入库检验数据
2. 拉取成品产出数据
3. 拉取制程测试数据
4. **同步成品入库数据（新增）**
5. **同步一次测试数据（新增）**
6. **同步制程不良记录（新增）**
7. 同步所有数据
8. 查询同步历史

## 配置要求

在 `.env` 文件中配置以下环境变量：

```env
# IMS 系统配置
IMS_BASE_URL=http://ims.company.com/api
IMS_API_KEY=your_api_key_here
IMS_TIMEOUT=30
```

## 数据库表结构

### process_defects 表

```sql
CREATE TABLE process_defects (
    id SERIAL PRIMARY KEY,
    defect_date DATE NOT NULL,
    work_order VARCHAR(100) NOT NULL,
    process_id VARCHAR(50) NOT NULL,
    line_id VARCHAR(50) NOT NULL,
    defect_type VARCHAR(200) NOT NULL,
    defect_qty INTEGER NOT NULL,
    responsibility_category VARCHAR(50) NOT NULL,
    operator_id INTEGER,
    recorded_by INTEGER NOT NULL,
    material_code VARCHAR(100),
    supplier_id INTEGER,
    remarks VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## 后续工作

1. 配置 Celery 定时任务，每日凌晨 02:00 自动同步数据
2. 实现数据校验和清洗逻辑
3. 添加数据同步监控和告警
4. 优化大批量数据的同步性能

## 相关需求

- Requirements: 2.6.1 (生产数据集成)
- Task: 11.2 (实现生产数据集成)

## 更新日期

2026-02-14
