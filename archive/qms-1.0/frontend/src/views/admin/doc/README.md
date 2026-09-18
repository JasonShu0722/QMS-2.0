# 系统管理后台页面

本目录包含 QMS 系统的管理后台页面，用于系统管理员进行用户审核、权限配置、任务监控、日志查询和功能开关管理。

## 页面列表

### 1. UserApproval.vue - 用户审核管理
**功能描述：**
- 展示所有待审核用户列表（状态为 "pending"）
- 支持批准/拒绝用户注册申请
- 拒绝时需填写拒绝原因
- 区分内部员工和供应商用户

**主要功能：**
- ✅ 待审核用户列表展示
- ✅ 批准操作（发送激活邮件）
- ✅ 拒绝操作（需填写原因）
- ✅ 实时刷新列表
- ✅ 响应式布局

**API 调用：**
- `GET /v1/admin/users/pending` - 获取待审核用户
- `POST /v1/admin/users/{id}/approve` - 批准用户
- `POST /v1/admin/users/{id}/reject` - 拒绝用户

---

### 2. PermissionMatrix.vue - 权限矩阵配置
**功能描述：**
- 网格化展示用户权限矩阵
- 行：用户列表
- 列：功能模块 + 操作类型（录入/查阅/修改/删除/导出）
- 支持实时勾选/取消权限
- 批量保存权限变更

**主要功能：**
- ✅ 权限矩阵表格展示
- ✅ 复选框勾选/取消授予权限
- ✅ 变更追踪（显示未保存的变更数量）
- ✅ 批量保存所有变更
- ✅ 固定列和表头（便于浏览大型矩阵）

**API 调用：**
- `GET /v1/admin/permissions/matrix` - 获取权限矩阵
- `PUT /v1/admin/permissions/grant` - 授予权限
- `PUT /v1/admin/permissions/revoke` - 撤销权限

**技术要点：**
- 使用 sticky 定位实现固定列和表头
- 变更追踪机制避免频繁 API 调用
- 按用户分组批量提交权限变更

---

### 3. TaskMonitor.vue - 任务统计与监控
**功能描述：**
- 全局任务统计看板
- 按部门/人员统计待办任务分布
- 逾期任务清单展示
- 支持批量转派任务

**主要功能：**
- ✅ 统计卡片（总任务/已逾期/即将逾期/正常）
- ✅ 按部门统计饼图（ECharts）
- ✅ 按人员统计柱状图（Top 10）
- ✅ 任务列表展示和筛选
- ✅ 批量选择和转派功能
- ✅ 紧急程度颜色标识

**API 调用：**
- `GET /v1/admin/tasks/statistics` - 获取任务统计
- `GET /v1/admin/tasks` - 获取任务列表
- `POST /v1/admin/tasks/reassign` - 批量转派任务

**技术要点：**
- 使用 ECharts 渲染数据可视化图表
- 响应式图表布局（移动端/桌面端）
- 任务紧急程度计算和颜色映射

---

### 4. OperationLogs.vue - 操作日志审计
**功能描述：**
- 查询和展示所有用户的操作日志
- 支持多维度筛选（操作人/操作类型/目标模块/时间范围）
- 查看日志详情和数据变更对比
- 导出日志为 Excel

**主要功能：**
- ✅ 操作日志列表展示
- ✅ 多条件筛选（用户/操作类型/目标模块/时间范围）
- ✅ 分页查询
- ✅ 日志详情对话框
- ✅ 数据变更 Diff 对比（变更前/变更后）
- ✅ 导出 Excel 功能

**API 调用：**
- `GET /v1/admin/operation-logs` - 获取日志列表
- `GET /v1/admin/operation-logs/{id}` - 获取日志详情
- `GET /v1/admin/operation-logs/export` - 导出日志

**技术要点：**
- 日期范围选择器
- JSON 数据格式化展示
- Blob 文件下载处理
- 左右对比面板布局

---

### 5. FeatureFlags.vue - 功能开关管理
**功能描述：**
- 管理系统功能特性开关
- 支持全局开关和白名单机制
- 灰度发布和功能控制

**主要功能：**
- ✅ 功能开关列表展示
- ✅ 实时切换开关状态
- ✅ 配置作用范围（全局/白名单）
- ✅ 用户白名单配置
- ✅ 供应商白名单配置
- ✅ 环境标识（正式/预览）

**API 调用：**
- `GET /v1/admin/feature-flags` - 获取功能开关列表
- `GET /v1/admin/feature-flags/{id}` - 获取功能开关详情
- `PUT /v1/admin/feature-flags/{id}` - 更新功能开关

**技术要点：**
- 开关状态实时切换（带确认）
- 白名单多选配置
- 作用范围切换逻辑
- 配置验证（白名单模式必须配置至少一个对象）

---

## 共同特性

所有管理后台页面都具备以下特性：

1. **响应式布局**：适配桌面端和移动端
2. **加载状态**：显示加载动画和错误提示
3. **权限控制**：仅管理员可访问
4. **实时刷新**：支持手动刷新数据
5. **用户友好**：操作确认、成功/失败提示
6. **数据验证**：表单验证和数据校验

## 技术栈

- **UI 框架**：Element Plus
- **样式**：Tailwind CSS
- **图表**：ECharts
- **状态管理**：Vue 3 Composition API
- **HTTP 客户端**：Axios（封装在 @/utils/request）

## 路由配置

需要在 `frontend/src/router/index.ts` 中添加以下路由：

```typescript
{
  path: '/admin',
  name: 'Admin',
  meta: { requiresAuth: true, requiresAdmin: true },
  children: [
    {
      path: 'users',
      name: 'UserApproval',
      component: () => import('@/views/admin/UserApproval.vue')
    },
    {
      path: 'permissions',
      name: 'PermissionMatrix',
      component: () => import('@/views/admin/PermissionMatrix.vue')
    },
    {
      path: 'tasks',
      name: 'TaskMonitor',
      component: () => import('@/views/admin/TaskMonitor.vue')
    },
    {
      path: 'logs',
      name: 'OperationLogs',
      component: () => import('@/views/admin/OperationLogs.vue')
    },
    {
      path: 'features',
      name: 'FeatureFlags',
      component: () => import('@/views/admin/FeatureFlags.vue')
    }
  ]
}
```

## 待完成事项

以下功能需要后续完善：

1. **用户列表加载**：在筛选和白名单配置中加载可用用户列表
2. **供应商列表加载**：在功能开关白名单中加载供应商列表
3. **路由集成**：将页面集成到主路由配置中
4. **菜单集成**：在侧边栏菜单中添加管理后台入口
5. **权限守卫**：确保只有管理员可以访问这些页面

## 注意事项

1. 所有 API 调用都已在 `frontend/src/api/admin.ts` 中定义
2. 类型定义在 `frontend/src/types/admin.ts` 中
3. 需要确保后端 API 已实现对应的接口
4. 图表渲染需要在 DOM 挂载后执行
5. 批量操作需要用户确认以防误操作
