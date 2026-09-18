<template>
  <div class="announcement-list">
    <!-- 加载状态 -->
    <div v-if="loading" class="loading-container">
      <el-icon class="is-loading">
        <Loading />
      </el-icon>
      <span>加载中...</span>
    </div>

    <!-- 公告列表 -->
    <div v-else-if="announcements.length > 0" class="announcements-container">
      <div
        v-for="announcement in sortedAnnouncements"
        :key="announcement.id"
        class="announcement-item"
        :class="{
          'unread': !announcement.is_read,
          'important': announcement.importance === 'important'
        }"
        @click="handleAnnouncementClick(announcement)"
      >
        <!-- 公告头部 -->
        <div class="announcement-header">
          <div class="title-row">
            <!-- 重要标识 -->
            <el-tag
              v-if="announcement.importance === 'important'"
              type="danger"
              size="small"
              effect="dark"
            >
              重要
            </el-tag>
            
            <!-- 类型标识 -->
            <el-tag
              :type="getTypeTagType(announcement.type)"
              size="small"
            >
              {{ getTypeLabel(announcement.type) }}
            </el-tag>

            <!-- 未读标识 -->
            <el-badge
              v-if="!announcement.is_read"
              is-dot
              class="unread-badge"
            />

            <!-- 标题 -->
            <h3 class="announcement-title">{{ announcement.title }}</h3>
          </div>

          <!-- 发布时间 -->
          <span class="publish-time">
            {{ formatPublishTime(announcement.published_at) }}
          </span>
        </div>

        <!-- 公告内容预览 -->
        <div class="announcement-content">
          {{ truncateContent(announcement.content) }}
        </div>
      </div>

      <!-- 分页 -->
      <div v-if="total > pageSize" class="pagination-container">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :total="total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next, jumper"
          @current-change="handlePageChange"
          @size-change="handleSizeChange"
        />
      </div>
    </div>

    <!-- 空状态 -->
    <el-empty
      v-else
      description="暂无公告"
      :image-size="120"
    />

    <!-- 公告详情对话框 -->
    <el-dialog
      v-model="detailDialogVisible"
      :title="selectedAnnouncement?.title"
      width="600px"
      :close-on-click-modal="false"
    >
      <div v-if="selectedAnnouncement" class="announcement-detail">
        <!-- 元信息 -->
        <div class="meta-info">
          <el-tag
            v-if="selectedAnnouncement.importance === 'important'"
            type="danger"
            size="small"
            effect="dark"
          >
            重要
          </el-tag>
          <el-tag
            :type="getTypeTagType(selectedAnnouncement.type)"
            size="small"
          >
            {{ getTypeLabel(selectedAnnouncement.type) }}
          </el-tag>
          <span class="publish-time">
            发布时间：{{ formatPublishTime(selectedAnnouncement.published_at) }}
          </span>
        </div>

        <!-- 内容 -->
        <div class="content-body" v-html="formatContent(selectedAnnouncement.content)"></div>
      </div>

      <template #footer>
        <el-button @click="detailDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Loading } from '@element-plus/icons-vue'
import { announcementApi } from '@/api/announcement'
import type { Announcement, AnnouncementType } from '@/types/announcement'

// 响应式数据
const loading = ref(false)
const announcements = ref<Announcement[]>([])
const total = ref(0)
const currentPage = ref(1)
const pageSize = ref(20)
const detailDialogVisible = ref(false)
const selectedAnnouncement = ref<Announcement | null>(null)

// 排序后的公告列表：未读置顶，重要公告优先，按发布时间倒序
const sortedAnnouncements = computed(() => {
  return [...announcements.value].sort((a, b) => {
    // 1. 未读优先
    if (a.is_read !== b.is_read) {
      return a.is_read ? 1 : -1
    }
    
    // 2. 重要公告优先
    if (a.importance !== b.importance) {
      return a.importance === 'important' ? -1 : 1
    }
    
    // 3. 按发布时间倒序
    return new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
  })
})

/**
 * 获取公告列表
 */
const fetchAnnouncements = async () => {
  loading.value = true
  try {
    const response = await announcementApi.getAnnouncements(
      currentPage.value,
      pageSize.value
    )
    announcements.value = response.announcements
    total.value = response.total
  } catch (error: any) {
    ElMessage.error(error.message || '获取公告列表失败')
  } finally {
    loading.value = false
  }
}

/**
 * 处理公告点击
 */
const handleAnnouncementClick = async (announcement: Announcement) => {
  selectedAnnouncement.value = announcement
  detailDialogVisible.value = true

  // 如果未读，标记为已读
  if (!announcement.is_read) {
    try {
      await announcementApi.markAsRead(announcement.id)
      announcement.is_read = true
      announcement.read_at = new Date().toISOString()
    } catch (error: any) {
      console.error('标记已读失败:', error)
    }
  }
}

/**
 * 页码变化
 */
const handlePageChange = (page: number) => {
  currentPage.value = page
  fetchAnnouncements()
}

/**
 * 每页数量变化
 */
const handleSizeChange = (size: number) => {
  pageSize.value = size
  currentPage.value = 1
  fetchAnnouncements()
}

/**
 * 获取类型标签样式
 */
const getTypeTagType = (type: AnnouncementType): string => {
  const typeMap: Record<AnnouncementType, string> = {
    system: 'info',
    quality_alert: 'warning',
    document_update: 'success'
  }
  return typeMap[type] || 'info'
}

/**
 * 获取类型标签文本
 */
const getTypeLabel = (type: AnnouncementType): string => {
  const labelMap: Record<AnnouncementType, string> = {
    system: '系统公告',
    quality_alert: '质量预警',
    document_update: '文件更新'
  }
  return labelMap[type] || '未知类型'
}

/**
 * 格式化发布时间
 */
const formatPublishTime = (dateString: string): string => {
  const date = new Date(dateString)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  
  // 1小时内
  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000)
    return `${minutes}分钟前`
  }
  
  // 24小时内
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000)
    return `${hours}小时前`
  }
  
  // 7天内
  if (diff < 604800000) {
    const days = Math.floor(diff / 86400000)
    return `${days}天前`
  }
  
  // 超过7天显示完整日期
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/**
 * 截断内容（用于列表预览）
 */
const truncateContent = (content: string, maxLength: number = 100): string => {
  if (content.length <= maxLength) {
    return content
  }
  return content.substring(0, maxLength) + '...'
}

/**
 * 格式化内容（保留换行）
 */
const formatContent = (content: string): string => {
  return content.replace(/\n/g, '<br>')
}

// 组件挂载时加载数据
onMounted(() => {
  fetchAnnouncements()
})

// 暴露刷新方法供父组件调用
defineExpose({
  refresh: fetchAnnouncements
})
</script>

<style scoped lang="scss">
.announcement-list {
  width: 100%;
  min-height: 400px;

  .loading-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px 0;
    color: var(--el-text-color-secondary);

    .el-icon {
      font-size: 32px;
      margin-bottom: 12px;
    }
  }

  .announcements-container {
    .announcement-item {
      padding: 16px;
      margin-bottom: 12px;
      background: var(--el-bg-color);
      border: 1px solid var(--el-border-color-light);
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.3s;

      &:hover {
        border-color: var(--el-color-primary);
        box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);
      }

      // 未读公告高亮
      &.unread {
        background: var(--el-color-primary-light-9);
        border-color: var(--el-color-primary-light-5);
        
        .announcement-title {
          font-weight: 600;
          color: var(--el-color-primary);
        }
      }

      // 重要公告边框加粗
      &.important {
        border-width: 2px;
        border-color: var(--el-color-danger-light-5);
      }

      .announcement-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 12px;

        .title-row {
          display: flex;
          align-items: center;
          gap: 8px;
          flex: 1;

          .unread-badge {
            margin-right: 4px;
          }

          .announcement-title {
            margin: 0;
            font-size: 16px;
            font-weight: 500;
            color: var(--el-text-color-primary);
            flex: 1;
          }
        }

        .publish-time {
          font-size: 12px;
          color: var(--el-text-color-secondary);
          white-space: nowrap;
          margin-left: 12px;
        }
      }

      .announcement-content {
        font-size: 14px;
        color: var(--el-text-color-regular);
        line-height: 1.6;
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      }
    }

    .pagination-container {
      display: flex;
      justify-content: center;
      margin-top: 24px;
    }
  }

  // 详情对话框样式
  .announcement-detail {
    .meta-info {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 20px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--el-border-color-lighter);

      .publish-time {
        font-size: 13px;
        color: var(--el-text-color-secondary);
        margin-left: auto;
      }
    }

    .content-body {
      font-size: 14px;
      line-height: 1.8;
      color: var(--el-text-color-primary);
      white-space: pre-wrap;
      word-break: break-word;
    }
  }
}

// 移动端适配
@media (max-width: 768px) {
  .announcement-list {
    .announcements-container {
      .announcement-item {
        padding: 12px;

        .announcement-header {
          flex-direction: column;
          gap: 8px;

          .title-row {
            flex-wrap: wrap;

            .announcement-title {
              font-size: 14px;
              width: 100%;
            }
          }

          .publish-time {
            margin-left: 0;
          }
        }

        .announcement-content {
          font-size: 13px;
        }
      }
    }
  }

  :deep(.el-dialog) {
    width: 90% !important;
  }
}
</style>
