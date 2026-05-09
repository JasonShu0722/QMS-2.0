<template>
  <div class="notification-list">
    <div class="notification-header">
      <el-select
        v-model="selectedType"
        placeholder="全部通知"
        clearable
        class="type-filter"
        @change="handleTypeChange"
      >
        <el-option label="全部通知" :value="undefined" />
        <el-option
          v-for="(label, type) in NotificationTypeLabels"
          :key="type"
          :label="label"
          :value="type"
        />
      </el-select>

      <el-button
        type="primary"
        size="small"
        :disabled="notifications.length === 0 || !hasUnread"
        :loading="markingAllRead"
        @click="handleMarkAllRead"
      >
        全部已读
      </el-button>
    </div>

    <div v-loading="loading" class="notification-content">
      <el-empty
        v-if="notifications.length === 0 && !loading"
        description="暂无通知"
        :image-size="100"
      />

      <div v-else class="notification-items">
        <div
          v-for="notification in notifications"
          :key="notification.id"
          class="notification-item"
          :class="{ 'is-read': notification.is_read }"
          @click="handleNotificationClick(notification)"
        >
          <div v-if="!notification.is_read" class="unread-dot"></div>

          <div class="notification-body">
            <div class="notification-meta">
              <el-tag
                :type="getNotificationTagType(notification.message_type)"
                size="small"
                effect="plain"
              >
                {{ getNotificationTypeLabel(notification.message_type) }}
              </el-tag>
              <span class="notification-time">{{ formatTime(notification.created_at) }}</span>
            </div>

            <div class="notification-title">{{ notification.title }}</div>
            <div class="notification-text">{{ notification.content }}</div>
          </div>

          <div class="notification-actions">
            <el-button
              v-if="!notification.is_read"
              type="primary"
              size="small"
              text
              @click.stop="handleMarkRead(notification.id)"
            >
              标为已读
            </el-button>
          </div>
        </div>
      </div>

      <div v-if="total > pageSize" class="notification-pagination">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :total="total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          small
          @current-change="handlePageChange"
          @size-change="handleSizeChange"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { notificationApi } from '@/api/notification'
import type { Notification, NotificationType } from '@/types/notification'
import { NotificationTypeColors, NotificationTypeLabels } from '@/types/notification'

const emit = defineEmits<{
  notificationRead: []
  allRead: []
}>()

const router = useRouter()

const notifications = ref<Notification[]>([])
const loading = ref(false)
const markingAllRead = ref(false)
const selectedType = ref<NotificationType | undefined>(undefined)
const currentPage = ref(1)
const pageSize = ref(20)
const total = ref(0)

const hasUnread = computed(() => notifications.value.some(notification => !notification.is_read))

const getNotificationTypeLabel = (type: NotificationType) => NotificationTypeLabels[type] || '通知'

const getNotificationTagType = (type: NotificationType) => {
  return (NotificationTypeColors[type] || 'info') as
    | 'success'
    | 'warning'
    | 'info'
    | 'primary'
    | 'danger'
}

const fetchNotifications = async () => {
  loading.value = true
  try {
    const response = await notificationApi.getNotifications(
      selectedType.value,
      currentPage.value,
      pageSize.value
    )
    notifications.value = response.notifications
    total.value = response.total
  } catch (error) {
    console.error('Failed to fetch notifications:', error)
    ElMessage.error('获取通知失败')
  } finally {
    loading.value = false
  }
}

const handleTypeChange = () => {
  currentPage.value = 1
  void fetchNotifications()
}

const handlePageChange = (page: number) => {
  currentPage.value = page
  void fetchNotifications()
}

const handleSizeChange = (size: number) => {
  pageSize.value = size
  currentPage.value = 1
  void fetchNotifications()
}

const handleMarkRead = async (notificationId: number) => {
  try {
    await notificationApi.markAsRead(notificationId)
    const notification = notifications.value.find(item => item.id === notificationId)
    if (notification) {
      notification.is_read = true
      notification.read_at = new Date().toISOString()
    }
    emit('notificationRead')
  } catch (error) {
    console.error('Failed to mark as read:', error)
    ElMessage.error('标记失败')
  }
}

const handleMarkAllRead = async () => {
  markingAllRead.value = true
  try {
    await notificationApi.markAllAsRead()
    notifications.value.forEach(notification => {
      notification.is_read = true
      notification.read_at = new Date().toISOString()
    })
    emit('allRead')
  } catch (error) {
    console.error('Failed to mark all as read:', error)
    ElMessage.error('标记失败')
  } finally {
    markingAllRead.value = false
  }
}

const handleNotificationClick = async (notification: Notification) => {
  if (!notification.is_read) {
    await handleMarkRead(notification.id)
  }

  if (notification.link) {
    void router.push(notification.link)
  }
}

const formatTime = (dateString: string): string => {
  const date = new Date(dateString)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  if (hours < 24) return `${hours}小时前`
  if (days < 7) return `${days}天前`

  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

onMounted(() => {
  void fetchNotifications()
})
</script>

<style scoped lang="scss">
.notification-list {
  display: flex;
  flex-direction: column;
  height: 100%;

  .notification-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 16px;
    border-bottom: 1px solid #e5eaf3;

    .type-filter {
      width: 180px;
    }
  }

  .notification-content {
    flex: 1;
    overflow-y: auto;
  }

  .notification-item {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px;
    padding: 14px 16px 14px 24px;
    border-bottom: 1px solid #edf0f5;
    cursor: pointer;
    transition: background-color 0.18s ease;

    &:hover {
      background-color: #f7f9fc;
    }

    &.is-read {
      opacity: 0.68;
    }

    .unread-dot {
      position: absolute;
      top: 22px;
      left: 10px;
      width: 7px;
      height: 7px;
      background-color: #f56c6c;
      border-radius: 50%;
    }
  }

  .notification-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .notification-title {
    margin-bottom: 6px;
    color: #1f2d3d;
    font-size: 14px;
    font-weight: 600;
    line-height: 1.45;
  }

  .notification-text {
    color: #5c6675;
    font-size: 13px;
    line-height: 1.6;
    word-break: break-word;
  }

  .notification-time {
    color: #98a2b3;
    font-size: 12px;
  }

  .notification-actions {
    display: flex;
    align-items: flex-start;
  }

  .notification-pagination {
    display: flex;
    justify-content: center;
    padding: 14px 16px;
  }
}

@media (max-width: 768px) {
  .notification-list {
    .notification-header,
    .notification-item {
      grid-template-columns: 1fr;
    }

    .notification-header {
      align-items: stretch;

      .type-filter {
        width: 100%;
      }
    }

    .notification-actions {
      justify-content: flex-end;
    }
  }
}
</style>
