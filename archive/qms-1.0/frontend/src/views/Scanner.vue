<template>
  <FullscreenScanLayout>
    <div class="scanner-container">
      <!-- 扫描框 -->
      <div class="scan-frame">
        <div class="scan-line"></div>
        <div class="corner top-left"></div>
        <div class="corner top-right"></div>
        <div class="corner bottom-left"></div>
        <div class="corner bottom-right"></div>
      </div>

      <!-- 提示文字 -->
      <div class="scan-hint">
        请将条码对准扫描框
      </div>

      <!-- 扫描结果显示 -->
      <div v-if="scanResult" class="scan-result" :class="resultClass">
        <el-icon class="result-icon">
          <SuccessFilled v-if="scanResult.status === 'pass'" />
          <CircleCloseFilled v-else />
        </el-icon>
        <div class="result-text">{{ scanResult.message }}</div>
        <div class="result-detail" v-if="scanResult.detail">
          {{ scanResult.detail }}
        </div>
      </div>

      <!-- 手动输入按钮 -->
      <div class="manual-input-section">
        <el-button 
          type="primary" 
          size="large" 
          @click="showManualInput = true"
          class="manual-btn"
        >
          手动输入
        </el-button>
      </div>

      <!-- 统计信息 -->
      <div class="scan-stats">
        <div class="stat-item">
          <span class="stat-label">已扫描:</span>
          <span class="stat-value">{{ scannedCount }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">目标:</span>
          <span class="stat-value">{{ targetCount }}</span>
        </div>
      </div>
    </div>

    <!-- 手动输入对话框 -->
    <el-dialog
      v-model="showManualInput"
      title="手动输入条码"
      width="90%"
      :close-on-click-modal="false"
    >
      <el-input
        v-model="manualCode"
        placeholder="请输入条码"
        size="large"
        autofocus
        @keyup.enter="handleManualSubmit"
      />
      <template #footer>
        <el-button @click="showManualInput = false" size="large">取消</el-button>
        <el-button type="primary" @click="handleManualSubmit" size="large">
          确认
        </el-button>
      </template>
    </el-dialog>
  </FullscreenScanLayout>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { SuccessFilled, CircleCloseFilled } from '@element-plus/icons-vue'
import FullscreenScanLayout from '@/layouts/FullscreenScanLayout.vue'

interface ScanResult {
  status: 'pass' | 'fail'
  message: string
  detail?: string
}

const scanResult = ref<ScanResult | null>(null)
const scannedCount = ref(0)
const targetCount = ref(100)
const showManualInput = ref(false)
const manualCode = ref('')

const resultClass = computed(() => {
  if (!scanResult.value) return ''
  return scanResult.value.status === 'pass' ? 'result-pass' : 'result-fail'
})

// 处理扫码（预留接口）
const handleScan = (code: string) => {
  console.log('[扫码] 接收到条码:', code)
  
  // TODO: 调用后端 API 验证条码
  // 这里仅做演示
  const isValid = Math.random() > 0.3
  
  scanResult.value = {
    status: isValid ? 'pass' : 'fail',
    message: isValid ? 'PASS - 验证通过' : 'FAIL - 验证失败',
    detail: isValid ? `条码: ${code}` : `错误: 条码格式不正确`
  }
  
  if (isValid) {
    scannedCount.value++
  }
  
  // 3秒后清除结果
  setTimeout(() => {
    scanResult.value = null
  }, 3000)
}

// 手动输入提交
const handleManualSubmit = () => {
  if (!manualCode.value.trim()) {
    return
  }
  
  handleScan(manualCode.value)
  manualCode.value = ''
  showManualInput.value = false
}

// 监听键盘输入（扫码枪输入）
const handleKeyPress = (event: KeyboardEvent) => {
  // 扫码枪通常会快速输入并以回车结束
  // 这里简化处理，实际应用需要更复杂的逻辑
  if (event.key === 'Enter' && !showManualInput.value) {
    // 模拟扫码
    const mockCode = `SCAN${Date.now()}`
    handleScan(mockCode)
  }
}

onMounted(() => {
  window.addEventListener('keypress', handleKeyPress)
})

onUnmounted(() => {
  window.removeEventListener('keypress', handleKeyPress)
})
</script>

<style scoped>
.scanner-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px;
  color: #fff;
}

/* 扫描框 */
.scan-frame {
  position: relative;
  width: 300px;
  height: 200px;
  border: 2px solid rgba(255, 255, 255, 0.5);
  margin-bottom: 30px;
  overflow: hidden;
}

/* 扫描线动画 */
.scan-line {
  position: absolute;
  width: 100%;
  height: 2px;
  background: linear-gradient(90deg, transparent, #00ff00, transparent);
  animation: scan 2s linear infinite;
}

@keyframes scan {
  0% {
    top: 0;
  }
  100% {
    top: 100%;
  }
}

/* 四角标记 */
.corner {
  position: absolute;
  width: 20px;
  height: 20px;
  border: 3px solid #00ff00;
}

.corner.top-left {
  top: -2px;
  left: -2px;
  border-right: none;
  border-bottom: none;
}

.corner.top-right {
  top: -2px;
  right: -2px;
  border-left: none;
  border-bottom: none;
}

.corner.bottom-left {
  bottom: -2px;
  left: -2px;
  border-right: none;
  border-top: none;
}

.corner.bottom-right {
  bottom: -2px;
  right: -2px;
  border-left: none;
  border-top: none;
}

/* 提示文字 */
.scan-hint {
  font-size: 18px;
  color: rgba(255, 255, 255, 0.8);
  margin-bottom: 30px;
}

/* 扫描结果 */
.scan-result {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  padding: 40px;
  border-radius: 12px;
  text-align: center;
  min-width: 300px;
  animation: fadeIn 0.3s ease-in;
}

.result-pass {
  background-color: rgba(0, 255, 0, 0.9);
}

.result-fail {
  background-color: rgba(255, 0, 0, 0.9);
}

.result-icon {
  font-size: 64px;
  margin-bottom: 16px;
}

.result-text {
  font-size: 24px;
  font-weight: bold;
  margin-bottom: 8px;
}

.result-detail {
  font-size: 16px;
  opacity: 0.9;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.8);
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
}

/* 手动输入按钮 */
.manual-input-section {
  margin-top: 30px;
}

.manual-btn {
  min-width: 150px;
  height: 48px;
  font-size: 18px;
}

/* 统计信息 */
.scan-stats {
  position: fixed;
  bottom: 30px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 40px;
  background-color: rgba(0, 0, 0, 0.7);
  padding: 16px 32px;
  border-radius: 8px;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.stat-label {
  font-size: 16px;
  color: rgba(255, 255, 255, 0.7);
}

.stat-value {
  font-size: 24px;
  font-weight: bold;
  color: #00ff00;
}

/* 移动端适配 */
@media (max-width: 640px) {
  .scan-frame {
    width: 250px;
    height: 150px;
  }

  .scan-hint {
    font-size: 16px;
  }

  .scan-result {
    min-width: 250px;
    padding: 30px;
  }

  .result-icon {
    font-size: 48px;
  }

  .result-text {
    font-size: 20px;
  }

  .result-detail {
    font-size: 14px;
  }

  .scan-stats {
    gap: 20px;
    padding: 12px 24px;
  }

  .stat-label {
    font-size: 14px;
  }

  .stat-value {
    font-size: 20px;
  }
}
</style>
