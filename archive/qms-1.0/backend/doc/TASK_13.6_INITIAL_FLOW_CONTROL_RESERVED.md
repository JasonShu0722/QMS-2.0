# Task 13.6: 初期流动管理预留接口实现文档

## 任务概述

本任务实现初期流动管理（Initial Flow Control）的预留功能接口，为未来扩展奠定基础。

**重要说明**：当前阶段仅作为静态记录，不实现业务逻辑，待整体系统运行成熟度提升后开启。

## 实现内容

### 1. 数据模型 (Model)

**文件**: `backend/app/models/initial_flow_control.py`

**核心特性**：
- 所有字段均设置为 `nullable=True`，确保数据库兼容性（遵循双轨发布架构的非破坏性原则）
- 预留了完整的字段结构，未来启用时可根据实际需求调整字段约束

**主要字段**：

1. **关联字段**：
   - `project_id`: 关联新品项目
   - `material_code`: 物料编码
   - `material_name`: 物料名称

2. **加严控制配置**：
   - `control_type`: 控制类型枚举（全检、加大抽样、关键尺寸检查、过程监控、自定义）
   - `control_config`: JSON格式配置（检验比例、抽样数量、关键尺寸列表、CPK阈值、控制周期等）

3. **退出机制配置**：
   - `exit_criteria`: JSON格式退出条件（连续合格批次数、合格率阈值、CPK阈值、零缺陷批次数）
   - `auto_exit_enabled`: 是否启用自动退出判断
   - `exit_evaluation_data`: JSON格式评估数据（已评估批次数、合格批次数、平均合格率、平均CPK）

4. **控制状态**：
   - `status`: 控制状态枚举（加严控制中、监控中、已解除、已暂停）
   - `production_lock_enabled`: 是否启用生产互锁（预留与MES系统对接）
   - `lock_reason`: 互锁原因

5. **时间节点**：
   - `start_date`: 开始日期
   - `planned_end_date`: 计划结束日期
   - `actual_end_date`: 实际结束日期

### 2. 枚举类型

**FlowControlType（加严控制类型）**：
- `FULL_INSPECTION`: 全检
- `INCREASED_SAMPLING`: 加大抽样
- `KEY_DIMENSION_CHECK`: 关键尺寸逐件检查
- `PROCESS_MONITORING`: 过程监控
- `CUSTOM`: 自定义

**FlowControlStatus（控制状态）**：
- `ACTIVE`: 加严控制中
- `MONITORING`: 监控中（已放宽但仍观察）
- `RELEASED`: 已解除
- `SUSPENDED`: 已暂停（异常情况）

### 3. 数据库迁移

**文件**: `backend/alembic/versions/2026_02_14_1700-015_add_initial_flow_control_table.py`

**迁移内容**：
- 创建 `initial_flow_controls` 表
- 创建必要的索引（id, project_id, material_code, status）
- 创建枚举类型（flowcontroltype, flowcontrolstatus）

**兼容性保证**：
- 所有字段均为 `nullable=True`
- 使用 `server_default` 为布尔字段提供默认值
- 遵循非破坏性迁移原则，确保双轨环境兼容

### 4. 模型关系

**NewProductProject 关系更新**：
- 在 `new_product_project.py` 中添加了 `initial_flow_controls` 关系映射
- 支持级联删除（`cascade="all, delete-orphan"`）

### 5. 模型导出

**文件**: `backend/app/models/__init__.py`

已添加以下导出：
- `InitialFlowControl`
- `FlowControlStatus`
- `FlowControlType`

## JSON 字段结构示例

### control_config（加严控制配置）

```json
{
  "inspection_rate": 100,
  "sample_size": 50,
  "key_dimensions": ["D1", "D2", "D3"],
  "cpk_threshold": 1.67,
  "control_duration": 30
}
```

### exit_criteria（退出机制配置）

```json
{
  "consecutive_batches": 5,
  "pass_rate_threshold": 99.5,
  "cpk_threshold": 1.33,
  "zero_defect_batches": 3
}
```

### exit_evaluation_data（退出评估数据）

```json
{
  "evaluated_batches": 3,
  "qualified_batches": 3,
  "average_pass_rate": 99.8,
  "average_cpk": 1.45,
  "last_evaluation_date": "2026-01-15"
}
```

## 未来扩展方向

当系统运行成熟度提升后，可以基于此预留接口实现以下功能：

### 1. 加严控制配置入口

**前端界面**（预留）：
- 在新品项目详情页添加"初期流动管理"标签页
- 提供加严控制配置表单（控制类型、检验比例、关键尺寸等）
- 支持启用/禁用生产互锁

**后端API**（预留）：
```python
# POST /api/v1/initial-flow-controls
# PUT /api/v1/initial-flow-controls/{id}
# GET /api/v1/initial-flow-controls/project/{project_id}
```

### 2. 退出机制自动判断逻辑

**实现思路**：
- 创建 Celery 定时任务，每日评估初期流动控制状态
- 根据 `exit_criteria` 配置，自动计算是否满足退出条件
- 更新 `exit_evaluation_data` 记录评估结果
- 当满足条件时，自动将 `status` 更新为 `RELEASED`

**核心算法**（预留）：
```python
async def evaluate_exit_criteria(control_id: int):
    """评估是否满足退出条件"""
    control = await get_initial_flow_control(control_id)
    
    # 获取最近N批次的质量数据
    recent_batches = await get_recent_batch_quality_data(
        material_code=control.material_code,
        batch_count=control.exit_criteria["consecutive_batches"]
    )
    
    # 计算平均合格率
    avg_pass_rate = calculate_average_pass_rate(recent_batches)
    
    # 判断是否满足退出条件
    if avg_pass_rate >= control.exit_criteria["pass_rate_threshold"]:
        # 自动解除加严控制
        await release_flow_control(control_id)
```

### 3. 生产互锁（与MES系统对接）

**实现思路**：
- 当 `production_lock_enabled=True` 时，系统拦截生产指令
- 通过 API 与 MES 系统对接，实现自动拦截
- 提供人工解锁机制（需审批）

**API接口**（预留）：
```python
# POST /api/v1/initial-flow-controls/{id}/lock
# POST /api/v1/initial-flow-controls/{id}/unlock
# GET /api/v1/initial-flow-controls/check-lock/{material_code}
```

## 数据库兼容性说明

### 为什么所有字段都是 nullable=True？

根据 **2.12.2 数据库兼容性规范**，双轨发布架构要求：

1. **预览环境新增字段必须为 nullable 或带有 default value**
   - 确保正式环境旧代码读取时不报错
   - 避免预览环境修改导致正式环境崩溃

2. **预留功能接口的特殊性**
   - 当前阶段不实现业务逻辑，仅作为静态记录
   - 未来启用时，可根据实际需求调整字段约束
   - 通过 Alembic 迁移逐步收紧约束（如：将 nullable 改为 False）

### 未来启用时的迁移策略

```python
# 示例：未来将 material_code 改为必填
def upgrade():
    op.alter_column(
        'initial_flow_controls',
        'material_code',
        nullable=False,
        existing_type=sa.String(100)
    )
```

## 测试建议

当未来启用此功能时，建议进行以下测试：

### 1. 单元测试
- 测试 `InitialFlowControl` 模型的 CRUD 操作
- 测试 JSON 字段的序列化/反序列化
- 测试枚举类型的有效性

### 2. 集成测试
- 测试与 `NewProductProject` 的关联关系
- 测试退出机制自动判断逻辑
- 测试生产互锁功能

### 3. 性能测试
- 测试大量初期流动控制记录的查询性能
- 测试定时任务的执行效率

## 相关需求

- **Requirements**: 2.8.5 初期流动管理
- **Product.md**: 2.8.5 初期流动管理（预留功能接口）

## 总结

本任务成功创建了初期流动管理的预留功能接口，包括：

✅ 数据模型（InitialFlowControl）  
✅ 枚举类型（FlowControlType, FlowControlStatus）  
✅ 数据库迁移脚本  
✅ 模型关系映射  
✅ 完整的字段结构设计  

当前阶段仅作为静态记录，待系统运行成熟度提升后，可基于此预留接口快速实现完整的初期流动管理功能。
