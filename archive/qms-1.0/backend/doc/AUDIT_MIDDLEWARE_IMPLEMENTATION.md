# 操作日志审计系统实现文档

## 概述

本文档描述操作日志审计系统的实现，包括审计中间件、API 接口和数据模型。

## 实现的功能

### 1. 审计中间件 (`app/core/audit_middleware.py`)

自动拦截所有 POST/PUT/DELETE 请求，记录操作日志。

**核心功能**:
- 自动记录操作人、操作时间、操作类型
- 记录目标对象（模块、ID）
- 记录数据快照（before_data, after_data）
- 记录请求信息（IP、User-Agent）

**排除路径**:
- `/api/v1/auth/login` - 登录操作单独记录
- `/api/v1/auth/logout` - 登出操作单独记录
- `/api/v1/auth/captcha` - 验证码生成不记录
- `/health` - 健康检查
- `/api/docs` - API 文档

**IP 地址获取**:
优先从 `X-Forwarded-For` 或 `X-Real-IP` 头获取（Nginx 代理场景），回退到直接连接的客户端 IP。

**用户识别**:
从 JWT Token 中提取用户 ID，支持从 Authorization Header 解析。

### 2. 操作日志 API (`app/api/v1/admin/operation_logs.py`)

提供操作日志查询接口。

#### 2.1 获取操作日志列表

**端点**: `GET /api/v1/admin/operation-logs`

**查询参数**:
- `user_id`: 按用户ID筛选
- `operation_type`: 按操作类型筛选（create/update/delete）
- `target_module`: 按目标模块筛选（users/permissions/suppliers等）
- `start_date`: 开始时间（ISO 8601 格式）
- `end_date`: 结束时间（ISO 8601 格式）
- `page`: 页码（从1开始）
- `page_size`: 每页数量（1-100）

**响应示例**:
```json
{
  "total": 100,
  "page": 1,
  "page_size": 50,
  "items": [
    {
      "id": 1,
      "user_id": 1,
      "username": "admin",
      "user_full_name": "管理员",
      "operation_type": "create",
      "target_module": "users",
      "target_id": 10,
      "ip_address": "192.168.1.100",
      "user_agent": "Mozilla/5.0...",
      "created_at": "2024-01-15T10:30:00Z"
    }
  ]
}
```

#### 2.2 获取操作日志详情

**端点**: `GET /api/v1/admin/operation-logs/{log_id}`

**响应示例**:
```json
{
  "id": 1,
  "user_id": 1,
  "username": "admin",
  "user_full_name": "管理员",
  "operation_type": "update",
  "target_module": "users",
  "target_id": 10,
  "before_data": {
    "email": "old@example.com",
    "status": "pending"
  },
  "after_data": {
    "email": "new@example.com",
    "status": "active"
  },
  "data_diff": {
    "added": {},
    "removed": {},
    "modified": {
      "email": {
        "old": "old@example.com",
        "new": "new@example.com"
      },
      "status": {
        "old": "pending",
        "new": "active"
      }
    }
  },
  "ip_address": "192.168.1.100",
  "user_agent": "Mozilla/5.0...",
  "created_at": "2024-01-15T10:30:00Z"
}
```

### 3. 数据变更 Diff 计算

`_calculate_diff()` 函数自动计算数据变更对比：

- **added**: 新增的字段
- **removed**: 删除的字段
- **modified**: 修改的字段（包含 old 和 new 值）

## 数据模型

### OperationLog 模型

```python
class OperationLog(Base):
    __tablename__ = "operation_logs"
    
    id: int  # 主键
    user_id: int  # 操作用户ID
    operation_type: str  # 操作类型: create/update/delete/login/logout
    target_module: str  # 目标模块
    target_id: int  # 目标对象ID
    before_data: dict  # 操作前数据快照（JSON）
    after_data: dict  # 操作后数据快照（JSON）
    ip_address: str  # 客户端IP地址
    user_agent: str  # 浏览器User-Agent
    created_at: datetime  # 操作时间
```

## 使用方法

### 1. 注册中间件

中间件已在 `app/main.py` 中自动注册：

```python
from app.core.audit_middleware import setup_audit_middleware

setup_audit_middleware(app)
```

### 2. 查询操作日志

```python
# 获取所有日志
GET /api/v1/admin/operation-logs

# 按用户筛选
GET /api/v1/admin/operation-logs?user_id=1

# 按操作类型筛选
GET /api/v1/admin/operation-logs?operation_type=delete

# 按时间范围筛选
GET /api/v1/admin/operation-logs?start_date=2024-01-01T00:00:00Z&end_date=2024-01-31T23:59:59Z

# 分页查询
GET /api/v1/admin/operation-logs?page=2&page_size=20
```

### 3. 查看日志详情

```python
GET /api/v1/admin/operation-logs/123
```

## 注意事项

### 1. 中间件限制

- 中间件层面无法获取修改前的数据（before_data），需要在 Service 层补充
- 仅记录成功的请求（2xx 状态码）
- 审计日志记录失败不会影响主业务流程

### 2. 性能考虑

- 审计日志记录是异步的，不会阻塞主请求
- 使用独立的数据库会话，避免事务冲突
- 建议定期归档历史日志，避免表过大

### 3. 安全建议

- 操作日志 API 应限制为管理员访问（TODO: 添加权限检查）
- 敏感数据（如密码）不应记录在 after_data 中
- 定期审查操作日志，发现异常行为

## 测试

测试文件位于 `backend/tests/test_operation_logs_api.py`，包含以下测试用例：

1. 获取操作日志列表
2. 带筛选条件的日志查询
3. 分页查询
4. 获取日志详情
5. Diff 计算逻辑
6. 未认证访问拦截

运行测试：

```bash
pytest backend/tests/test_operation_logs_api.py -v
```

## 后续改进

1. **权限控制**: 添加管理员权限检查，限制操作日志 API 访问
2. **Service 层集成**: 在 Service 层补充 before_data 记录
3. **日志归档**: 实现定期归档机制，将历史日志移至归档表
4. **实时监控**: 集成 WebSocket 推送，实时展示操作日志
5. **异常检测**: 基于操作日志的异常行为检测（如频繁删除、批量修改）
