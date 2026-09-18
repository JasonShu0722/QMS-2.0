<template>
  <transition name="slide-down">
    <div v-if="!isOnline" class="offline-indicator">
      <el-icon class="indicator-icon"><WarningFilled /></el-icon>
      <span>当前离线，数据将暂存本地</span>
      <span v-if="pendingCount > 0" class="pending-badge">
        ({{ pendingCount }} 条待同步)
      </span>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { WarningFilled } from '@element-plus/icons-vue'
import { useOfflineStorage } from '@/composables/useOfflineStorage'

const { isOnline, pendingItems, init, cleanup } = useOfflineStorage()

const pendingCount = computed(() => pendingItems.value.length)

onMounted(() => {
  init()
})

onUnmounted(() => {
  cleanup()
})
</script>

<script lang="ts">
import { computed } from 'vue'
export default {
  name: 'OfflineIndicator'
}
</script>

<style scoped>
.offline-indicator {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  background-color: #f56c6c;
  color: #fff;
  text-align: center;
  padding: 10px;
  font-size: 14px;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.indicator-icon {
  font-size: 18px;
}

.pending-badge {
  background-color: rgba(255, 255, 255, 0.3);
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 12px;
  margin-left: 4px;
}

.slide-down-enter-active,
.slide-down-leave-active {
  transition: transform 0.3s ease-out;
}

.slide-down-enter-from {
  transform: translateY(-100%);
}

.slide-down-leave-to {
  transform: translateY(-100%);
}
</style>
