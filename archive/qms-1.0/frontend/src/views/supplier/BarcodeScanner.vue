<template>
  <div class="barcode-scanner" :class="{ 'fullscreen-mode': isFullscreen }">
    <!-- 顶部工具栏（非全屏模式） -->
    <div v-if="!isFullscreen" class="toolbar">
      <h2>扫码防错</h2>
      <el-button @click="toggleFullscreen" type="primary">
        <el-icon><FullScreen /></el-icon>
        全屏模式
      </el-button>
    </div>

    <!-- 全屏模式退出按钮 -->
    <div v-if="isFullscreen" class="exit-fullscreen">
      <el-button @click="toggleFullscreen" circle>
        <el-icon><Close /></el-icon>
      </el-button>
    </div>

    <!-- 扫描区域 -->
    <div class="scanner-container">
      <!-- 物料信息输入 -->
      <el-card v-if="!scanningActive" class="config-card" shadow="hover">
        <el-form :model="configForm" label-width="100px">
          <el-form-item label="物料编码">
            <el-input 
              v-model="configForm.material_code" 
              placeholder="请输入物料编码"
              size="large"
            />
          </el-form-item>
          <el-form-item label="批次号">
            <el-input 
              v-model="configForm.batch_id" 
              placeholder="请输入批次号"
              size="large"
            />
          </el-form-item>
          <el-form-item label="目标数量">
            <el-input-number 
              v-model="configForm.target_qty" 
              :min="1"
              size="large"
            />
          </el-form-item>
          <el-form-item>
            <el-button 
              type="primary" 
              size="large" 
              @click="startScanning"
              :disabled="!configForm.material_code || !configForm.batch_id"
            >
              开始扫描
            </el-button>
          </el-form-item>
        </el-form>
      </el-card>

      <!-- 扫描界面 -->
      <div v-else class="scanning-area">
        <!-- 扫描统计 -->
        <div class="scan-stats">
          <div class="stat-item">
            <div class="stat-label">已扫描</div>
            <div class="stat-value success">{{ scannedCount }}</div>
          </div>
          <div class="stat-divider">/</div>
          <div class="stat-item">
            <div class="stat-label">目标数量</div>
            <div class="stat-value">{{ configForm.target_qty }}</div>
          </div>
        </div>

        <!-- 进度条 -->
        <el-progress 
          :percentage="scanProgress" 
          :status="scanProgress === 100 ? 'success' : undefined"
          :stroke-width="20"
          class="scan-progress"
        />

        <!-- 扫描输入框 -->
        <div class="scan-input-container">
          <el-input
            ref="scanInputRef"
            v-model="currentBarcode"
            placeholder="请扫描条码..."
            size="large"
            @keyup.enter="handleScan"
            autofocus
          >
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
        </div>

        <!-- 扫描结果反馈 -->
        <transition name="fade">
          <div v-if="lastScanResult" class="scan-result" :class="`scan-result--${lastScanResult.type}`">
            <el-icon v-if="lastScanResult.type === 'success'" class="result-icon"><CircleCheck /></el-icon>
            <el-icon v-else class="result-icon"><CircleClose /></el-icon>
            <div class="result-text">{{ lastScanResult.message }}</div>
          </div>
        </transition>

        <!-- 已扫描列表 -->
        <div class="scanned-list">
          <div class="list-header">
            <span>已扫描条码</span>
            <el-button type="danger" size="small" @click="clearScanned">
              <el-icon><Delete /></el-icon>
              清空
            </el-button>
          </div>
          <div class="list-content">
            <div 
              v-for="(item, index) in scannedBarcodes" 
              :key="index" 
              class="list-item"
              :class="{ 'list-item--error': !item.valid }"
            >
              <span class="item-index">{{ index + 1 }}</span>
              <span class="item-barcode">{{ item.barcode }}</span>
              <el-icon v-if="item.valid" class="item-status success"><CircleCheck /></el-icon>
              <el-icon v-else class="item-status error"><CircleClose /></el-icon>
            </div>
          </div>
        </div>

        <!-- 操作按钮 -->
        <div class="action-buttons">
          <el-button size="large" @click="stopScanning">
            <el-icon><Close /></el-icon>
            取消
          </el-button>
          <el-button 
            type="primary" 
            size="large" 
            @click="submitBatch"
            :disabled="scannedCount === 0"
            :loading="submitting"
          >
            <el-icon><Check /></el-icon>
            提交归档
          </el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { 
  FullScreen, 
  Close, 
  Search,
  CircleCheck, 
  CircleClose, 
  Delete, 
  Check 
} from '@element-plus/icons-vue'
import { supplierApi } from '@/api/supplier'

const isFullscreen = ref(false)
const scanningActive = ref(false)
const submitting = ref(false)
const currentBarcode = ref('')
const scannedBarcodes = ref<Array<{ barcode: string; valid: boolean }>>([])
const lastScanResult = ref<{ type: 'success' | 'error'; message: string } | null>(null)
const scanInputRef = ref()

const configForm = ref({
  material_code: '',
  batch_id: '',
  target_qty: 100
})

// 已扫描数量
const scannedCount = computed(() => scannedBarcodes.value.filter(item => item.valid).length)

// 扫描进度
const scanProgress = computed(() => {
  if (configForm.value.target_qty === 0) return 0
  return Math.min(100, Math.round((scannedCount.value / configForm.value.target_qty) * 100))
})

// 切换全屏
const toggleFullscreen = () => {
  isFullscreen.value = !isFullscreen.value
  if (isFullscreen.value) {
    document.body.style.overflow = 'hidden'
  } else {
    document.body.style.overflow = ''
  }
}

// 开始扫描
const startScanning = () => {
  scanningActive.value = true
  scannedBarcodes.value = []
  nextTick(() => {
    scanInputRef.value?.focus()
  })
}

// 停止扫描
const stopScanning = () => {
  scanningActive.value = false
  currentBarcode.value = ''
  lastScanResult.value = null
}

// 处理扫描
const handleScan = async () => {
  const barcode = currentBarcode.value.trim()
  if (!barcode) return

  try {
    // 调用后端验证接口
    const result = await supplierApi.scanBarcode({
      material_code: configForm.value.material_code,
      barcode: barcode
    })

    // 显示扫描结果
    if (result.validation_result === 'pass') {
      lastScanResult.value = {
        type: 'success',
        message: 'PASS - 验证通过'
      }
      scannedBarcodes.value.push({ barcode, valid: true })
      
      // 播放成功音效（可选）
      playSound('success')
      
      // 检查是否达到目标数量
      if (scannedCount.value >= configForm.value.target_qty) {
        ElMessage.success('已达到目标数量！')
      }
    } else {
      lastScanResult.value = {
        type: 'error',
        message: `NG - ${result.validation_message || '验证失败'}`
      }
      scannedBarcodes.value.push({ barcode, valid: false })
      
      // 播放失败音效（可选）
      playSound('error')
    }

    // 清空输入框并自动聚焦
    currentBarcode.value = ''
    nextTick(() => {
      scanInputRef.value?.focus()
    })

    // 3秒后清除结果提示
    setTimeout(() => {
      lastScanResult.value = null
    }, 3000)
  } catch (error) {
    console.error('Scan validation failed:', error)
    ElMessage.error('扫描验证失败')
    currentBarcode.value = ''
  }
}

// 清空已扫描
const clearScanned = async () => {
  try {
    await ElMessageBox.confirm(
      '确认清空所有已扫描的条码吗？',
      '确认清空',
      {
        confirmButtonText: '确认',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
    scannedBarcodes.value = []
    ElMessage.success('已清空')
  } catch (error) {
    // 用户取消
  }
}

// 提交批次
const submitBatch = async () => {
  try {
    await ElMessageBox.confirm(
      `确认提交 ${scannedCount.value} 个有效条码吗？`,
      '确认提交',
      {
        confirmButtonText: '确认',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )

    submitting.value = true
    const validBarcodes = scannedBarcodes.value
      .filter(item => item.valid)
      .map(item => item.barcode)

    await supplierApi.submitBarcodeBatch({
      material_code: configForm.value.material_code,
      batch_id: configForm.value.batch_id,
      barcodes: validBarcodes
    })

    ElMessage.success('提交成功')
    stopScanning()
  } catch (error) {
    if (error !== 'cancel') {
      console.error('Failed to submit batch:', error)
      ElMessage.error('提交失败')
    }
  } finally {
    submitting.value = false
  }
}

// 播放音效（可选功能）
const playSound = (type: 'success' | 'error') => {
  // 可以使用 Web Audio API 播放音效
  // 这里仅作为示例，实际实现需要音频文件
  console.log(`Play ${type} sound`)
}
</script>

<style scoped lang="scss">
.barcode-scanner {
  padding: 20px;
  min-height: 100vh;

  &.fullscreen-mode {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 9999;
    background: #fff;
    padding: 0;

    .scanner-container {
      height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 20px;
    }
  }

  .toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;

    h2 {
      margin: 0;
      font-size: 24px;
      font-weight: 600;
    }
  }

  .exit-fullscreen {
    position: absolute;
    top: 20px;
    right: 20px;
    z-index: 10;
  }

  .scanner-container {
    max-width: 800px;
    margin: 0 auto;

    .config-card {
      padding: 20px;
    }

    .scanning-area {
      display: flex;
      flex-direction: column;
      gap: 20px;

      .scan-stats {
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 20px;
        font-size: 48px;
        font-weight: bold;

        .stat-item {
          text-align: center;

          .stat-label {
            font-size: 14px;
            color: #909399;
            margin-bottom: 8px;
          }

          .stat-value {
            color: #303133;

            &.success {
              color: #67c23a;
            }
          }
        }

        .stat-divider {
          color: #dcdfe6;
        }
      }

      .scan-progress {
        margin: 20px 0;
      }

      .scan-input-container {
        :deep(.el-input__inner) {
          font-size: 24px;
          height: 60px;
          text-align: center;
        }
      }

      .scan-result {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        padding: 30px;
        border-radius: 12px;
        font-size: 32px;
        font-weight: bold;
        animation: pulse 0.5s ease-in-out;

        .result-icon {
          font-size: 48px;
        }

        &--success {
          background: #f0f9ff;
          color: #67c23a;
          border: 3px solid #67c23a;
        }

        &--error {
          background: #fef0f0;
          color: #f56c6c;
          border: 3px solid #f56c6c;
        }
      }

      .scanned-list {
        background: #f5f7fa;
        border-radius: 8px;
        padding: 16px;
        max-height: 300px;
        overflow-y: auto;

        .list-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
          font-weight: 600;
        }

        .list-content {
          display: flex;
          flex-direction: column;
          gap: 8px;

          .list-item {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px;
            background: white;
            border-radius: 6px;
            border: 2px solid #e4e7ed;

            &--error {
              border-color: #f56c6c;
              background: #fef0f0;
            }

            .item-index {
              width: 30px;
              text-align: center;
              font-weight: bold;
              color: #909399;
            }

            .item-barcode {
              flex: 1;
              font-family: monospace;
              font-size: 16px;
            }

            .item-status {
              font-size: 24px;

              &.success {
                color: #67c23a;
              }

              &.error {
                color: #f56c6c;
              }
            }
          }
        }
      }

      .action-buttons {
        display: flex;
        gap: 12px;
        justify-content: center;

        .el-button {
          flex: 1;
          max-width: 200px;
        }
      }
    }
  }

  // 动画
  .fade-enter-active,
  .fade-leave-active {
    transition: opacity 0.3s;
  }

  .fade-enter-from,
  .fade-leave-to {
    opacity: 0;
  }

  @keyframes pulse {
    0%, 100% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.05);
    }
  }

  // 移动端适配
  @media (max-width: 768px) {
    padding: 10px;

    .scanning-area {
      .scan-stats {
        font-size: 36px;
      }

      .scan-result {
        font-size: 24px;
        padding: 20px;

        .result-icon {
          font-size: 36px;
        }
      }
    }
  }
}
</style>
