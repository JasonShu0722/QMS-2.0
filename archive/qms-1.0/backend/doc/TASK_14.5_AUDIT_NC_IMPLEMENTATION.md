# Task 14.5: 审核NC问题整改与闭环实现

## 实施概述

本任务实现了审核不符合项（NC）的完整闭环管理流程，包括指派、响应、验证、关闭和逾期升级功能。

## 实现的功能

### 1. NC指派功能
- **接口**: `POST /api/v1/audit-nc/{nc_id}/assign`
- **功能**: 审核员将NC指派给责任板块
- **实现逻辑**:
  - 验证NC记录存在且状态为open或rejected
  - 验证被指派人存在
  - 更新指派信息和整改期限
  - 状态变更为assigned
  - 发送通知给被指派人（预留接口）

### 2. NC响应功能
- **接口**: `POST /api/v1/audit-nc/{nc_id}/response`
- **功能**: 责任人填写根本原因和纠正措施
- **实现逻辑**:
  - 验证NC已指派给当前用户
  - 填写根本原因（最少10字）
  - 填写纠正措施（最少10字）
  - 上传整改证据文件
  - 状态变更为submitted（待验证）
  - 通知审核员进行验证（预留接口）

### 3. NC验证功能
- **接口**: `POST /api/v1/audit-nc/{nc_id}/verify`
- **功能**: 审核员验证整改措施的有效性
- **实现逻辑**:
  - 验证NC状态为submitted
  - 验证当前用户是审核员
  - 填写验证意见（最少5字）
  - 如果验证通过，状态变更为verified
  - 如果验证不通过，状态变更为rejected，需要责任人重新提交
  - 通知责任人验证结果（预留接口）

### 4. NC关闭功能
- **接口**: `POST /api/v1/audit-nc/{nc_id}/close`
- **功能**: 审核员关闭已验证的NC
- **实现逻辑**:
  - 验证NC状态为verified
  - 验证当前用户是审核员
  - 填写关闭备注（可选）
  - 状态变更为closed
  - 记录关闭时间
  - 检查该审核的所有NC是否都已关闭，如果是则更新审核状态为completed

### 5. NC查询功能
- **接口**: `GET /api/v1/audit-nc/{nc_id}` - 获取NC详情
- **接口**: `GET /api/v1/audit-nc` - 获取NC列表
- **功能**: 支持多维度筛选和分页查询
- **筛选条件**:
  - 按审核执行记录ID筛选
  - 按指派人筛选
  - 按责任部门筛选
  - 按验证状态筛选
  - 按是否逾期筛选
- **计算字段**:
  - is_overdue: 是否逾期
  - remaining_hours: 剩余小时数

### 6. 逾期升级功能（Celery定时任务）
- **任务**: `app.tasks.audit_nc_tasks.check_overdue_ncs`
- **执行时间**: 每天早上09:00和下午15:00
- **功能**: 检查逾期NC并发送升级通知
- **实现逻辑**:
  - 查询所有逾期的NC（deadline < 当前时间 且 状态不是closed/verified）
  - 计算逾期天数
  - 发送升级通知给审核员（预留接口）
  - 发送升级通知给责任人（预留接口）
  - 发送邮件通知（预留接口）
  - 记录升级日志

## 文件结构

```
backend/
├── app/
│   ├── api/
│   │   └── v1/
│   │       ├── __init__.py (已更新：注册audit_ncs路由)
│   │       └── audit_ncs.py (新建：NC管理API路由)
│   ├── schemas/
│   │   └── audit_nc.py (新建：NC数据模型)
│   ├── services/
│   │   └── audit_nc_service.py (新建：NC业务逻辑服务)
│   ├── tasks/
│   │   └── audit_nc_tasks.py (新建：NC逾期升级定时任务)
│   └── core/
│       └── celery_app.py (已更新：添加NC定时任务配置)
└── TASK_14.5_AUDIT_NC_IMPLEMENTATION.md (本文档)
```

## NC状态流转图

```
open (初始状态，审核结束后自动生成)
  ↓
assigned (审核员指派给责任人)
  ↓
submitted (责任人提交整改措施)
  ↓
verified (审核员验证通过) / rejected (审核员驳回，返回assigned状态)
  ↓
closed (审核员关闭NC)
```

## API接口列表

| 方法 | 路径 | 功能 | 权限要求 |
|------|------|------|----------|
| POST | /api/v1/audit-nc/{nc_id}/assign | 指派NC | 审核员 |
| POST | /api/v1/audit-nc/{nc_id}/response | 提交整改响应 | 被指派人 |
| POST | /api/v1/audit-nc/{nc_id}/verify | 验证整改措施 | 审核员 |
| POST | /api/v1/audit-nc/{nc_id}/close | 关闭NC | 审核员 |
| GET | /api/v1/audit-nc/{nc_id} | 获取NC详情 | 所有用户 |
| GET | /api/v1/audit-nc | 获取NC列表 | 所有用户 |

## 数据模型

### AuditNC (已存在于 app/models/audit.py)

```python
class AuditNC(Base):
    __tablename__ = "audit_ncs"
    
    id: int  # 主键
    audit_id: int  # 审核执行记录ID
    nc_item: str  # 不符合条款
    nc_description: str  # 不符合描述
    evidence_photo_path: str  # 证据照片路径
    responsible_dept: str  # 责任部门
    assigned_to: int  # 指派给(用户ID)
    root_cause: str  # 根本原因
    corrective_action: str  # 纠正措施
    corrective_evidence: str  # 整改证据文件路径
    verification_status: str  # 验证状态
    verified_by: int  # 验证人ID
    verified_at: datetime  # 验证时间
    verification_comment: str  # 验证意见
    deadline: datetime  # 整改期限
    closed_at: datetime  # 关闭时间
    created_at: datetime  # 创建时间
    updated_at: datetime  # 更新时间
    created_by: int  # 创建人ID
```

## 业务规则

### 1. 权限控制
- **指派NC**: 只有审核员可以指派
- **提交响应**: 只有被指派人可以提交
- **验证NC**: 只有审核员可以验证
- **关闭NC**: 只有审核员可以关闭

### 2. 状态流转规则
- **open → assigned**: 审核员指派后
- **assigned → submitted**: 责任人提交响应后
- **submitted → verified**: 审核员验证通过后
- **submitted → rejected**: 审核员驳回后
- **rejected → assigned**: 自动返回assigned状态，等待责任人重新提交
- **verified → closed**: 审核员关闭后

### 3. 逾期判定规则
- 当前时间 > deadline 且 状态不是 closed/verified 时，判定为逾期
- 逾期NC会在每天09:00和15:00自动发送升级通知

### 4. 审核状态联动
- 当审核的所有NC都关闭后，审核执行记录状态自动从"nc_open"变更为"completed"

## 集成点

### 1. 与审核执行模块的集成
- 审核执行提交检查表时，自动创建NC记录（已在audit_execution_service.py中实现）
- NC全部关闭后，自动更新审核状态

### 2. 与通知模块的集成（预留）
- NC指派时通知责任人
- NC提交响应时通知审核员
- NC验证结果通知责任人
- NC逾期时升级通知

### 3. 与邮件模块的集成（预留）
- NC逾期时发送邮件通知

## 测试建议

### 1. 单元测试
- 测试NC指派逻辑
- 测试NC响应提交逻辑
- 测试NC验证逻辑
- 测试NC关闭逻辑
- 测试逾期判定逻辑

### 2. 集成测试
- 测试完整的NC闭环流程
- 测试权限控制
- 测试状态流转
- 测试审核状态联动

### 3. 定时任务测试
- 测试逾期NC检查任务
- 测试升级通知发送

## 后续优化建议

1. **通知功能完善**: 实现与NotificationService的集成，发送站内信和邮件通知
2. **权限细化**: 基于2.1.1的权限矩阵，实现更细粒度的权限控制
3. **数据统计**: 添加NC统计分析功能，如按部门统计NC数量、按类型统计等
4. **移动端优化**: 优化移动端NC处理界面，支持现场快速响应
5. **批量操作**: 支持批量指派、批量关闭等操作
6. **导出功能**: 支持导出NC清单为Excel

## 依赖关系

- **依赖模块**: 
  - app.models.audit (AuditNC, AuditExecution)
  - app.models.user (User)
  - app.core.auth (get_current_user)
  - app.core.database (get_db)
  - app.core.celery_app (celery_app)

- **被依赖模块**: 
  - 前端NC管理界面
  - 审核管理模块

## 配置要求

### Celery Beat配置
确保Celery Beat服务正常运行，以执行定时任务：

```bash
# 启动Celery Worker
celery -A app.core.celery_app worker --loglevel=info

# 启动Celery Beat
celery -A app.core.celery_app beat --loglevel=info
```

### 环境变量
确保以下环境变量已配置：
- DATABASE_URL: 数据库连接URL
- REDIS_URL: Redis连接URL（用于Celery）

## 完成状态

✅ NC指派功能已实现
✅ NC响应功能已实现
✅ NC验证功能已实现
✅ NC关闭功能已实现
✅ NC查询功能已实现
✅ 逾期升级定时任务已实现
✅ API路由已注册
✅ Celery定时任务已配置
✅ 代码无诊断错误

## 需求对应关系

本实现对应以下需求：
- Requirements: 2.9.3 (审核管理 - 问题整改与闭环)
- Product.md: 2.9.3 (审核管理 - 问题整改与闭环)

所有子任务已完成：
- ✅ 实现审核结束后自动生成 NC 待办任务
- ✅ 实现 POST /api/v1/audit-nc/{id}/assign 指派 NC 给责任板块
- ✅ 实现 POST /api/v1/audit-nc/{id}/response 责任人填写原因和措施
- ✅ 实现 POST /api/v1/audit-nc/{id}/verify 审核员验证有效性
- ✅ 实现 POST /api/v1/audit-nc/{id}/close 关闭 NC
- ✅ 实现逾期升级（Celery 定时任务）
