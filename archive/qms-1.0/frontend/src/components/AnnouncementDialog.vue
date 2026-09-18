<template>
  <el-dialog
    v-model="visible"
    :title="currentAnnouncement?.title"
    width="600px"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    :show-close="false"
    class="important-announcement-dialog"
  >
    <div v-if="currentAnnouncement" class="announcement-content">
      <!-- 重要提示 -->
      <el-alert
        type="warning"
        :closable="false"
        show-icon
        class="important-notice"
      >
        <template #title>
          <strong>重要公告，请仔细阅读</strong>
        </template>
      </el-alert>

      <!-- 元信息 -->
      <div class="meta-info">
        <el-tag
          :type="getTypeTagType(currentAnnouncement.type)"
          size="small"
        >
          {{ getTypeLabel(currentAnnouncement.type) }}
        </el-tag>
        <span class="publish-time">
          发布时间：{{ formatPublishTime(currentAnnouncement.published_at) }}
        </span>
      </div>

      <!-- 公告内容 -->
      <div class="content-body" v-html="formatContent(currentAnnouncement.content)"></div>

      <!-- 阅读进度提示 -->
      <div v-if="!hasScrolledToBottom" class="scroll-hint">
        <el-icon class="scroll-icon">
          <ArrowDown />
        </el-icon>
        <span>请滚动至底部阅读完整内容</span>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <!-- 显示当前是第几条/共几条 -->
        <span class="announcement-counter">
          {{ currentIndex + 1 }} / {{ announcements.length }}
        </span>

        <div class="action-buttons">
          <!-- 我已阅读按钮（需滚动到底部才能点击） -->
          <el-button
            type="primary"
            :disabled="!hasScrolledToBottom"
            :loading="marking"
            @click="handleMarkAsRead"
          >
            我已阅读
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { ArrowDown } from '@element-plus/icons-vue'
import { announcementApi } from '@/api/announcement'
import type { Announcement, AnnouncementType } from '@/types/announcement'

// Props
interface Props {
  modelValue: boolean
  announcements: Announcement[]
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: false,
  announcements: () => []
})

// Emits
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'allRead': []
}>()

// 响应式数据
const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

const currentIndex = ref(0)
const hasScrolledToBottom = ref(false)
const marking = ref(false)

// 当前显示的公告
const currentAnnouncement = computed(() => {
  return props.announcements[currentIndex.value] || null
})

/**
 * 监听内容滚动
 */
const setupScrollListener = () => {
  nextTick(() => {
    const contentBody = document.querySelector('.important-announcement-dialog .content-body')
    if (!contentBody) return

    // 检查内容是否需要滚动
    const needsScroll = contentBody.scrollHeight > contentBody.clientHeight

    if (!needsScroll) {
      // 内容不需要滚动，直接允许点击
      hasScrolledToBottom.value = true
      return
    }

    // 监听滚动事件
    const handleScroll = () => {
      const scrollTop = contentBody.scrollTop
      const scrollHeight = contentBody.scrollHeight
      const clientHeight = contentBody.clientHeight

      // 判断是否滚动到底部（允许5px误差）
      if (scrollTop + clientHeight >= scrollHeight - 5) {
        hasScrolledToBottom.value = true
        contentBody.removeEventListener('scroll', handleScroll)
      }
    }

    contentBody.addEventListener('scroll', handleScroll)
  })
}

/**
 * 监听当前公告变化，重置滚动状态
 */
watch(currentAnnouncement, () => {
  hasScrolledToBottom.value = false
  setupScrollListener()
}, { immediate: true })

/**
 * 标记当前公告为已读
 */
const handleMarkAsRead = async () => {
  if (!currentAnnouncement.value) return

  marking.value = true
  try {
    await announcementApi.markAsRead(currentAnnouncement.value.id)
    
    // 移动到下一条
    if (currentIndex.value < props.announcements.length - 1) {
      currentIndex.value++
    } else {
      // 所有公告已读完
      ElMessage.success('所有重要公告已阅读完毕')
      emit('allRead')
      visible.value = false
      currentIndex.value = 0
    }
  } catch (error: any) {
    ElMessage.error(error.message || '标记已读失败')
  } finally {
    marking.value = false
  }
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
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/**
 * 格式化内容（保留换行）
 */
const formatContent = (content: string): string => {
  return content.replace(/\n/g, '<br>')
}
</script>

<style scoped lang="scss">
.important-announcement-dialog {
  :deep(.el-dialog__header) {
    background: linear-gradient(135deg, var(--el-color-danger-light-7), var(--el-color-danger-light-9));
    padding: 20px;
    margin: 0;
    border-radius: 8px 8px 0 0;

    .el-dialog__title {
      font-size: 18px;
      font-weight: 600;
      color: var(--el-color-danger);
    }
  }

  :deep(.el-dialog__body) {
    padding: 20px;
    max-height: 60vh;
    overflow-y: auto;
  }

  :deep(.el-dialog__footer) {
    padding: 16px 20px;
    border-top: 1px solid var(--el-border-color-lighter);
  }

  .announcement-content {
    .important-notice {
      margin-bottom: 20px;
    }

    .meta-info {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 20px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--el-border-color-lighter);

      .publish-time {
        font-size: 13px;
        color: var(--el-text-color-secondary);
      }
    }

    .content-body {
      font-size: 15px;
      line-height: 1.8;
      color: var(--el-text-color-primary);
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 400px;
      overflow-y: auto;
      padding: 16px;
      background: var(--el-fill-color-light);
      border-radius: 6px;
      margin-bottom: 16px;

      // 自定义滚动条样式
      &::-webkit-scrollbar {
        width: 8px;
      }

      &::-webkit-scrollbar-track {
        background: var(--el-fill-color);
        border-radius: 4px;
      }

      &::-webkit-scrollbar-thumb {
        background: var(--el-border-color);
        border-radius: 4px;

        &:hover {
          background: var(--el-border-color-dark);
        }
      }
    }

    .scroll-hint {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 12px;
      background: var(--el-color-warning-light-9);
      border: 1px solid var(--el-color-warning-light-7);
      border-radius: 6px;
      color: var(--el-color-warning);
      font-size: 14px;
      animation: pulse 2s infinite;

      .scroll-icon {
        font-size: 18px;
        animation: bounce 1s infinite;
      }
    }
  }

  .dialog-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;

    .announcement-counter {
      font-size: 14px;
      color: var(--el-text-color-secondary);
      font-weight: 500;
    }

    .action-buttons {
      display: flex;
      gap: 12px;
    }
  }
}

// 动画效果
@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
}

@keyframes bounce {
  0%, 100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(4px);
  }
}

// 移动端适配
@media (max-width: 768px) {
  .important-announcement-dialog {
    :deep(.el-dialog) {
      width: 95% !important;
      margin: 0 auto;
    }

    :deep(.el-dialog__body) {
      max-height: 50vh;
      padding: 16px;
    }

    .announcement-content {
      .content-body {
        font-size: 14px;
        max-height: 300px;
        padding: 12px;
      }

      .scroll-hint {
        font-size: 13px;
        padding: 10px;
      }
    }

    .dialog-footer {
      flex-direction: column;
      gap: 12px;

      .announcement-counter {
        width: 100%;
        text-align: center;
      }

      .action-buttons {
        width: 100%;

        .el-button {
          flex: 1;
        }
      }
    }
  }
}
</style>
