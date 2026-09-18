<template>
  <div class="notification-bell">
    <!-- 铃铛图标按钮 -->
    <el-badge 
      :value="unreadCount" 
      :hidden="unreadCount === 0"
      :max="99"
      class="notification-badge"
    >
      <el-button 
        :icon="Bell" 
        circle 
        @click="toggleNotificationList"
        :class="{ 'has-unread': unreadCount > 0 }"
      />
    </el-badge>

    <!-- 通知列表弹窗 -->
    <el-drawer
      v-model="drawerVisible"
      title="站内信通知"
      direction="rtl"
      size="400px"
      :before-close="handleClose"
    >
      <NotificationList 
        @notification-read="handleNotificationRead"
        @all-read="handleAllRead"
      />
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { Bell } from '@element-plus/icons-vue'
import { notificationApi } from '@/api/notification'
import NotificationList from './NotificationList.vue'

/**
 * 未读消息数量
 */
const unreadCount = ref<number>(0)

/**
 * 抽屉显示状态
 */
const drawerVisible = ref<boolean>(false)

/**
 * 轮询定时器
 */
let pollingTimer: number | null = null

/**
 * 获取未读消息数量
 */
const fetchUnreadCount = async () => {
  try {
    const response = await notificationApi.getUnreadCount()
    unreadCount.value = response.unread_count
  } catch (error) {
    console.error('Failed to fetch unread count:', error)
  }
}

/**
 * 切换通知列表显示
 */
const toggleNotificationList = () => {
  drawerVisible.value = !drawerVisible.value
}

/**
 * 关闭抽屉前的回调
 */
const handleClose = (done: () => void) => {
  done()
}

/**
 * 处理单条消息已读事件
 */
const handleNotificationRead = () => {
  // 刷新未读数量
  fetchUnreadCount()
}

/**
 * 处理全部已读事件
 */
const handleAllRead = () => {
  // 重置未读数量
  unreadCount.value = 0
}

/**
 * 启动轮询
 * 每30秒刷新一次未读数量
 */
const startPolling = () => {
  // 立即执行一次
  fetchUnreadCount()
  
  // 设置定时器
  pollingTimer = window.setInterval(() => {
    fetchUnreadCount()
  }, 30000) // 30秒
}

/**
 * 停止轮询
 */
const stopPolling = () => {
  if (pollingTimer) {
    clearInterval(pollingTimer)
    pollingTimer = null
  }
}

/**
 * 组件挂载时启动轮询
 */
onMounted(() => {
  startPolling()
})

/**
 * 组件卸载时停止轮询
 */
onUnmounted(() => {
  stopPolling()
})
</script>

<style scoped lang="scss">
.notification-bell {
  display: inline-block;
  
  .notification-badge {
    :deep(.el-badge__content) {
      background-color: #f56c6c;
      border: 2px solid #fff;
    }
  }
  
  .el-button {
    transition: all 0.3s ease;
    
    &.has-unread {
      animation: bell-shake 0.5s ease-in-out;
    }
    
    &:hover {
      transform: scale(1.1);
    }
  }
}

/**
 * 铃铛抖动动画
 */
@keyframes bell-shake {
  0%, 100% {
    transform: rotate(0deg);
  }
  10%, 30%, 50%, 70%, 90% {
    transform: rotate(-10deg);
  }
  20%, 40%, 60%, 80% {
    transform: rotate(10deg);
  }
}
</style>
