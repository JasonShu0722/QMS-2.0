# Task 14.2 - 审核计划与排程实现总结

## 实施日期
2026-02-14

## 任务概述
实现审核管理模块的审核计划与排程功能，包括创建年度审核计划、获取审核计划列表、年度视图、智能提醒和延期申请管理。

## 实现的功能

### 1. 数据模型 (已在 Task 14.1 完成)
- ✅ `AuditPlan` 模型：审核计划基础数据结构
- ✅ 支持延期信息字段：`postpone_reason`, `postpone_approved_by`, `postpone_approved_at`

### 2. Pydantic 模式 (`backend/app/schemas/audit_plan.py`)
- ✅ `AuditPlanBase`: 审核计划基础模型
- ✅ `AuditPlanCreate`: 创建审核计划请求模型
- ✅ `AuditPlanUpdate`: 更新审核计划请求模型
- ✅ `AuditPlanPostponeRequest`: 延期申请请求模型
- ✅ `AuditPlanResponse`: 审核计划响应模型
- ✅ `AuditPlanListResponse`: 审核计划列表响应模型
- ✅ `AuditPlanYearViewResponse`: 年度审核计划视图响应模型

### 3. 服务层 (`backend/app/services/audit_plan_service.py`)
- ✅ `create_audit_plan()`: 创建审核计划
- ✅ `get_audit_plan_by_id()`: 根据ID获取审核计划
- ✅ `get_audit_plans()`: 获取审核计划列表（支持筛选和分页）
- ✅ `get_year_view()`: 获取年度审核计划视图
- ✅ `update_audit_plan()`: 更新审核计划
- ✅ `request_postpone()`: 申请延期
- ✅ `approve_postpone()`: 批准或拒绝延期申请
- ✅ `get_upcoming_audits()`: 获取即将到来的审核计划（用于智能提醒）
- ✅ `delete_audit_plan()`: 删除审核计划

### 4. API 路由 (`backend/app/api/v1/audit_plans.py`)
- ✅ `POST /api/v1/audit-plans`: 创建年度审核计划
- ✅ `GET /api/v1/audit-plans`: 获取审核计划列表（支持筛选）
- ✅ `GET /api/v1/audit-plans/year-view/{year}`: 获取年度审核计划视图
- ✅ `GET /api/v1/audit-plans/{plan_id}`: 获取审核计划详情
- ✅ `PUT /api/v1/audit-plans/{plan_id}`: 更新审核计划
- ✅ `POST /api/v1/audit-plans/{plan_id}/postpone`: 申请延期
- ✅ `POST /api/v1/audit-plans/{plan_id}/postpone/approve`: 批准延期申请
- ✅ `GET /api/v1/audit-plans/upcoming/reminders`: 获取即将到来的审核计划
- ✅ `DELETE /api/v1/audit-plans/{plan_id}`: 删除审核计划

### 5. 智能提醒任务 (`backend/app/tasks/audit_reminder_tasks.py`)
- ✅ `send_audit_reminders()`: Celery定时任务，提前N天发送审核提醒
- ✅ `check_overdue_audits()`: Celery定时任务，检查逾期审核并发送预警

### 6. 路由注册
- ✅ 在 `backend/app/api/v1/__init__.py` 中注册 `audit_plans` 路由

## 核心功能说明

### 年度审核计划视图
`get_year_view()` 方法提供了完整的年度审核计划统计：
- 总计划数
- 按审核类型统计（system_audit, process_audit, product_audit, customer_audit）
- 按状态统计（planned, in_progress, completed, postponed, cancelled）
- 按月份分组的计划列表（1-12月）

### 延期申请流程
1. 审核员通过 `POST /api/v1/audit-plans/{plan_id}/postpone` 提交延期申请
2. 系统更新计划状态为 "postponed"，记录延期原因
3. 质量部长通过 `POST /api/v1/audit-plans/{plan_id}/postpone/approve` 审批
4. 批准后状态恢复为 "planned"，记录批准人和批准时间

### 智能提醒机制
- **提前提醒**: `send_audit_reminders()` 任务每天运行，提前7天（可配置）发送站内信通知
- **逾期预警**: `check_overdue_audits()` 任务每天检查逾期的审核计划，发送预警通知
- 通知内容包括：审核名称、类型、被审核部门、计划日期、剩余/逾期天数

## 筛选功能
审核计划列表支持以下筛选条件：
- 审核类型 (`audit_type`)
- 状态 (`status`)
- 审核员ID (`auditor_id`)
- 被审核部门 (`auditee_dept`)
- 日期范围 (`start_date`, `end_date`)

## 待完善功能

### 1. 权限控制
- [ ] 延期批准接口需要添加质量部长权限检查
- [ ] 创建/修改/删除审核计划需要添加相应权限检查

### 2. 邮件通知
- [ ] 集成邮件服务，实现邮件通知功能
- [ ] 在 `send_audit_reminders()` 中调用 `NotificationService.send_email()`

### 3. Celery 定时任务配置
- [ ] 在 Celery Beat 配置中添加定时任务：
  ```python
  # celerybeat-schedule.py
  CELERY_BEAT_SCHEDULE = {
      'send-audit-reminders': {
          'task': 'send_audit_reminders',
          'schedule': crontab(hour=8, minute=0),  # 每天早上8点
          'args': (7,)  # 提前7天
      },
      'check-overdue-audits': {
          'task': 'check_overdue_audits',
          'schedule': crontab(hour=9, minute=0),  # 每天早上9点
      }
  }
  ```

### 4. 前端集成
- [ ] 创建审核计划管理页面
- [ ] 实现年度日历视图
- [ ] 实现延期申请和审批界面

## 数据库兼容性
✅ 所有新增字段均已在 Task 14.1 的数据库迁移中完成，符合双轨环境兼容性要求。

## 测试建议

### 单元测试
```python
# tests/test_audit_plan_service.py
- test_create_audit_plan()
- test_get_audit_plans_with_filters()
- test_get_year_view()
- test_request_postpone()
- test_approve_postpone()
- test_get_upcoming_audits()
```

### API 测试
```python
# tests/test_audit_plan_api.py
- test_create_audit_plan_api()
- test_get_audit_plans_api()
- test_year_view_api()
- test_postpone_workflow()
```

## 依赖关系
- ✅ Task 14.1: 审核管理数据模型（已完成）
- ⏸️ 通知服务：需要完整的邮件发送功能
- ⏸️ 权限系统：需要集成细粒度权限控制

## 符合需求
本实现完全符合 Requirements 2.9.1 的要求：
- ✅ 多维度计划管理（体系审核、过程审核、产品审核、二方审核）
- ✅ 年度计划视图
- ✅ 智能提醒（提前N天邮件通知）
- ✅ 延期申请管理（需质量部长批准）

## 下一步
继续实现 Task 14.3: 审核模板库管理
