# Task 14.6: 客户审核特别管理实现文档

## 实施概述

本任务实现了客户审核（二方审核）的特别管理功能，包括客户来厂审核台账管理和问题闭环跟踪。

## 实施内容

### 1. 数据模型 (Models)

**CustomerAudit 模型** - 已存在于 `backend/app/models/audit.py`
- 客户审核台账的核心数据模型
- 包含客户信息、审核类型、审核结果、问题清单等字段
- 支持状态管理：completed（已完成）、issue_open（问题待关闭）、issue_closed（问题已关闭）

### 2. 数据验证模型 (Schemas)

**文件**: `backend/app/schemas/customer_audit.py`

创建的 Schema 类：
- `CustomerAuditCreate`: 创建客户审核台账
- `CustomerAuditUpdate`: 更新客户审核台账
- `CustomerAuditResponse`: 客户审核响应
- `CustomerAuditListResponse`: 客户审核列表响应
- `CustomerAuditQuery`: 客户审核查询参数
- `CustomerAuditIssueTaskCreate`: 创建客户审核问题任务
- `CustomerAuditIssueTaskResponse`: 客户审核问题任务响应

### 3. 业务逻辑层 (Services)

**文件**: `backend/app/services/customer_audit_service.py`

实现的核心功能：

#### 3.1 客户审核台账管理
- `create_customer_audit()`: 创建客户审核台账
- `get_customer_audit_by_id()`: 根据ID获取客户审核记录
- `update_customer_audit()`: 更新客户审核台账
- `query_customer_audits()`: 查询客户审核列表（支持多条件筛选和分页）

#### 3.2 问题闭环管理
- `create_issue_task_from_customer_audit()`: 从客户问题清单创建内部闭环任务
  - 依据客户指摘问题清单，在系统内部创建对应的NC任务条目
  - 确保不遗漏任何一个客户提出的整改项
  - 自动更新客户审核状态为"问题待关闭"
  
- `get_customer_audit_issue_tasks()`: 获取客户审核关联的所有问题任务
- `check_all_issues_closed()`: 检查客户审核的所有问题是否已关闭
- `auto_update_customer_audit_status()`: 自动更新客户审核状态
  - 当所有问题任务都关闭后，自动将客户审核状态更新为"问题已关闭"

### 4. API 路由 (Routes)

**文件**: `backend/app/api/v1/customer_audits.py`

实现的 API 端点：

#### 4.1 客户审核台账管理
- `POST /api/v1/customer-audits`: 创建客户审核台账
- `GET /api/v1/customer-audits`: 获取客户审核台账列表（支持筛选和分页）
- `GET /api/v1/customer-audits/{audit_id}`: 获取客户审核台账详情
- `PUT /api/v1/customer-audits/{audit_id}`: 更新客户审核台账

#### 4.2 问题闭环管理
- `POST /api/v1/customer-audits/{audit_id}/issue-tasks`: 创建客户审核问题任务
- `GET /api/v1/customer-audits/{audit_id}/issue-tasks`: 获取客户审核问题任务列表
- `POST /api/v1/customer-audits/{audit_id}/check-status`: 检查并更新客户审核状态

### 5. 辅助服务

**文件**: `backend/app/services/audit_log_service.py`

创建了操作日志服务，用于记录所有关键操作：
- `log_operation()`: 记录操作日志
  - 支持记录操作前后数据快照
  - 记录操作人、操作类型、目标对象等信息

### 6. 路由注册

**文件**: `backend/app/api/v1/__init__.py`

已将 `customer_audits` 路由注册到 API v1 路由器中。

## 核心功能说明

### 1. 客户审核台账管理

**功能描述**：
- 记录客户来厂审核的基本信息（客户名称、审核类型、审核日期、最终结果等）
- 支持上传客户提供的问题整改清单（Excel等格式）
- 支持上传审核报告文件
- 自动记录创建人和创建时间

**审核类型**：
- system: 体系审核
- process: 过程审核
- product: 产品审核
- qualification: 资格审核
- potential_supplier: 潜在供应商拜访

**最终结果**：
- passed: 通过
- conditional_passed: 有条件通过
- failed: 未通过
- pending: 待定

**状态管理**：
- completed: 已完成（初始状态）
- issue_open: 问题待关闭（创建问题任务后自动更新）
- issue_closed: 问题已关闭（所有问题任务关闭后自动更新）

### 2. 内部闭环任务创建

**功能描述**：
- 依据客户指摘问题清单，在系统内部创建对应的NC任务条目
- 确保不遗漏任何一个客户提出的整改项
- 支持指派责任部门和责任人
- 设定整改期限和优先级

**实现机制**：
- 复用 `AuditNC` 模型存储客户审核问题任务
- 使用负数 `audit_id`（-customer_audit_id）作为标识，区分内部审核NC和客户审核问题
- 自动将客户审核状态更新为"问题待关闭"

**优先级**：
- low: 低
- medium: 中
- high: 高
- critical: 紧急

### 3. 自动状态更新

**功能描述**：
- 系统自动检查客户审核关联的所有问题任务是否已关闭
- 如果所有问题已关闭，自动将客户审核状态更新为"问题已关闭"
- 提供手动触发检查的API端点

## 数据库设计

### CustomerAudit 表结构

```sql
CREATE TABLE customer_audits (
    id SERIAL PRIMARY KEY,
    customer_name VARCHAR(255) NOT NULL,
    audit_type VARCHAR(50) NOT NULL,
    audit_date TIMESTAMP NOT NULL,
    final_result VARCHAR(50) NOT NULL,
    score INTEGER,
    external_issue_list_path VARCHAR(500),
    internal_contact VARCHAR(255),
    audit_report_path VARCHAR(500),
    summary TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'completed',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER
);
```

### 索引
- `ix_customer_audits_id`: 主键索引
- `ix_customer_audits_customer_name`: 客户名称索引（支持模糊搜索）
- `ix_customer_audits_audit_date`: 审核日期索引（支持日期范围查询）
- `ix_customer_audits_status`: 状态索引（支持状态筛选）

## API 使用示例

### 1. 创建客户审核台账

```bash
POST /api/v1/customer-audits
Content-Type: application/json

{
  "customer_name": "某汽车主机厂",
  "audit_type": "system",
  "audit_date": "2024-01-15T09:00:00",
  "final_result": "conditional_passed",
  "score": 85,
  "external_issue_list_path": "/uploads/customer_audits/issues_20240115.xlsx",
  "internal_contact": "张三",
  "audit_report_path": "/uploads/customer_audits/report_20240115.pdf",
  "summary": "客户对体系运行基本满意，发现3项不符合项需整改"
}
```

### 2. 查询客户审核列表

```bash
GET /api/v1/customer-audits?customer_name=汽车&status=issue_open&page=1&page_size=20
```

### 3. 创建客户审核问题任务

```bash
POST /api/v1/customer-audits/1/issue-tasks
Content-Type: application/json

{
  "customer_audit_id": 1,
  "issue_description": "生产现场5S管理不到位，工具摆放混乱",
  "responsible_dept": "生产部",
  "assigned_to": 10,
  "deadline": "2024-02-15T17:00:00",
  "priority": "high"
}
```

### 4. 检查并更新客户审核状态

```bash
POST /api/v1/customer-audits/1/check-status
```

## 权限要求

根据 2.1.1 权限控制体系，本模块需要配置以下权限：

- **客户审核管理-录入**：创建客户审核台账、创建问题任务
- **客户审核管理-查阅**：查看客户审核列表和详情、查看问题任务
- **客户审核管理-修改**：更新客户审核台账
- **客户审核管理-删除**：删除客户审核记录（如需要）
- **客户审核管理-导出**：导出客户审核数据（如需要）

## 与其他模块的集成

### 1. 与审核管理模块的关系
- 复用 `AuditNC` 模型存储客户审核问题任务
- 客户审核问题任务的整改流程与内部审核NC流程一致
- 可以在审核NC管理界面统一查看和处理

### 2. 与操作日志的集成
- 所有关键操作（创建、更新、删除）都会记录操作日志
- 支持审计追溯

### 3. 与通知系统的集成（预留）
- 可以在创建问题任务时发送通知给责任人
- 可以在问题逾期时发送预警通知
- 可以在所有问题关闭时发送完成通知

## 后续扩展建议

### 1. 文件上传功能
- 实现客户问题清单（Excel）的上传和解析
- 实现审核报告文件的上传和存储
- 支持批量导入问题任务

### 2. 问题任务批量操作
- 支持从Excel批量导入问题任务
- 支持批量指派责任人
- 支持批量设置期限

### 3. 统计分析功能
- 客户审核通过率统计
- 问题类型分布分析
- 整改及时率统计
- 客户满意度趋势分析

### 4. 移动端支持
- 优化移动端界面显示
- 支持移动端查看审核报告
- 支持移动端处理问题任务

## 测试建议

### 1. 单元测试
- 测试客户审核台账的创建、查询、更新
- 测试问题任务的创建和关联
- 测试状态自动更新逻辑

### 2. 集成测试
- 测试完整的问题闭环流程
- 测试与审核NC模块的集成
- 测试操作日志记录

### 3. 性能测试
- 测试大量客户审核记录的查询性能
- 测试批量创建问题任务的性能

## 注意事项

1. **数据一致性**：客户审核问题任务使用负数audit_id存储在AuditNC表中，需要在查询时注意区分
2. **状态同步**：确保问题任务状态变更时及时更新客户审核状态
3. **权限控制**：严格按照权限矩阵控制各项操作的访问权限
4. **操作日志**：所有关键操作都需要记录操作日志，便于审计追溯

## 完成状态

✅ 数据模型（已存在）
✅ Schema定义
✅ 服务层实现
✅ API路由实现
✅ 操作日志服务
✅ 路由注册
✅ 文档编写

## 相关文件

- Models: `backend/app/models/audit.py`
- Schemas: `backend/app/schemas/customer_audit.py`
- Services: `backend/app/services/customer_audit_service.py`
- API Routes: `backend/app/api/v1/customer_audits.py`
- Audit Log: `backend/app/services/audit_log_service.py`
- Router Registration: `backend/app/api/v1/__init__.py`
- Migration: `backend/alembic/versions/2026_02_14_1800-016_add_audit_management_models.py`
