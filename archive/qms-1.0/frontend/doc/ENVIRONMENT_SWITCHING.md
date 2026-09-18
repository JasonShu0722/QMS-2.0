# 环境切换功能实现文档

## 概述

本文档描述了 QMS 系统的双轨环境切换功能实现。系统支持预览环境（Preview）和正式环境（Stable）的无缝切换，两个环境共享同一数据库底座。

## 功能特性

### 1. 环境识别

系统通过域名自动识别当前环境：
- **正式环境**: `qms.company.com`
- **预览环境**: `preview.company.com`

### 2. 环境切换按钮

#### 桌面端
- 位置：顶部导航栏右侧
- 显示文本：
  - 正式环境显示："切换到预览版"
  - 预览环境显示："切换到正式版"

#### 移动端
- 位置：用户菜单弹窗中
- 显示文本：与桌面端相同

### 3. 环境标识

预览环境在顶部导航栏显示醒目的红色"预览版"标识，提醒用户当前处于测试环境。

### 4. 登录状态保持

环境切换时，用户的登录状态（JWT Token）通过 localStorage 自动共享，无需重新登录。

## 技术实现

### 核心 Composable

`src/composables/useEnvironment.ts` 提供了环境管理的核心功能：

```typescript
export function useEnvironment() {
  // 判断是否为预览环境
  const isPreview = computed(() => {
    return window.location.hostname.includes('preview')
  })

  // 环境切换逻辑
  const switchEnvironment = () => {
    const currentUrl = new URL(window.location.href)
    const hostname = currentUrl.hostname
    
    let newHostname: string
    
    if (isPreview.value) {
      // 移除 'preview.' 前缀
      newHostname = hostname.replace(/^preview\./, '')
    } else {
      // 添加 'preview.' 前缀
      newHostname = `preview.${hostname}`
    }
    
    currentUrl.hostname = newHostname
    window.location.href = currentUrl.toString()
  }

  return {
    isPreview,
    environmentName,
    switchButtonText,
    switchEnvironment,
    environmentBadgeClass
  }
}
```

### 使用方式

在布局组件中引入并使用：

```vue
<script setup lang="ts">
import { useEnvironment } from '@/composables/useEnvironment'

const { isPreview, switchButtonText, switchEnvironment } = useEnvironment()
</script>

<template>
  <!-- 环境标识 -->
  <span class="environment-badge" v-if="isPreview">预览版</span>
  
  <!-- 切换按钮 -->
  <el-button @click="switchEnvironment">
    {{ switchButtonText }}
  </el-button>
</template>
```

## 部署配置

### Nginx 路由配置

```nginx
# 正式环境
server {
    listen 80;
    server_name qms.company.com;
    location / {
        proxy_pass http://frontend-stable:80;
    }
    location /api {
        proxy_pass http://backend-stable:8000;
    }
}

# 预览环境
server {
    listen 80;
    server_name preview.company.com;
    location / {
        proxy_pass http://frontend-preview:80;
    }
    location /api {
        proxy_pass http://backend-preview:8000;
    }
}
```

### Docker Compose 配置

```yaml
services:
  # 正式环境前端
  frontend-stable:
    build:
      context: ./frontend
      args:
        VITE_ENVIRONMENT: stable
    environment:
      - VITE_API_BASE_URL=/api

  # 预览环境前端
  frontend-preview:
    build:
      context: ./frontend
      args:
        VITE_ENVIRONMENT: preview
    environment:
      - VITE_API_BASE_URL=/api
```

## 数据共享机制

### Token 共享

JWT Token 存储在 localStorage 中，由于浏览器的同源策略，需要确保：
1. 两个环境使用相同的顶级域名（如 `company.com`）
2. Token 的 domain 属性设置为顶级域名

### 数据库共享

两个环境的后端服务连接同一个 PostgreSQL 数据库：

```yaml
services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: qms_db
      
  backend-stable:
    environment:
      DATABASE_URL: postgresql://qms_user@postgres:5432/qms_db
      
  backend-preview:
    environment:
      DATABASE_URL: postgresql://qms_user@postgres:5432/qms_db
```

## 开发环境注意事项

在本地开发环境（localhost）中，环境切换功能会被禁用，因为无法通过域名区分环境。开发时可以通过以下方式测试：

1. 修改本地 hosts 文件：
   ```
   127.0.0.1 qms.local
   127.0.0.1 preview.qms.local
   ```

2. 使用不同的端口模拟不同环境

## 用户体验优化

### 切换流程
1. 用户点击"切换到预览版/正式版"按钮
2. 系统自动构建新的 URL（保持当前路径和查询参数）
3. 页面跳转到新环境
4. 由于 Token 共享，用户无需重新登录
5. 用户继续在新环境中操作

### 视觉反馈
- 预览环境显示红色"预览版"标识
- 切换按钮文本清晰明确
- 移动端在用户菜单中提供切换入口

## 安全考虑

1. **权限隔离**: 虽然数据共享，但可以通过功能开关（Feature Flags）控制预览环境的功能可见性
2. **访问控制**: 可以在 Nginx 层面限制预览环境的访问 IP
3. **数据保护**: 预览环境的数据库操作遵循非破坏性原则，避免影响正式环境

## 相关需求

- Requirements: 2.12.1 双环境架构策略
- Requirements: 2.12.2 数据库兼容性规范
- Requirements: 2.12.3 灰度测试开关

## 测试建议

1. **功能测试**:
   - 验证环境识别是否正确
   - 验证切换按钮文本是否正确
   - 验证环境标识是否显示

2. **集成测试**:
   - 验证环境切换后 Token 是否有效
   - 验证环境切换后路径是否保持
   - 验证环境切换后数据是否一致

3. **用户体验测试**:
   - 验证移动端切换流程
   - 验证桌面端切换流程
   - 验证环境标识的可见性
