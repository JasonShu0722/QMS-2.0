# 通知规则配置管理 API 实现文档

## 概述

本文档描述了任务 4.6 - 实现消息通知配置管理的完整实现。该模块提供了通知规则、SMTP服务器配置和Webhook配置的管理功能，支持系统管理员配置自动化消息推送规则。

## 实现的功能

### 1. 通知规则管理 (Notification Rules)

#### 1.1 数据模型
- **模型文件**: `backend/app/models/notification_rule.py`
- **数据库表**: `notification_rules`
- **核心字段**:
  - `rule_name`: 规则名称
  - `business_object`: 业务对象 (scar/ppap/audit等)
  - `trigger_condition`: 触发条件 (JSON格式)
  - `action_type`: 动作类型 (send_email/send_notification/send_webhook)
  - `action_config`: 动作配置 (JSON格式)
  - `escalation_enabled`: 是否启用超时升级
  - `escalation_hours`: 超时小时数
  - `escalation_recipients`: 升级抄送人ID列表
  - `is_active`: 是否激活

#### 1.2 API 端点

##### GET /api/v1/admin/notification-rules
获取所有通知规则列表

**Query Parameters**:
- `business_object` (可选): 按业务对象筛选
- `is_active` (可选): 按激活状态筛选

**Response**: `List[NotificationRuleResponseSchema]`

**示例**:
```bash
curl -X GET "http://localhost:8000/api/v1/admin/notification-rules?business_object=customer_complaint" \
  -H "Authorization: Bearer <token>"
```

##### GET /api/v1/admin/notification-rules/{rule_id}
获取单个通知规则详情

**Path Parameters**:
- `rule_id`: 规则ID

**Response**: `NotificationRuleResponseSchema`

##### POST /api/v1/admin/notification-rules
创建新的通知规则

**Request Body**: `NotificationRuleCreateSchema`

**示例**:
```json
{
  "rule_name": "客诉单驳回通知",
  "business_object": "customer_complaint",
  "trigger_condition": {
    "field": "status",
    "operator": "equals",
    "value": "rejected"
  },
  "action_type": "send_email",
  "action_config": {
    "recipients": ["submitter"],
    "template": "rejection_notice"
  },
  "escalation_enabled": true,
  "escalation_hours": 48,
  "escalation_recipients": [1, 2, 3],
  "is_active": true
}
```

**Response**: `NotificationRuleResponseSchema` (201 Created)

##### PUT /api/v1/admin/notification-rules/{rule_id}
更新现有通知规则

**Path Parameters**:
- `rule_id`: 规则ID

**Request Body**: `NotificationRuleUpdateSchema`

**示例**:
```json
{
  "rule_name": "客诉单驳回通知（更新）",
  "is_active": false
}
```

**Response**: `NotificationRuleResponseSchema`

##### DELETE /api/v1/admin/notification-rules/{rule_id}
删除通知规则

**Path Parameters**:
- `rule_id`: 规则ID

**Response**: 204 No Content

##### POST /api/v1/admin/notification-rules/test
测试通知规则

**Request Body**: `NotificationRuleTestRequest`

**示例**:
```json
{
  "rule_id": 1,
  "test_data": {
    "status": "rejected",
    "submitter_email": "test@example.com"
  }
}
```

**Response**: `NotificationRuleTestResponse`

### 2. SMTP 配置管理

#### 2.1 数据模型
- **模型文件**: `backend/app/models/smtp_config.py`
- **数据库表**: `smtp_configs`
- **核心字段**:
  - `config_name`: 配置名称 (唯一)
  - `smtp_host`: SMTP服务器地址
  - `smtp_port`: SMTP端口
  - `smtp_user`: SMTP用户名
  - `smtp_password_encrypted`: 加密后的密码
  - `use_tls`: 是否使用TLS
  - `from_email`: 发件人邮箱
  - `from_name`: 发件人名称
  - `is_active`: 是否激活
  - `last_test_at`: 最后测试时间
  - `last_test_result`: 最后测试结果

#### 2.2 API 端点

##### GET /api/v1/admin/notification-rules/smtp-configs
获取所有SMTP配置列表

**Response**: `List[SMTPConfigResponseSchema]` (不包含密码)

##### POST /api/v1/admin/notification-rules/smtp-config
创建新的SMTP配置

**Request Body**: `SMTPConfigCreateSchema`

**示例**:
```json
{
  "config_name": "公司邮件服务器",
  "smtp_host": "smtp.company.com",
  "smtp_port": 587,
  "smtp_user": "qms@company.com",
  "smtp_password": "password123",
  "use_tls": true,
  "from_email": "qms@company.com",
  "from_name": "QMS质量管理系统",
  "is_active": true
}
```

**功能特性**:
- 自动测试SMTP连接有效性
- 密码加密存储 (当前使用Base64，生产环境应使用cryptography库)
- 如果设置为激活，自动停用其他配置
- 配置名称唯一性检查

**Response**: `SMTPConfigResponseSchema` (201 Created)

##### PUT /api/v1/admin/notification-rules/smtp-config/{config_id}
更新SMTP配置

**Path Parameters**:
- `config_id`: 配置ID

**Request Body**: `SMTPConfigUpdateSchema`

**Response**: `SMTPConfigResponseSchema`

##### POST /api/v1/admin/notification-rules/smtp-config/{config_id}/test
测试SMTP连接

**Path Parameters**:
- `config_id`: 配置ID

**功能**:
- 测试SMTP服务器连接
- 验证认证信息
- 记录测试结果和时间
- 返回连接时间统计

**Response**: `SMTPTestResponse`

**示例响应**:
```json
{
  "success": true,
  "message": "SMTP连接测试成功",
  "details": {
    "smtp_host": "smtp.company.com",
    "smtp_port": 587,
    "connection_time_ms": 234
  }
}
```

### 3. Webhook 配置管理

#### 3.1 API 端点

##### POST /api/v1/admin/notification-rules/webhook-config
配置并测试Webhook

**Request Body**: `WebhookConfigCreateSchema`

**示例**:
```json
{
  "config_name": "企业微信通知",
  "webhook_type": "wechat_work",
  "webhook_url": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxxxx",
  "is_active": true
}
```

**支持的Webhook类型**:
- `wechat_work`: 企业微信
- `dingtalk`: 钉钉
- `feishu`: 飞书

**功能特性**:
- 自动测试Webhook可达性
- 发送测试消息验证连接
- 返回响应时间统计

**Response**: `WebhookTestResponse`

**示例响应**:
```json
{
  "success": true,
  "message": "Webhook连接测试成功",
  "details": {
    "webhook_type": "wechat_work",
    "response_code": 200,
    "response_time_ms": 156
  }
}
```

## 数据校验模型 (Pydantic Schemas)

### 文件位置
`backend/app/schemas/notification_rule.py`

### 主要Schema

1. **NotificationRuleCreateSchema**: 创建通知规则请求
2. **NotificationRuleUpdateSchema**: 更新通知规则请求
3. **NotificationRuleResponseSchema**: 通知规则响应
4. **NotificationRuleTestRequest**: 测试通知规则请求
5. **NotificationRuleTestResponse**: 测试通知规则响应
6. **SMTPConfigCreateSchema**: 创建SMTP配置请求
7. **SMTPConfigUpdateSchema**: 更新SMTP配置请求
8. **SMTPConfigResponseSchema**: SMTP配置响应
9. **SMTPTestResponse**: SMTP测试响应
10. **WebhookConfigCreateSchema**: 创建Webhook配置请求
11. **WebhookTestResponse**: Webhook测试响应

### 数据校验规则

#### 通知规则校验
- `action_type` 必须是: `send_email`, `send_notification`, `send_webhook`
- 启用升级策略时，`escalation_hours` 必须设置
- 字段长度限制和格式验证

#### SMTP配置校验
- 端口范围: 1-65535
- 配置名称唯一性
- 邮箱格式验证

#### Webhook配置校验
- `webhook_type` 必须是: `wechat_work`, `dingtalk`, `feishu`
- URL格式验证

## 权限控制

### 访问权限
- **所有端点**: 需要认证 (Bearer Token)
- **用户类型**: 仅限内部员工 (`user_type == "internal"`)
- **供应商用户**: 返回 403 Forbidden

### 权限检查实现
```python
if current_user.user_type != "internal":
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="仅内部员工可访问此接口"
    )
```

## 安全特性

### 1. 密码加密
- SMTP密码使用加密存储
- 当前实现: Base64编码 (简单实现)
- **生产环境建议**: 使用 `cryptography` 库进行AES加密

### 2. 连接测试
- SMTP连接测试使用TLS加密
- Webhook测试使用HTTPS协议
- 超时控制: 10秒

### 3. 错误处理
- 详细的错误消息
- 异常捕获和日志记录
- 用户友好的错误提示

## 测试

### 测试文件
`backend/tests/test_notification_rules_api.py`

### 测试覆盖

#### 通知规则测试
- ✅ 获取所有通知规则
- ✅ 带筛选条件获取规则
- ✅ 根据ID获取规则
- ✅ 创建通知规则
- ✅ 创建规则 - 无效动作类型验证
- ✅ 更新通知规则
- ✅ 删除通知规则
- ✅ 测试通知规则

#### SMTP配置测试
- ✅ 获取所有SMTP配置
- ✅ 创建SMTP配置
- ✅ 创建配置 - 重复名称验证

#### Webhook配置测试
- ✅ 配置Webhook
- ✅ 配置Webhook - 无效类型验证

#### 权限测试
- ✅ 需要认证
- ✅ 需要内部员工权限

### 运行测试
```bash
# 运行所有通知规则测试
pytest backend/tests/test_notification_rules_api.py -v

# 运行特定测试
pytest backend/tests/test_notification_rules_api.py::test_create_notification_rule -v
```

## 数据库迁移

### 迁移文件
`backend/alembic/versions/2026_02_11_1330-001_initial_schema.py`

### 表结构
- `notification_rules`: 通知规则表
- `smtp_configs`: SMTP配置表

### 迁移特性
- ✅ 所有字段符合非破坏性原则
- ✅ 新增字段设置为 Nullable 或带有 Default Value
- ✅ 支持双轨发布架构

## API 路由注册

### 注册位置
`backend/app/api/v1/__init__.py`

### 注册代码
```python
from app.api.v1.admin import notification_rules

api_router.include_router(notification_rules.router)
```

## 使用示例

### 1. 创建通知规则
```python
import httpx

async with httpx.AsyncClient() as client:
    response = await client.post(
        "http://localhost:8000/api/v1/admin/notification-rules",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "rule_name": "PPAP审批超时通知",
            "business_object": "ppap",
            "trigger_condition": {
                "field": "status",
                "operator": "equals",
                "value": "pending"
            },
            "action_type": "send_notification",
            "action_config": {
                "recipients": ["reviewer"],
                "template": "ppap_reminder"
            },
            "escalation_enabled": True,
            "escalation_hours": 24,
            "escalation_recipients": [1, 2],
            "is_active": True
        }
    )
    print(response.json())
```

### 2. 配置SMTP服务器
```python
async with httpx.AsyncClient() as client:
    response = await client.post(
        "http://localhost:8000/api/v1/admin/notification-rules/smtp-config",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "config_name": "公司邮件服务器",
            "smtp_host": "smtp.company.com",
            "smtp_port": 587,
            "smtp_user": "qms@company.com",
            "smtp_password": "password123",
            "use_tls": True,
            "from_email": "qms@company.com",
            "from_name": "QMS质量管理系统",
            "is_active": True
        }
    )
    print(response.json())
```

### 3. 测试Webhook连接
```python
async with httpx.AsyncClient() as client:
    response = await client.post(
        "http://localhost:8000/api/v1/admin/notification-rules/webhook-config",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "config_name": "企业微信通知",
            "webhook_type": "wechat_work",
            "webhook_url": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxxxx",
            "is_active": True
        }
    )
    print(response.json())
```

## 后续改进建议

### 1. 安全增强
- [ ] 使用 `cryptography` 库替换Base64密码加密
- [ ] 实现密码轮换机制
- [ ] 添加API访问频率限制

### 2. 功能扩展
- [ ] 实现Webhook配置的持久化存储
- [ ] 添加通知规则的执行历史记录
- [ ] 实现规则优先级和冲突检测
- [ ] 添加规则模板功能

### 3. 监控和日志
- [ ] 添加通知发送成功率统计
- [ ] 实现规则执行日志
- [ ] 添加性能监控指标

### 4. 用户体验
- [ ] 添加规则预览功能
- [ ] 实现规则导入导出
- [ ] 添加规则复制功能

## 相关文档

- [Requirements Document](.kiro/specs/qms-foundation-and-auth/requirements.md) - Requirement 2.3.2
- [Design Document](.kiro/specs/qms-foundation-and-auth/design.md) - 通知规则设计
- [Tasks Document](.kiro/specs/qms-foundation-and-auth/tasks.md) - Task 4.6

## 总结

本实现完成了通知规则配置管理的所有核心功能，包括：

1. ✅ 通知规则的完整CRUD操作
2. ✅ SMTP服务器配置和连接测试
3. ✅ Webhook配置和可达性验证
4. ✅ 完整的数据校验和错误处理
5. ✅ 权限控制和安全特性
6. ✅ 全面的单元测试覆盖

系统管理员现在可以通过API配置自动化的消息推送规则，支持邮件、站内信和Webhook三种通知方式，并可以配置超时升级策略，确保重要消息及时送达。
