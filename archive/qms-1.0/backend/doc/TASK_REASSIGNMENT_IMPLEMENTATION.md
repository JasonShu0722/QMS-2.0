# 任务转派功能实现文档
# Task Reassignment Implementation

## 概述 (Overview)

本文档描述任务转派与全局统计功能的实现细节。该功能允许管理员批量转派任务，并提供全局任务统计监控能力。

This document describes the implementation of task reassignment and global statistics features. This functionality allows administrators to batch reassign tasks and provides global task monitoring capabilities.

## 功能特性 (Features)

### 1. 批量任务转派 (Batch Task Reassignment)

**API 端点**: `POST /api/v1/admin/tasks/reassign`

**功能描述**:
- 支持将指定用户的待办任务批量转派给另一用户
- 支持转派所有任务或指定任务
- 自动更新各业务表的 `current_handler_id` 字段
- 自动发送通知给新的处理人
- 记录详细的转派结果

**使用场景**:
- 员工离职时，将其名下所有待办任务转移给接替人员
- 员工请长假时，临时转派任务给其他同事
- 工作负载调整，重新分配任务

**请求参数**:
```json
{
  "from_user_id": 10,
  "to_user_id": 20,
  "task_ids": ["scar_reports:123", "ppap_submissions:456"]
}
```

**参数说明**:
- `from_user_id`: 原处理人ID（必填）
- `to_user_id`: 新处理人ID（必填）
- `task_ids`: 任务ID列表（可选）
  - 格式：`table_name:record_id`
  - 为空或不提供时，转派该用户的所有待办任务

**响应示例**:
```json
{
  "success_count": 5,
  "failed_count": 0,
  "from_user": {
    "id": 10,
    "name": "张三"
  },
  "to_user": {
    "id": 20,
    "name": "李四"
  },
  "details": [
    {
      "task_id": "scar_reports:123",
      "status": "success",
      "from_user": "张三",
      "to_user": "李四"
    }
  ]
}
```

### 2. 全局任务统计 (Global Task Statistics)

**API 端点**: `GET /api/v1/admin/tasks/statistics`

**功能描述**:
- 按部门统计待办任务数量
- 按人员统计待办任务数量
- 统计逾期任务清单

**响应结构**:
```json
{
  "by_department": [
    {
      "department": "质量部",
      "total": 50,
      "overdue": 5,
      "urgent": 15,
      "normal": 30
    }
  ],
  "by_user": [
    {
      "user_id": 10,
      "user_name": "张三",
      "department": "质量部",
      "total": 15,
      "overdue": 2,
      "urgent": 5,
      "normal": 8
    }
  ],
  "overdue_tasks": [
    {
      "task_id": "scar_reports:123",
      "task_type": "SCAR报告处理",
      "task_number": "SCAR-2024-001",
      "deadline": "2024-01-15T10:00:00",
      "handler_id": 10,
      "handler_name": "张三",
      "department": "质量部",
      "overdue_hours": 120.5
    }
  ]
}
```

## 技术实现 (Technical Implementation)

### 核心组件 (Core Components)

#### 1. API 路由层 (API Router)
**文件**: `backend/app/api/v1/admin/tasks.py`

负责：
- 接收 HTTP 请求
- 参数校验
- 权限检查（TODO: 添加管理员权限验证）
- 调用服务层
- 返回响应

#### 2. 服务层 (Service Layer)
**文件**: `backend/app/services/task_reassignment_service.py`

核心类：`TaskReassignmentService`

主要方法：
- `reassign_tasks()`: 批量转派任务
- `get_task_statistics()`: 获取全局统计
- `_get_statistics_by_department()`: 按部门统计
- `_get_statistics_by_user()`: 按人员统计
- `_get_overdue_tasks()`: 获取逾期任务

#### 3. 数据模型层 (Schema Layer)
**文件**: `backend/app/schemas/task.py`

新增模型：
- `TaskReassignRequest`: 转派请求模型
- `TaskReassignResponse`: 转派响应模型
- `DepartmentStatistics`: 部门统计模型
- `UserStatistics`: 人员统计模型
- `OverdueTask`: 逾期任务模型

### 业务表配置 (Business Table Configuration)

系统通过配置列表定义需要聚合的业务表：

```python
BUSINESS_TABLES = [
    {
        "table": "scar_reports",
        "handler_field": "current_handler_id",
        "task_type": "SCAR报告处理",
        "deadline_field": "deadline",
        "number_field": "report_number",
        "enabled": False  # Phase 1 暂不启用
    },
    # ... 其他业务表配置
]
```

**配置说明**:
- `table`: 业务表名称
- `handler_field`: 处理人字段名
- `task_type`: 任务类型显示名称
- `deadline_field`: 截止时间字段名
- `number_field`: 单据编号字段名
- `enabled`: 是否启用（Phase 1 阶段暂不启用）

### 转派逻辑 (Reassignment Logic)

#### 转派所有任务
```sql
UPDATE {table_name}
SET {handler_field} = :to_user_id,
    updated_at = :updated_at
WHERE {handler_field} = :from_user_id
AND status NOT IN ('closed', 'completed', 'cancelled')
```

#### 转派指定任务
```sql
UPDATE {table_name}
SET {handler_field} = :to_user_id,
    updated_at = :updated_at
WHERE id = ANY(:record_ids)
AND {handler_field} = :from_user_id
AND status NOT IN ('closed', 'completed', 'cancelled')
```

### 统计逻辑 (Statistics Logic)

#### 按部门统计
```sql
SELECT 
    u.department,
    COUNT(*) as total,
    SUM(CASE WHEN deadline < NOW() THEN 1 ELSE 0 END) as overdue,
    SUM(CASE WHEN deadline >= NOW() 
        AND deadline <= NOW() + INTERVAL '72 hours' THEN 1 ELSE 0 END) as urgent,
    SUM(CASE WHEN deadline > NOW() + INTERVAL '72 hours' THEN 1 ELSE 0 END) as normal
FROM {table} t
JOIN users u ON t.{handler_field} = u.id
WHERE t.status NOT IN ('closed', 'completed', 'cancelled')
AND u.department IS NOT NULL
GROUP BY u.department
```

#### 按人员统计
类似部门统计，但按 `u.id, u.full_name, u.department` 分组。

#### 逾期任务查询
```sql
SELECT 
    t.id,
    t.{number_field} as task_number,
    t.{deadline_field} as deadline,
    u.id as handler_id,
    u.full_name as handler_name,
    u.department,
    EXTRACT(EPOCH FROM (NOW() - t.{deadline_field})) / 3600 as overdue_hours
FROM {table} t
JOIN users u ON t.{handler_field} = u.id
WHERE t.status NOT IN ('closed', 'completed', 'cancelled')
AND t.{deadline_field} < NOW()
ORDER BY t.{deadline_field} ASC
```

## 通知机制 (Notification Mechanism)

转派成功后，系统自动发送通知给新处理人：

```python
await notification_service.send_notification(
    db=db,
    user_ids=[to_user_id],
    title="任务转派通知",
    content=f"管理员已将 {from_user.full_name} 的 {success_count} 个待办任务转派给您，请及时处理。",
    notification_type="system",
    link="/tasks/my-tasks"
)
```

## 错误处理 (Error Handling)

### 用户验证
- 原处理人不存在：抛出 `ValueError("原处理人不存在: user_id={from_user_id}")`
- 新处理人不存在：抛出 `ValueError("新处理人不存在: user_id={to_user_id}")`

### 任务ID格式验证
- 无效格式：记录到 `failed_count` 和 `details`，继续处理其他任务
- 格式：`table_name:record_id`

### 数据库操作异常
- 单个业务表操作失败：记录警告日志，继续处理其他表
- 不中断整个转派流程

## Phase 1 注意事项 (Phase 1 Notes)

**当前状态**:
- 所有业务表配置的 `enabled` 字段均为 `False`
- 业务表尚未创建（SCAR、PPAP、审核等）
- API 接口已实现，但实际转派和统计结果为空

**后续启用步骤**:
1. 创建业务表（如 `scar_reports`, `ppap_submissions` 等）
2. 确保业务表包含必要字段：
   - `current_handler_id` 或对应的处理人字段
   - `deadline` 或对应的截止时间字段
   - `status` 状态字段
   - `{number_field}` 单据编号字段
3. 将对应配置的 `enabled` 设置为 `True`
4. 系统将自动开始聚合和统计这些表的任务

## 测试覆盖 (Test Coverage)

### API 测试 (API Tests)
**文件**: `backend/tests/test_admin_tasks_api.py`

测试场景：
- ✅ 成功批量转派任务
- ✅ 转派指定任务
- ✅ 原处理人不存在
- ✅ 新处理人不存在
- ✅ 获取任务统计信息
- ✅ 按部门统计
- ✅ 按人员统计
- ✅ 获取逾期任务清单
- ✅ 未认证用户访问

### 服务层测试 (Service Tests)
**文件**: `backend/tests/test_task_reassignment_service.py`

测试场景：
- ✅ 转派所有任务
- ✅ 转派指定任务
- ✅ 用户验证
- ✅ 统计功能
- ✅ 无效任务ID格式处理

## 权限控制 (Permission Control)

**当前状态**: 权限检查已预留，但未实现

**TODO**:
```python
# 在 API 路由中添加管理员权限检查
if not current_user.is_admin:
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="仅管理员可执行任务转派操作"
    )
```

**建议实现方式**:
1. 在 `User` 模型中添加 `is_admin` 属性或角色字段
2. 在 `get_current_user` 依赖中验证用户角色
3. 创建 `require_admin` 依赖注入装饰器

## 性能优化建议 (Performance Optimization)

### 1. 批量操作优化
- 使用 `ANY(:record_ids)` 进行批量更新
- 避免逐条更新记录

### 2. 统计查询优化
- 为 `handler_field` 和 `deadline_field` 创建索引
- 使用 `JOIN` 而非子查询
- 考虑使用物化视图缓存统计结果

### 3. 缓存策略
- 统计结果可缓存 5-10 分钟
- 使用 Redis 缓存部门和人员统计
- 转派操作后清除相关缓存

## 扩展性设计 (Extensibility)

### 添加新业务表
只需在 `BUSINESS_TABLES` 配置中添加新条目：

```python
{
    "table": "new_business_table",
    "handler_field": "assignee_id",
    "task_type": "新业务类型",
    "deadline_field": "due_date",
    "number_field": "ticket_number",
    "enabled": True
}
```

### 自定义统计维度
可扩展 `get_task_statistics()` 方法，添加：
- 按产品线统计
- 按客户统计
- 按优先级统计
- 按任务类型统计

## 相关需求 (Related Requirements)

- **Requirements 2.3.1**: 全局任务统计与监控
- **Requirements 2.2.3**: 待办任务聚合

## 相关文档 (Related Documentation)

- [任务聚合服务实现](./TASK_AGGREGATOR_IMPLEMENTATION.md)
- [通知服务实现](./NOTIFICATION_SERVICE_IMPLEMENTATION.md)
- [设计文档](./.kiro/specs/qms-foundation-and-auth/design.md)

## 更新日志 (Changelog)

### 2024-01-XX - Initial Implementation
- ✅ 实现批量任务转派 API
- ✅ 实现全局任务统计 API
- ✅ 创建任务转派服务
- ✅ 添加数据模型和 Schema
- ✅ 编写单元测试和集成测试
- ✅ 编写实现文档

