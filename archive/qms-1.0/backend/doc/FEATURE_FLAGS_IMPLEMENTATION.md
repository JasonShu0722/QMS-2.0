# 功能特性开关实现文档
# Feature Flags Implementation Documentation

## 概述 (Overview)

本文档描述功能特性开关（Feature Flags）模块的实现细节。该模块用于灰度发布和功能控制，支持全局开关和白名单机制，实现环境隔离（stable/preview）。

## 核心组件 (Core Components)

### 1. 数据模型 (Data Model)

**文件**: `backend/app/models/feature_flag.py`

**FeatureFlag 模型字段**:
- `id`: 主键
- `feature_key`: 功能唯一标识键（唯一索引）
- `feature_name`: 功能名称
- `description`: 功能描述
- `is_enabled`: 是否启用
- `scope`: 作用域（global/whitelist）
- `whitelist_user_ids`: 白名单用户ID列表（JSON数组）
- `whitelist_supplier_ids`: 白名单供应商ID列表（JSON数组）
- `environment`: 环境标识（stable/preview）
- `created_at`: 创建时间
- `updated_at`: 更新时间
- `created_by`: 创建人ID

**枚举类型**:
- `FeatureFlagScope`: GLOBAL（全局）, WHITELIST（白名单）
- `FeatureFlagEnvironment`: STABLE（正式环境）, PREVIEW（预览环境）

### 2. 服务层 (Service Layer)

**文件**: `backend/app/services/feature_flag_service.py`

**FeatureFlagService 类方法**:

#### `is_feature_enabled()`
检查功能是否对指定用户/供应商启用。

**参数**:
- `db`: 数据库会话
- `feature_key`: 功能唯一标识键
- `user_id`: 用户ID（可选）
- `supplier_id`: 供应商ID（可选）
- `environment`: 环境标识（可选）

**逻辑**:
1. 查询功能开关配置
2. 检查功能是否启用（is_enabled）
3. 检查环境匹配
4. 根据作用域判断：
   - global: 所有用户生效
   - whitelist: 仅白名单用户/供应商可见

**返回**: `bool` - 功能是否启用

#### `update_feature_flag()`
更新功能开关配置。

**参数**:
- `db`: 数据库会话
- `feature_key`: 功能唯一标识键
- `is_enabled`: 是否启用
- `scope`: 作用域
- `whitelist_user_ids`: 白名单用户ID列表
- `whitelist_supplier_ids`: 白名单供应商ID列表
- `environment`: 环境标识（可选）
- `updated_by`: 更新人ID（可选）

**返回**: `FeatureFlag` - 更新后的功能开关对象

#### `get_all_feature_flags()`
获取所有功能开关列表。

**参数**:
- `db`: 数据库会话
- `environment`: 环境标识（可选，用于过滤）

**返回**: `List[FeatureFlag]` - 功能开关列表

#### `get_user_enabled_features()`
获取当前用户可用的功能列表。

**参数**:
- `db`: 数据库会话
- `user_id`: 用户ID
- `supplier_id`: 供应商ID（可选）
- `environment`: 环境标识（可选）

**返回**: `List[str]` - 启用的功能键列表

#### `create_feature_flag()`
创建新的功能开关。

**参数**:
- `db`: 数据库会话
- `feature_key`: 功能唯一标识键
- `feature_name`: 功能名称
- `description`: 功能描述（可选）
- `is_enabled`: 是否启用
- `scope`: 作用域
- `whitelist_user_ids`: 白名单用户ID列表
- `whitelist_supplier_ids`: 白名单供应商ID列表
- `environment`: 环境标识
- `created_by`: 创建人ID（可选）

**返回**: `FeatureFlag` - 创建的功能开关对象

### 3. API 路由 (API Routes)

#### 管理员接口 (Admin API)

**文件**: `backend/app/api/v1/admin/feature_flags.py`

**端点**:

1. `GET /api/v1/admin/feature-flags`
   - 获取功能开关列表
   - 支持按环境过滤
   - 权限：仅管理员

2. `POST /api/v1/admin/feature-flags`
   - 创建功能开关
   - 权限：仅管理员

3. `GET /api/v1/admin/feature-flags/{feature_flag_id}`
   - 获取功能开关详情
   - 权限：仅管理员

4. `PUT /api/v1/admin/feature-flags/{feature_flag_id}`
   - 更新功能开关
   - 立即生效，无需重启服务
   - 权限：仅管理员

5. `DELETE /api/v1/admin/feature-flags/{feature_flag_id}`
   - 删除功能开关
   - 权限：仅管理员

#### 用户接口 (User API)

**文件**: `backend/app/api/v1/feature_flags.py`

**端点**:

1. `GET /api/v1/feature-flags/my-features`
   - 获取当前用户可用功能列表
   - 前端根据此列表动态渲染菜单和功能按钮
   - 权限：所有登录用户

2. `POST /api/v1/feature-flags/check`
   - 检查指定功能是否启用
   - 实时检查功能开关状态
   - 权限：所有登录用户

### 4. 数据校验模型 (Pydantic Schemas)

**文件**: `backend/app/schemas/feature_flag.py`

**模型**:
- `FeatureFlagBase`: 基础模型
- `FeatureFlagCreate`: 创建请求模型
- `FeatureFlagUpdate`: 更新请求模型
- `FeatureFlagResponse`: 响应模型
- `FeatureFlagListResponse`: 列表响应模型
- `UserEnabledFeaturesResponse`: 用户可用功能列表响应模型
- `FeatureFlagCheckRequest`: 功能检查请求模型
- `FeatureFlagCheckResponse`: 功能检查响应模型

## 使用场景 (Use Cases)

### 1. 灰度发布 (Canary Release)

**场景**: 新功能先在预览环境验证，再逐步开放给部分用户，最后全量发布。

**步骤**:
1. 创建功能开关，设置 `environment=preview`, `is_enabled=true`, `scope=global`
2. 在预览环境验证功能
3. 切换到正式环境，设置 `scope=whitelist`，添加关键用户到白名单
4. 验证无误后，切换 `scope=global`，全量发布

### 2. 功能降级 (Feature Degradation)

**场景**: 紧急情况下快速关闭某功能。

**步骤**:
1. 调用 `PUT /api/v1/admin/feature-flags/{id}`
2. 设置 `is_enabled=false`
3. 立即生效，无需重启服务

### 3. A/B 测试 (A/B Testing)

**场景**: 对比新旧功能的效果。

**步骤**:
1. 创建功能开关，设置 `scope=whitelist`
2. 将部分用户添加到白名单（A组看到新功能）
3. 其他用户继续使用旧功能（B组）
4. 收集数据，对比效果

### 4. 环境隔离 (Environment Isolation)

**场景**: 预览环境和正式环境使用不同的功能配置。

**步骤**:
1. 创建两个功能开关，分别设置 `environment=preview` 和 `environment=stable`
2. 预览环境自动使用 preview 配置
3. 正式环境自动使用 stable 配置

## API 使用示例 (API Usage Examples)

### 创建功能开关

```bash
POST /api/v1/admin/feature-flags
Content-Type: application/json
Authorization: Bearer {token}

{
  "feature_key": "supplier_ppap_v2",
  "feature_name": "供应商PPAP 2.0版本",
  "description": "新版PPAP提交流程，支持在线审核和自动提醒",
  "is_enabled": true,
  "scope": "whitelist",
  "whitelist_user_ids": [1, 2, 3],
  "whitelist_supplier_ids": [10, 20],
  "environment": "preview"
}
```

### 更新功能开关

```bash
PUT /api/v1/admin/feature-flags/1
Content-Type: application/json
Authorization: Bearer {token}

{
  "is_enabled": true,
  "scope": "global",
  "whitelist_user_ids": [],
  "whitelist_supplier_ids": [],
  "environment": "stable"
}
```

### 获取用户可用功能

```bash
GET /api/v1/feature-flags/my-features
Authorization: Bearer {token}

Response:
{
  "user_id": 1,
  "enabled_features": [
    "supplier_ppap_v2",
    "quality_cost_analysis",
    "instrument_management"
  ]
}
```

### 检查功能是否启用

```bash
POST /api/v1/feature-flags/check
Content-Type: application/json
Authorization: Bearer {token}

{
  "feature_key": "supplier_ppap_v2",
  "user_id": 1,
  "environment": "stable"
}

Response:
{
  "feature_key": "supplier_ppap_v2",
  "is_enabled": true
}
```

## 前端集成 (Frontend Integration)

### 1. 初始化时获取可用功能

```typescript
// frontend/src/stores/featureFlags.ts
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { featureFlagsApi } from '@/api/featureFlags'

export const useFeatureFlagsStore = defineStore('featureFlags', () => {
  const enabledFeatures = ref<string[]>([])
  
  async function loadEnabledFeatures() {
    const response = await featureFlagsApi.getMyFeatures()
    enabledFeatures.value = response.enabled_features
  }
  
  function isFeatureEnabled(featureKey: string): boolean {
    return enabledFeatures.value.includes(featureKey)
  }
  
  return {
    enabledFeatures,
    loadEnabledFeatures,
    isFeatureEnabled
  }
})
```

### 2. 条件渲染功能

```vue
<template>
  <div>
    <!-- 仅白名单用户可见 -->
    <el-button 
      v-if="featureFlagsStore.isFeatureEnabled('supplier_ppap_v2')"
      @click="openPPAPV2"
    >
      PPAP 2.0（新版）
    </el-button>
    
    <!-- 所有用户可见 -->
    <el-button @click="openPPAPV1">
      PPAP 1.0
    </el-button>
  </div>
</template>

<script setup lang="ts">
import { useFeatureFlagsStore } from '@/stores/featureFlags'

const featureFlagsStore = useFeatureFlagsStore()
</script>
```

## 测试 (Testing)

**测试文件**: `backend/tests/test_feature_flags.py`

**测试覆盖**:
- ✅ 创建功能开关
- ✅ 全局功能开关
- ✅ 白名单功能开关
- ✅ 禁用的功能开关
- ✅ 环境隔离
- ✅ 更新功能开关
- ✅ 获取所有功能开关
- ✅ 获取用户可用功能列表
- ✅ 不存在的功能开关
- ✅ 创建重复的功能开关
- ✅ 更新不存在的功能开关

**运行测试**:
```bash
pytest backend/tests/test_feature_flags.py -v
```

## 数据库迁移 (Database Migration)

功能开关表已在初始迁移中创建。如需修改表结构，请遵循非破坏性迁移原则：

1. 新增字段必须设置为 `nullable=True` 或带有 `server_default`
2. 禁止删除字段、重命名字段、修改字段类型
3. 使用 Alembic 生成迁移脚本：
   ```bash
   alembic revision --autogenerate -m "Update feature_flags table"
   alembic upgrade head
   ```

## 注意事项 (Notes)

1. **权限控制**: 当前管理员接口使用 `get_current_active_user` 依赖，后续需要集成权限系统进行管理员权限检查。

2. **缓存策略**: 功能开关查询频繁，建议在生产环境中添加 Redis 缓存层，缓存用户的可用功能列表。

3. **审计日志**: 功能开关的创建、更新、删除操作会自动记录到操作日志（通过审计中间件）。

4. **环境变量**: 系统通过 `settings.ENVIRONMENT` 判断当前环境（stable/preview），确保在配置文件中正确设置。

5. **前端同步**: 功能开关更新后，前端需要重新调用 `/api/v1/feature-flags/my-features` 获取最新的可用功能列表。

## 相关文档 (Related Documentation)

- 需求文档: `.kiro/specs/qms-foundation-and-auth/requirements.md` - Requirement 16
- 设计文档: `.kiro/specs/qms-foundation-and-auth/design.md` - Section 6.7
- 任务文档: `.kiro/specs/qms-foundation-and-auth/tasks.md` - Task 5.1

## 实现状态 (Implementation Status)

✅ 已完成 (Completed):
- 数据模型 (FeatureFlag)
- 服务层 (FeatureFlagService)
- 管理员 API (Admin Feature Flags API)
- 用户 API (User Feature Flags API)
- 数据校验模型 (Pydantic Schemas)
- 单元测试 (Unit Tests)
- API 路由注册

⏸️ 待完成 (Pending):
- 前端集成 (Frontend Integration)
- Redis 缓存层 (Redis Cache Layer)
- 管理员权限检查 (Admin Permission Check)

## 更新日志 (Changelog)

### 2024-01-15
- ✅ 初始实现完成
- ✅ 创建数据模型、服务层、API 路由
- ✅ 编写单元测试
- ✅ 注册 API 路由
