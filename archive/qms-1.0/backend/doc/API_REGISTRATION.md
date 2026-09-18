# 用户注册与审核 API 文档

## 概述

本文档描述任务 3.2 实现的用户注册与审核相关 API 接口。

## 实现的功能

### 1. 用户注册接口

**端点**: `POST /api/v1/auth/register`

**功能描述**:
- 支持内部员工和供应商用户注册
- 验证用户名唯一性
- 验证密码复杂度（大写、小写、数字、特殊字符中至少三种，长度>8位）
- 供应商用户必须从 Supplier 表中选择有效的供应商
- 创建状态为 "pending" 的用户记录
- 密码使用 bcrypt 哈希存储

**请求示例 - 内部员工**:
```json
{
  "username": "zhang_san",
  "password": "SecurePass123!",
  "full_name": "张三",
  "email": "zhangsan@company.com",
  "phone": "13800138000",
  "user_type": "internal",
  "department": "质量部",
  "position": "质量工程师"
}
```

**请求示例 - 供应商用户**:
```json
{
  "username": "supplier_user",
  "password": "SupplierPass456!",
  "full_name": "李四",
  "email": "lisi@supplier.com",
  "phone": "13900139000",
  "user_type": "supplier",
  "supplier_id": 1,
  "position": "质量经理"
}
```

**响应示例**:
```json
{
  "message": "注册成功，请等待管理员审核",
  "user_id": 1,
  "username": "zhang_san",
  "status": "pending"
}
```

**错误响应**:
- `400 Bad Request`: 用户名已存在、密码复杂度不足、必填字段缺失、供应商不存在等
- `422 Unprocessable Entity`: 请求数据格式错误

### 2. 供应商模糊搜索接口

**端点**: `GET /api/v1/auth/suppliers/search?q={keyword}`

**功能描述**:
- 支持按供应商名称或代码进行模糊搜索
- 仅返回状态为 "active" 的供应商
- 最多返回 20 条结果
- 用于供应商用户注册时选择供应商

**请求示例**:
```
GET /api/v1/auth/suppliers/search?q=深圳
```

**响应示例**:
```json
[
  {
    "id": 1,
    "name": "深圳市某某电子有限公司",
    "code": "SUP001",
    "status": "active"
  },
  {
    "id": 2,
    "name": "深圳市另一家电子有限公司",
    "code": "SUP002",
    "status": "active"
  }
]
```

## 数据模型

### UserRegisterSchema (请求模型)

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| username | string | 是 | 用户名，3-50字符，仅字母数字下划线 |
| password | string | 是 | 密码，至少8字符，需满足复杂度要求 |
| full_name | string | 是 | 姓名，2-100字符 |
| email | string | 是 | 邮箱地址 |
| phone | string | 否 | 电话号码 |
| user_type | string | 是 | 用户类型: "internal" 或 "supplier" |
| department | string | 条件 | 部门（内部员工必填） |
| position | string | 否 | 职位 |
| supplier_id | integer | 条件 | 供应商ID（供应商用户必填） |

### RegisterResponseSchema (响应模型)

| 字段 | 类型 | 说明 |
|------|------|------|
| message | string | 提示信息 |
| user_id | integer | 用户ID |
| username | string | 用户名 |
| status | string | 账号状态 |

### SupplierSearchResponseSchema (供应商搜索响应)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | integer | 供应商ID |
| name | string | 供应商名称 |
| code | string | 供应商代码 |
| status | string | 供应商状态 |

## 密码复杂度规则

密码必须满足以下要求：
1. 长度至少 8 个字符
2. 包含以下四种字符类型中的至少三种：
   - 大写字母 (A-Z)
   - 小写字母 (a-z)
   - 数字 (0-9)
   - 特殊字符 (!@#$%^&*(),.?":{}|<>)

**有效密码示例**:
- `SecurePass123!` (大写+小写+数字+特殊字符)
- `MyPassword99` (大写+小写+数字)
- `test@PASS#123` (小写+特殊字符+大写+数字)

**无效密码示例**:
- `test123` (太短，只有小写+数字)
- `password` (只有小写字母)
- `Test@1` (太短)

## 业务逻辑

### 内部员工注册流程

1. 用户填写注册表单，选择 "internal" 用户类型
2. 必须填写部门字段
3. 系统验证用户名唯一性
4. 系统验证密码复杂度
5. 密码使用 bcrypt 哈希存储
6. 创建状态为 "pending" 的用户记录
7. 返回注册成功消息，提示等待管理员审核

### 供应商用户注册流程

1. 用户填写注册表单，选择 "supplier" 用户类型
2. 用户输入供应商名称关键词
3. 前端调用 `/api/v1/auth/suppliers/search` 接口搜索供应商
4. 用户从搜索结果中选择正确的供应商，获取 supplier_id
5. 提交注册表单（包含 supplier_id）
6. 系统验证 supplier_id 存在且供应商状态为 "active"
7. 系统验证用户名唯一性和密码复杂度
8. 密码使用 bcrypt 哈希存储
9. 创建状态为 "pending" 的用户记录
10. 返回注册成功消息，提示等待管理员审核

## 安全特性

1. **密码哈希**: 使用 bcrypt 算法进行密码哈希，不存储明文密码
2. **密码复杂度验证**: 强制执行密码复杂度规则
3. **用户名唯一性**: 防止重复注册
4. **供应商验证**: 供应商用户必须关联到有效的供应商记录
5. **状态管理**: 新注册用户默认为 "pending" 状态，需管理员审核后才能登录

## 测试

测试文件位于 `backend/tests/test_user_registration.py`，包含以下测试用例：

### 用户注册测试
- ✅ 内部员工注册成功
- ✅ 供应商用户注册成功
- ✅ 重复用户名注册失败
- ✅ 弱密码注册失败
- ✅ 内部员工缺少部门字段失败
- ✅ 供应商用户缺少供应商ID失败
- ✅ 供应商用户使用无效供应商ID失败

### 供应商搜索测试
- ✅ 按名称搜索供应商
- ✅ 按代码搜索供应商
- ✅ 搜索无结果
- ✅ 空搜索关键词验证错误

## API 文档

启动应用后，可以访问以下地址查看交互式 API 文档：

- Swagger UI: `http://localhost:8000/api/docs`
- ReDoc: `http://localhost:8000/api/redoc`

## 相关文件

- `backend/app/schemas/user.py`: Pydantic 数据校验模型
- `backend/app/api/v1/auth.py`: 认证路由实现
- `backend/app/api/v1/__init__.py`: API 路由注册
- `backend/app/main.py`: FastAPI 应用主入口
- `backend/tests/test_user_registration.py`: 单元测试

## 依赖的模型

- `app.models.user.User`: 用户数据模型
- `app.models.supplier.Supplier`: 供应商数据模型
- `app.core.auth_strategy.LocalAuthStrategy`: 本地认证策略（密码哈希）
- `app.core.database.get_db`: 数据库会话依赖注入

## 下一步

本任务实现了用户注册和供应商搜索接口。后续任务将实现：

- 任务 3.3: 统一登录 API（多入口支持）
- 任务 3.6: 用户审核管理 API（管理员审批/驳回注册申请）

## Requirements 映射

本实现满足以下需求：

- **Requirement 2.1.3**: 用户注册与审核
  - ✅ 公司用户注册时填写用户名、姓名、电话、邮箱、部门、职位
  - ✅ 供应商用户注册时填写用户名、姓名、电话、邮箱、供应商名称、职位
  - ✅ 供应商名称必须从系统内的供应商名录中选择（模糊搜索 API）
  - ✅ 注册后默认为"待审核"状态

