# Task 14.1: 审核管理数据模型设计 - 实施总结

## 任务概述
创建审核管理模块的数据模型，支持内部审核计划、模板库、执行记录、不符合项跟踪及客户审核管理。

## 实施内容

### 1. 数据模型创建 (`backend/app/models/audit.py`)

#### 1.1 AuditPlan（审核计划模型）
- **用途**: 管理年度审核计划（体系审核、过程审核、产品审核、客户审核）
- **核心字段**:
  - `audit_type`: 审核类型（system_audit, process_audit, product_audit, customer_audit）
  - `audit_name`: 审核名称
  - `planned_date`: 计划审核日期
  - `auditor_id`: 主审核员ID
  - `auditee_dept`: 被审核部门
  - `status`: 状态（planned, in_progress, completed, postponed, cancelled）
  - `postpone_reason`, `postpone_approved_by`, `postpone_approved_at`: 延期管理字段

#### 1.2 AuditTemplate（审核模板模型）
- **用途**: 存储审核检查表模板（VDA 6.3, VDA 6.5, IATF16949等）
- **核心字段**:
  - `template_name`: 模板名称（唯一）
  - `audit_type`: 适用审核类型
  - `checklist_items`: 检查表条款列表（JSON格式）
  - `scoring_rules`: 评分规则（JSON格式，包含评分方法、等级划分、降级规则）
  - `is_builtin`: 是否为系统内置模板
  - `is_active`: 是否启用

#### 1.3 AuditExecution（审核执行记录模型）
- **用途**: 存储实际执行的审核记录、检查结果和最终得分
- **核心字段**:
  - `audit_plan_id`: 关联审核计划（外键）
  - `template_id`: 关联审核模板（外键）
  - `audit_date`: 实际审核日期
  - `auditor_id`: 主审核员ID
  - `audit_team`: 审核组成员列表（JSON格式）
  - `checklist_results`: 检查表结果（JSON格式，包含每个条款的评分、证据照片等）
  - `final_score`: 最终得分（百分制）
  - `grade`: 等级评定（A/B/C/D）
  - `audit_report_path`: 审核报告文件路径
  - `status`: 状态（draft, completed, nc_open, nc_closed）

#### 1.4 AuditNC（审核不符合项模型）
- **用途**: 管理审核中发现的不符合项及整改跟踪
- **核心字段**:
  - `audit_id`: 关联审核执行记录（外键，级联删除）
  - `nc_item`: 不符合条款
  - `nc_description`: 不符合描述
  - `evidence_photo_path`: 证据照片路径
  - `responsible_dept`: 责任部门
  - `assigned_to`: 指派给（用户ID）
  - `root_cause`: 根本原因
  - `corrective_action`: 纠正措施
  - `corrective_evidence`: 整改证据文件路径
  - `verification_status`: 验证状态（open, submitted, verified, closed, rejected）
  - `verified_by`, `verified_at`, `verification_comment`: 验证信息
  - `deadline`: 整改期限
  - `closed_at`: 关闭时间

#### 1.5 CustomerAudit（客户审核模型）
- **用途**: 管理客户来厂审核的台账和问题跟踪
- **核心字段**:
  - `customer_name`: 客户名称
  - `audit_type`: 审核类型（system, process, product, qualification, potential_supplier）
  - `audit_date`: 审核日期
  - `final_result`: 最终结果（passed, conditional_passed, failed, pending）
  - `score`: 审核得分（如果客户提供）
  - `external_issue_list_path`: 客户提供的问题整改清单文件路径
  - `internal_contact`: 内部接待人员
  - `audit_report_path`: 审核报告文件路径
  - `status`: 状态（completed, issue_open, issue_closed）

### 2. 数据库迁移脚本 (`backend/alembic/versions/2026_02_14_1800-016_add_audit_management_models.py`)

#### 迁移内容
- 创建5个数据表：
  1. `audit_plans` - 审核计划表
  2. `audit_templates` - 审核模板表
  3. `audit_executions` - 审核执行记录表
  4. `audit_ncs` - 审核不符合项表
  5. `customer_audits` - 客户审核台账表

#### 索引优化
- 为所有主键创建索引
- 为常用查询字段创建索引：
  - `audit_type`, `planned_date`, `auditor_id`, `status` (audit_plans)
  - `template_name`, `audit_type`, `is_active` (audit_templates)
  - `audit_plan_id`, `template_id`, `audit_date`, `auditor_id`, `status` (audit_executions)
  - `audit_id`, `assigned_to`, `verification_status`, `deadline` (audit_ncs)
  - `customer_name`, `audit_date`, `status` (customer_audits)

#### 外键关系
- `audit_executions.audit_plan_id` -> `audit_plans.id` (CASCADE)
- `audit_executions.template_id` -> `audit_templates.id` (RESTRICT)
- `audit_ncs.audit_id` -> `audit_executions.id` (CASCADE)

#### 数据库兼容性
- 所有字段遵循非破坏性原则
- 新增字段均为 `nullable=True` 或带有 `server_default`
- 确保双轨环境（Preview/Stable）数据一致性

### 3. 模型导出更新 (`backend/app/models/__init__.py`)
- 添加审核管理模型的导入和导出
- 更新 `__all__` 列表，包含所有新模型

## 技术特性

### 1. JSON字段设计
- **checklist_items**: 灵活存储检查表条款（支持多层级结构）
- **scoring_rules**: 存储复杂的评分规则（支持VDA 6.3降级规则等）
- **checklist_results**: 存储审核结果（包含评分、证据照片路径等）
- **audit_team**: 存储审核组成员信息

### 2. 状态管理
- **审核计划状态**: planned -> in_progress -> completed/postponed/cancelled
- **审核执行状态**: draft -> completed -> nc_open -> nc_closed
- **NC验证状态**: open -> submitted -> verified/rejected -> closed
- **客户审核状态**: completed -> issue_open -> issue_closed

### 3. 审计字段
- 所有模型包含标准审计字段：
  - `created_at`: 创建时间（自动设置）
  - `updated_at`: 更新时间（自动更新）
  - `created_by`: 创建人ID

### 4. 数据完整性
- 使用外键约束确保数据一致性
- 级联删除策略：删除审核计划时自动删除相关执行记录和NC
- 限制删除策略：模板被使用时不允许删除

## 业务功能支持

### 2.9.1 审核计划与排程
- ✅ 支持多维度计划管理（体系、过程、产品、客户审核）
- ✅ 支持延期申请和审批流程
- ✅ 预留智能提醒功能接口

### 2.9.2 审核实施与数字化检查表
- ✅ 支持模板库管理（内置标准模板及自定义模板）
- ✅ 支持在线打分和现场拍照上传
- ✅ 支持自动评分和报告生成

### 2.9.3 问题整改与闭环
- ✅ 支持NC自动生成和任务指派
- ✅ 支持整改流程跟踪（原因分析、措施制定、验证关闭）
- ✅ 支持逾期监控（通过deadline字段）

### 2.9.4 二方审核特别管理
- ✅ 支持客户审核台账管理
- ✅ 支持外部问题清单上传
- ✅ 支持内部闭环任务创建

## 下一步工作

### Phase 1（必须完成）
1. **Task 14.2**: 实现审核计划与排程API
2. **Task 14.3**: 实现审核模板库管理API
3. **Task 14.4**: 实现审核实施与数字化检查表API
4. **Task 14.5**: 实现问题整改与闭环API
5. **Task 14.6**: 实现二方审核特别管理API
6. **Task 14.7**: 实现审核管理前端页面
7. **Task 14.8**: 编写审核管理模块测试（可选）

### 技术债务
- 需要实现Celery定时任务进行逾期NC的自动升级
- 需要实现审核报告的PDF生成功能（含雷达图）
- 需要实现移动端全屏模式的检查表界面

## 验证清单

- [x] 数据模型创建完成
- [x] 所有模型包含必要的字段和约束
- [x] 数据库迁移脚本创建完成
- [x] 迁移脚本遵循非破坏性原则
- [x] 模型导出更新完成
- [x] Python语法检查通过
- [x] 迁移脚本语法检查通过

## 参考文档
- Requirements: 2.9.1, 2.9.2, 2.9.3, 2.9.4
- Design: `.kiro/specs/qms-foundation-and-auth/design.md`
- Product: `.kiro/steering/product.md` (Section 2.9)
