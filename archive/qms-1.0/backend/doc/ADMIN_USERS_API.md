# 用户管理 API 实现文档

## 概述

本文档描述了任务 3.6 "实现用户审核管理 API" 的实现细节。该模块提供了管理员对用户进行审核、冻结、解冻和密码重置的完整功能。

## 实现的文件

### 1. 核心服务层

#### `backend/app/services/notification_service.py`
通知服务模块，提供以下功能：
- **邮件发送**：使用 aiosmtplib 异步发送邮件
- **临时密码生成**：生成符合复杂度要求的临时密码（12位，包含大写、小写、数字、特殊字符）
- **通知模板**：
  - `send_approval_notification()`: 账号激活通知
  - `send_rejection_notification()`: 账号驳回通知
  - `send_password_reset_notification()`: 密码重置通知

特点：
- 支持纯文本和 HTML 格式邮件
- 邮件模板包含完整的样式和品牌信息
- 自动处理 SMTP 配置缺失的情况（开发环境友好）

### 2. 数据模型层

#### `backend/app/schemas/admin.py`
管理员操作的 Pydantic 数据校验模型：
- `UserApprovalRequest`: 用户审核请求（包含拒绝原因）
- `UserFreezeRequest`: 用户冻结请求（包含冻结原因）
- `PasswordResetResponse`: 密码重置响应（包含临时密码）
- `UserActionResponse`: 通用操作响应模型

### 3. API 路由层

#### `backend/app/api/v1/admin/users.py`
用户管理 API 路由，实现以下端点：

##### GET `/api/v1/admin/users/pending`
获取待审核用户列表
- **权限要求**：内部员工
- **返回**：所有状态为 'pending' 的用户列表
- **排序**：按创建时间倒序

##### POST `/api/v1/admin/users/{user_id}/approve`
批准用户注册
- **权限要求**：内部员工
- **操作流程**：
  1. 验证用户存在且状态为 pending
  2. 更新用户状态为 active
  3. 记录操作人和操作时间
  4. 发送激活通知邮件
- **返回**：操作结果和邮件发送状态

##### POST `/api/v1/admin/users/{user_id}/reject`
拒绝用户注册
- **权限要求**：内部员工
- **必填参数**：拒绝原因（reason）
- **操作流程**：
  1. 验证用户存在且状态为 pending
  2. 验证拒绝原因已填写
  3. 更新用户状态为 rejected
  4. 记录操作人和操作时间
  5. 发送驳回通知邮件
- **返回**：操作结果和邮件发送状态

##### POST `/api/v1/admin/users/{user_id}/freeze`
冻结用户账号
- **权限要求**：内部员工
- **可选参数**：冻结原因（reason）
- **操作流程**：
  1. 验证用户存在
  2. 检查用户是否已冻结
  3. 更新用户状态为 frozen
  4. 记录操作人和操作时间
- **返回**：操作结果

##### POST `/api/v1/admin/users/{user_id}/unfreeze`
解冻用户账号
- **权限要求**：内部员工
- **操作流程**：
  1. 验证用户存在且状态为 frozen
  2. 更新用户状态为 active
  3. 记录操作人和操作时间
- **返回**：操作结果

##### POST `/api/v1/admin/users/{user_id}/reset-password`
重置用户密码
- **权限要求**：内部员工
- **操作流程**：
  1. 验证用户存在
  2. 生成临时密码（12位，符合复杂度要求）
  3. 哈希临时密码并更新数据库
  4. 清空 password_changed_at（强制下次登录修改）
  5. 重置登录失败计数和锁定状态
  6. 发送密码重置通知邮件
- **返回**：操作结果、临时密码和邮件发送状态

### 4. 路由注册

#### `backend/app/api/v1/__init__.py`
更新了 v1 API 路由器，注册了新的用户管理路由：
```python
from app.api.v1.admin import permissions, users
api_router.include_router(users.router)
```

### 5. 测试文件

#### `backend/tests/test_admin_users_api.py`
完整的测试套件，包含以下测试类：
- `TestGetPendingUsers`: 测试获取待审核用户列表
- `TestApproveUser`: 测试批准用户注册
- `TestRejectUser`: 测试拒绝用户注册
- `TestFreezeUser`: 测试冻结用户账号
- `TestUnfreezeUser`: 测试解冻用户账号
- `TestResetPassword`: 测试重置用户密码

测试覆盖：
- ✅ 正常流程测试
- ✅ 边界条件测试（用户不存在、状态不匹配等）
- ✅ 权限验证测试
- ✅ 数据验证测试（必填字段、格式校验等）

## 技术特点

### 1. 异步架构
- 所有数据库操作使用 SQLAlchemy AsyncSession
- 邮件发送使用 aiosmtplib 异步库
- 完全支持 FastAPI 的异步特性

### 2. 安全性
- 密码使用 bcrypt 哈希存储
- 临时密码符合复杂度要求
- 强制用户首次登录修改密码（password_changed_at 设为 None）
- 重置密码时自动解除账号锁定

### 3. 审计追踪
- 所有操作记录 updated_by（操作人）
- 所有操作记录 updated_at（操作时间）
- 支持后续扩展到完整的审计日志系统

### 4. 用户体验
- 邮件通知采用 HTML 格式，美观易读
- 包含完整的操作指引和注意事项
- 临时密码使用等宽字体高亮显示

### 5. 错误处理
- 完善的错误提示信息（中文）
- 合理的 HTTP 状态码
- 详细的错误详情（detail）

## API 使用示例

### 1. 获取待审核用户列表
```bash
curl -X GET "http://localhost:8000/api/v1/admin/users/pending" \
  -H "Authorization: Bearer {admin_token}"
```

### 2. 批准用户
```bash
curl -X POST "http://localhost:8000/api/v1/admin/users/1/approve" \
  -H "Authorization: Bearer {admin_token}"
```

### 3. 拒绝用户
```bash
curl -X POST "http://localhost:8000/api/v1/admin/users/1/reject" \
  -H "Authorization: Bearer {admin_token}" \
  -H "Content-Type: application/json" \
  -d '{"reason": "资料不完整，请补充供应商资质证明"}'
```

### 4. 冻结用户
```bash
curl -X POST "http://localhost:8000/api/v1/admin/users/1/freeze" \
  -H "Authorization: Bearer {admin_token}" \
  -H "Content-Type: application/json" \
  -d '{"reason": "供应商合作暂停"}'
```

### 5. 解冻用户
```bash
curl -X POST "http://localhost:8000/api/v1/admin/users/1/unfreeze" \
  -H "Authorization: Bearer {admin_token}"
```

### 6. 重置密码
```bash
curl -X POST "http://localhost:8000/api/v1/admin/users/1/reset-password" \
  -H "Authorization: Bearer {admin_token}"
```

## 配置要求

### 环境变量
在 `.env` 文件中配置 SMTP 邮件服务器（可选）：
```env
SMTP_SERVER=smtp.example.com
SMTP_PORT=587
SMTP_USERNAME=noreply@company.com
SMTP_PASSWORD=your_smtp_password
SMTP_FROM_EMAIL=noreply@company.com
SMTP_USE_TLS=True
```

注意：如果未配置 SMTP，邮件发送会被跳过，但 API 仍然正常工作。

## 依赖项

所有依赖项已在 `requirements.txt` 中定义：
- `aiosmtplib==3.0.1`: 异步邮件发送
- `python-jose[cryptography]==3.3.0`: JWT Token 生成
- `passlib[bcrypt]==1.7.4`: 密码哈希

## 后续扩展建议

### 1. 权限系统集成
当前实现使用简单的 `user_type` 检查，建议集成完整的权限系统：
```python
from app.core.permissions import require_permission

@router.get("/pending")
@require_permission("admin.users", "read")
async def get_pending_users(...):
    ...
```

### 2. 审计日志
建议将操作记录到专门的审计日志表：
```python
from app.services.audit_service import audit_service

await audit_service.log_operation(
    user_id=current_user.id,
    operation_type="approve_user",
    target_type="user",
    target_id=user_id,
    description=f"批准用户 {user.username}"
)
```

### 3. 批量操作
支持批量审核、批量冻结等操作：
```python
@router.post("/batch-approve")
async def batch_approve_users(user_ids: List[int], ...):
    ...
```

### 4. 操作历史
为每个用户添加操作历史记录查询接口：
```python
@router.get("/{user_id}/history")
async def get_user_operation_history(user_id: int, ...):
    ...
```

## 测试运行

运行测试套件：
```bash
cd backend
pytest tests/test_admin_users_api.py -v
```

运行所有测试：
```bash
pytest -v
```

## 符合的需求

本实现完全符合以下需求：
- ✅ Requirements 2.1.3: 用户注册与审核
- ✅ Requirements 2.3.3: 人员信息及权限配置

## 总结

本实现提供了完整的用户管理功能，包括：
1. 用户审核（批准/拒绝）
2. 账号冻结/解冻
3. 密码重置
4. 邮件通知
5. 完整的测试覆盖

所有功能都遵循了 FastAPI 最佳实践，使用异步架构，具有良好的错误处理和用户体验。
