# 公告栏组件文档

本文档描述公告栏相关组件的使用方法和功能说明。

## 组件列表

### 1. AnnouncementList.vue - 公告列表组件

公告列表组件用于展示系统公告，支持分页、筛选和详情查看。

#### 功能特性

- ✅ 按发布时间倒序展示公告
- ✅ 未读公告置顶并高亮显示
- ✅ 重要公告边框加粗标识
- ✅ 支持分页加载
- ✅ 点击查看详情
- ✅ 自动标记已读
- ✅ 移动端响应式适配

#### 使用示例

```vue
<template>
  <div>
    <AnnouncementList ref="announcementListRef" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import AnnouncementList from '@/components/AnnouncementList.vue'

const announcementListRef = ref<InstanceType<typeof AnnouncementList>>()

// 刷新列表
const refreshList = () => {
  announcementListRef.value?.refresh()
}
</script>
```

#### 公告排序规则

1. 未读公告优先（置顶）
2. 重要公告优先
3. 按发布时间倒序

#### 公告类型标识

- **系统公告** (system): 蓝色标签
- **质量预警** (quality_alert): 黄色标签
- **文件更新** (document_update): 绿色标签

---

### 2. AnnouncementDialog.vue - 重要公告弹窗组件

重要公告弹窗组件用于登录后自动弹出未读的重要公告，强制用户阅读。

#### 功能特性

- ✅ 登录后自动弹出未读重要公告
- ✅ 强制阅读机制（需滚动到底部才能点击"我已阅读"）
- ✅ 支持多条公告依次展示
- ✅ 显示当前阅读进度（第几条/共几条）
- ✅ 自动标记已读
- ✅ 移动端响应式适配

#### 使用示例

```vue
<template>
  <div>
    <AnnouncementDialog
      v-model="showDialog"
      :announcements="unreadAnnouncements"
      @all-read="handleAllRead"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import AnnouncementDialog from '@/components/AnnouncementDialog.vue'
import type { Announcement } from '@/types/announcement'

const showDialog = ref(false)
const unreadAnnouncements = ref<Announcement[]>([])

const handleAllRead = () => {
  console.log('所有重要公告已阅读完毕')
}
</script>
```

#### Props

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| modelValue | boolean | 是 | 控制对话框显示/隐藏 |
| announcements | Announcement[] | 是 | 未读重要公告列表 |

#### Events

| 事件名 | 参数 | 说明 |
|--------|------|------|
| update:modelValue | value: boolean | 对话框显示状态变化 |
| allRead | - | 所有公告已阅读完毕 |

#### 强制阅读机制

1. 用户必须滚动到内容底部才能点击"我已阅读"按钮
2. 如果内容不需要滚动（内容较短），则直接允许点击
3. 滚动提示动画引导用户阅读完整内容

---

## API 接口

### announcementApi

公告相关的 API 接口封装。

```typescript
import { announcementApi } from '@/api/announcement'

// 获取公告列表
const response = await announcementApi.getAnnouncements(page, pageSize)

// 获取未读重要公告
const announcements = await announcementApi.getUnreadImportantAnnouncements()

// 标记公告为已读
await announcementApi.markAsRead(announcementId)
```

---

## 类型定义

### Announcement

```typescript
interface Announcement {
  id: number
  title: string
  content: string
  type: AnnouncementType // 'system' | 'quality_alert' | 'document_update'
  importance: AnnouncementImportance // 'normal' | 'important'
  is_published: boolean
  published_at: string
  created_by: number
  created_at: string
  updated_at: string
  is_read?: boolean // 当前用户是否已读
  read_at?: string // 当前用户阅读时间
}
```

---

## 集成到工作台

在 `Workbench.vue` 中已集成重要公告弹窗：

```vue
<template>
  <div class="workbench-container">
    <!-- 重要公告弹窗 -->
    <AnnouncementDialog
      v-model="showAnnouncementDialog"
      :announcements="unreadImportantAnnouncements"
      @all-read="handleAllAnnouncementsRead"
    />
    
    <!-- 其他内容 -->
  </div>
</template>

<script setup lang="ts">
// 登录后自动加载未读重要公告
onMounted(() => {
  loadDashboardData()
  loadUnreadImportantAnnouncements()
})
</script>
```

---

## 样式说明

### 未读公告高亮

- 背景色：浅蓝色 (`var(--el-color-primary-light-9)`)
- 边框色：蓝色 (`var(--el-color-primary-light-5)`)
- 标题字体：加粗，蓝色

### 重要公告标识

- 边框：2px 加粗
- 边框色：红色 (`var(--el-color-danger-light-5)`)
- 标签：红色"重要"标签

### 移动端适配

- 响应式布局，自动适配手机屏幕
- 对话框宽度调整为 90%
- 字体大小和间距优化

---

## 注意事项

1. **后端 API 依赖**：组件依赖后端提供以下 API：
   - `GET /api/v1/announcements` - 获取公告列表
   - `GET /api/v1/announcements/unread-important` - 获取未读重要公告
   - `POST /api/v1/announcements/{id}/read` - 标记已读

2. **权限控制**：公告查看权限由后端控制，前端仅负责展示

3. **性能优化**：
   - 公告列表支持分页加载
   - 已读状态缓存在前端，减少重复请求

4. **用户体验**：
   - 重要公告弹窗不可通过点击遮罩层关闭
   - 必须阅读完所有重要公告才能关闭弹窗
   - 提供清晰的阅读进度提示

---

## 后续扩展

可以考虑的功能扩展：

- [ ] 公告搜索功能
- [ ] 公告类型筛选
- [ ] 公告收藏功能
- [ ] 公告评论功能
- [ ] 公告分享功能
- [ ] 公告推送通知（WebSocket）
