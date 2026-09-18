# 个人信息管理 API 文档

## 概述

个人信息管理 API 提供用户个人信息查询、密码修改和电子签名上传功能。

## API 端点

### 1. 获取个人信息

**端点**: `GET /api/v1/profile`

**认证**: 需要 Bearer Token

**描述**: 获取当前登录用户的详细信息

**响应示例**:
```json
{
  "id": 1,
  "username": "zhang_san",
  "full_name": "张三",
  "email": "zhangsan@company.com",
  "phone": "13800138000",
  "user_type": "internal",
  "status": "active",
  "department": "质量部",
  "position": "质量工程师",
  "supplier_id": null,
  "digital_signature": "/uploads/signatures/user_1_signature.png",
  "password_changed_at": "2024-01-01T00:00:00",
  "last_login_at": "2024-01-15T09:00:00",
  "created_at": "2023-12-01T00:00:00"
}
```

### 2. 修改密码

**端点**: `PUT /api/v1/profile/password`

**认证**: 需要 Bearer Token

**描述**: 修改当前用户的登录密码

**请求体**:
```json
{
  "old_password": "OldPass123!",
  "new_password": "NewSecurePass456!"
}
```

**密码策略**:
- 长度必须大于 8 位
- 必须包含大写字母、小写字母、数字、特殊字符中的至少三种
- 新密码不能与旧密码相同

**响应示例**:
```json
{
  "message": "密码修改成功，请重新登录",
  "password_changed_at": "2024-01-15T10:30:00"
}
```

**错误响应**:
- `400 Bad Request`: 旧密码错误、新密码与旧密码相同、密码复杂度不足
- `401 Unauthorized`: Token 无效或过期
- `422 Unprocessable Entity`: 请求参数验证失败

**注意事项**:
- 修改密码后，当前 Token 仍然有效（24小时内）
- 建议前端在收到成功响应后，清除本地 Token 并跳转到登录页
- 系统会更新 `password_changed_at` 字段，用于密码过期检查

### 3. 上传电子签名

**端点**: `POST /api/v1/profile/signature`

**认证**: 需要 Bearer Token

**描述**: 上传用户的手写签名图片，系统自动处理背景透明化

**请求**: `multipart/form-data`
- `file`: 签名图片文件（PNG/JPG格式）

**功能特性**:
1. 接收图片文件（PNG/JPG格式）
2. 自动处理图片背景透明化（移除白色背景）
3. 存储到文件系统（`uploads/signatures/` 目录）
4. 更新用户的 `digital_signature` 字段

**文件命名规则**:
- 格式：`user_{user_id}_signature_{uuid}.png`
- 示例：`user_1_signature_550e8400-e29b-41d4-a716-446655440000.png`

**图片处理**:
- 自动转换为 PNG 格式（支持透明通道）
- 移除白色背景（阈值：RGB > 240）
- 保存为 RGBA 模式

**响应示例**:
```json
{
  "message": "电子签名上传成功",
  "signature_path": "/uploads/signatures/user_1_signature_550e8400-e29b-41d4-a716-446655440000.png"
}
```

**错误响应**:
- `400 Bad Request`: 不支持的文件格式
- `401 Unauthorized`: Token 无效或过期
- `500 Internal Server Error`: 图片处理失败

**注意事项**:
- 上传新签名会自动删除旧签名文件
- 签名图片用于后续审批流程的电子签章生成
- 支持的文件格式：`.png`, `.jpg`, `.jpeg`

## 使用示例

### JavaScript/TypeScript (Axios)

```typescript
import axios from 'axios';

// 配置 API 客户端
const apiClient = axios.create({
  baseURL: 'http://localhost:8000/api/v1',
  headers: {
    'Authorization': `Bearer ${localStorage.getItem('access_token')}`
  }
});

// 获取个人信息
async function getProfile() {
  const response = await apiClient.get('/profile');
  return response.data;
}

// 修改密码
async function changePassword(oldPassword: string, newPassword: string) {
  const response = await apiClient.put('/profile/password', {
    old_password: oldPassword,
    new_password: newPassword
  });
  return response.data;
}

// 上传电子签名
async function uploadSignature(file: File) {
  const formData = new FormData();
  formData.append('file', file);
  
  const response = await apiClient.post('/profile/signature', formData, {
    headers: {
      'Content-Type': 'multipart/form-data'
    }
  });
  return response.data;
}
```

### Python (httpx)

```python
import httpx

# 配置 API 客户端
async def get_profile(token: str):
    async with httpx.AsyncClient() as client:
        response = await client.get(
            'http://localhost:8000/api/v1/profile',
            headers={'Authorization': f'Bearer {token}'}
        )
        return response.json()

async def change_password(token: str, old_password: str, new_password: str):
    async with httpx.AsyncClient() as client:
        response = await client.put(
            'http://localhost:8000/api/v1/profile/password',
            headers={'Authorization': f'Bearer {token}'},
            json={
                'old_password': old_password,
                'new_password': new_password
            }
        )
        return response.json()

async def upload_signature(token: str, file_path: str):
    async with httpx.AsyncClient() as client:
        with open(file_path, 'rb') as f:
            files = {'file': ('signature.png', f, 'image/png')}
            response = await client.post(
                'http://localhost:8000/api/v1/profile/signature',
                headers={'Authorization': f'Bearer {token}'},
                files=files
            )
        return response.json()
```

## 安全考虑

1. **认证**: 所有端点都需要有效的 JWT Token
2. **密码策略**: 强制执行密码复杂度要求
3. **文件上传**: 仅支持图片格式，防止恶意文件上传
4. **路径安全**: 使用 UUID 生成唯一文件名，防止路径遍历攻击
5. **旧文件清理**: 上传新签名时自动删除旧文件，防止存储泄漏

## 错误处理

所有 API 端点遵循统一的错误响应格式：

```json
{
  "detail": "错误描述信息"
}
```

常见 HTTP 状态码：
- `200 OK`: 请求成功
- `400 Bad Request`: 请求参数错误或业务逻辑错误
- `401 Unauthorized`: 未认证或 Token 无效
- `403 Forbidden`: 无权限访问
- `422 Unprocessable Entity`: 请求参数验证失败
- `500 Internal Server Error`: 服务器内部错误

## 测试

运行测试：
```bash
pytest backend/tests/test_profile_api.py -v
```

测试覆盖：
- 获取个人信息（成功、未认证）
- 修改密码（成功、旧密码错误、新旧密码相同、弱密码）
- 上传电子签名（成功、无效格式、未认证、替换旧签名）
