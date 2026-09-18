<template>
  <div class="fullscreen-scan-layout">
    <!-- 全屏扫描内容区域 -->
    <div class="scan-content">
      <slot />
    </div>

    <!-- 退出按钮（可选） -->
    <div class="exit-button" v-if="showExitButton">
      <el-button 
        circle 
        size="large" 
        @click="handleExit"
        class="exit-btn"
      >
        <el-icon><Close /></el-icon>
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { Close } from '@element-plus/icons-vue'

interface Props {
  showExitButton?: boolean
}

withDefaults(defineProps<Props>(), {
  showExitButton: true
})

const router = useRouter()

// 退出全屏模式
const handleExit = () => {
  // 退出全屏
  if (document.fullscreenElement) {
    document.exitFullscreen()
  }
  
  // 返回上一页或指定页面
  router.back()
}

// 进入全屏模式（预留功能）
// const enterFullscreen = () => {
//   const element = document.documentElement
//   if (element.requestFullscreen) {
//     element.requestFullscreen().catch(err => {
//       console.warn('无法进入全屏模式:', err)
//     })
//   }
// }

onMounted(() => {
  // 自动进入全屏（可选）
  // enterFullscreen()
})

onUnmounted(() => {
  // 退出时确保退出全屏
  if (document.fullscreenElement) {
    document.exitFullscreen()
  }
})
</script>

<style scoped>
.fullscreen-scan-layout {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  width: 100vw;
  height: 100vh;
  background-color: #000;
  z-index: 9999;
  overflow: hidden;
}

.scan-content {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.exit-button {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 10000;
}

.exit-btn {
  background-color: rgba(255, 255, 255, 0.9);
  border: none;
  width: 48px;
  height: 48px;
  font-size: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.exit-btn:hover {
  background-color: #fff;
}

/* 全屏模式下隐藏所有其他元素 */
:fullscreen .scan-content {
  background-color: #000;
}
</style>
