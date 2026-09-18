<template>
  <div class="trial-production-summary p-4 md:p-6">
    <div class="header mb-6">
      <el-page-header @back="handleBack" class="mb-4">
        <template #content>
          <h1 class="text-2xl font-bold">试产总结报告</h1>
        </template>
      </el-page-header>
    </div>

    <el-card v-loading="loading">
      <template v-if="summary">
        <!-- 基本信息 -->
        <div class="mb-6">
          <h2 class="text-xl font-bold mb-4">基本信息</h2>
          <el-descriptions :column="2" border>
            <el-descriptions-item label="工单号">{{ summary.trial_production.work_order }}</el-descriptions-item>
            <el-descriptions-item label="试产批次">{{ summary.trial_production.trial_batch || '-' }}</el-descriptions-item>
            <el-descriptions-item label="试产日期">{{ formatDate(summary.trial_production.trial_date || '', 'date') }}</el-descriptions-item>
            <el-descriptions-item label="状态">
              <el-tag :type="getStatusType(summary.trial_production.status)">
                {{ getStatusLabel(summary.trial_production.status) }}
              </el-tag>
            </el-descriptions-item>
          </el-descriptions>
        </div>

        <!-- 整体达成情况 -->
        <div class="mb-6">
          <h2 class="text-xl font-bold mb-4">整体达成情况</h2>
          <div class="flex items-center gap-4 mb-4">
            <el-tag :type="summary.overall_status === 'pass' ? 'success' : 'danger'" size="large">
              {{ summary.overall_status === 'pass' ? '✓ 达标' : '✗ 未达标' }}
            </el-tag>
            <span class="text-lg">
              达标指标: <span class="text-green-600 font-bold">{{ summary.pass_count }}</span> 项
            </span>
            <span class="text-lg">
              未达标指标: <span class="text-red-600 font-bold">{{ summary.fail_count }}</span> 项
            </span>
          </div>
        </div>

        <!-- 指标对比 -->
        <div class="mb-6">
          <h2 class="text-xl font-bold mb-4">指标对比（目标 vs 实绩）</h2>
          <el-table :data="metricsTableData" border stripe>
            <el-table-column prop="name" label="指标名称" width="200" />
            <el-table-column prop="target" label="目标值" width="150" align="center">
              <template #default="{ row }">
                <span class="font-semibold">{{ row.target }}{{ row.unit }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="actual" label="实绩值" width="150" align="center">
              <template #default="{ row }">
                <span class="font-semibold" :class="row.status === 'pass' ? 'text-green-600' : 'text-red-600'">
                  {{ row.actual }}{{ row.unit }}
                </span>
              </template>
            </el-table-column>
            <el-table-column prop="status" label="达成状态" width="120" align="center">
              <template #default="{ row }">
                <el-tag :type="row.status === 'pass' ? 'success' : 'danger'">
                  {{ row.status === 'pass' ? '✓ 达标' : '✗ 未达标' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="gap" label="差距" align="center">
              <template #default="{ row }">
                <span :class="row.status === 'pass' ? 'text-green-600' : 'text-red-600'">
                  {{ row.gap }}
                </span>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <!-- 改进建议 -->
        <div class="mb-6" v-if="summary.recommendations">
          <h2 class="text-xl font-bold mb-4">改进建议</h2>
          <el-alert type="info" :closable="false">
            <div class="whitespace-pre-wrap">{{ summary.recommendations }}</div>
          </el-alert>
        </div>

        <!-- 操作按钮 -->
        <div class="flex gap-4">
          <el-button type="primary" @click="handleExport('excel')">导出Excel</el-button>
          <el-button type="success" @click="handleExport('pdf')">导出PDF</el-button>
          <el-button @click="handleBack">返回</el-button>
        </div>
      </template>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { newProductApi } from '@/api/new-product'
import type { TrialProductionSummary } from '@/types/new-product'

const route = useRoute()
const router = useRouter()

const trialId = ref(Number(route.params.trialId))
const loading = ref(false)
const summary = ref<TrialProductionSummary | null>(null)

// 将指标对比数据转换为表格数据
const metricsTableData = computed(() => {
  if (!summary.value) return []
  
  const data: any[] = []
  const targetVsActual = summary.value.target_vs_actual
  
  for (const [key, value] of Object.entries(targetVsActual)) {
    const metric = value as any
    const target = metric.target
    const actual = metric.actual
    const unit = metric.unit || ''
    const status = metric.status
    
    // 计算差距
    let gap = ''
    if (typeof target === 'number' && typeof actual === 'number') {
      const diff = actual - target
      gap = diff >= 0 ? `+${diff.toFixed(2)}${unit}` : `${diff.toFixed(2)}${unit}`
    }
    
    data.push({
      name: getMetricName(key),
      target: target,
      actual: actual,
      unit: unit,
      status: status,
      gap: gap
    })
  }
  
  return data
})

// 加载数据
const loadSummary = async () => {
  loading.value = true
  try {
    summary.value = await newProductApi.getTrialSummary(trialId.value)
  } catch (error: any) {
    ElMessage.error(error.message || '加载总结报告失败')
  } finally {
    loading.value = false
  }
}

// 导出
const handleExport = async (format: 'excel' | 'pdf') => {
  try {
    if (!summary.value?.trial_production.work_order) {
      ElMessage.error('工单号不存在')
      return
    }
    const blob = await newProductApi.exportTrialSummary(trialId.value, format)
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `试产总结报告_${summary.value.trial_production.work_order}.${format === 'excel' ? 'xlsx' : 'pdf'}`
    link.click()
    window.URL.revokeObjectURL(url)
    ElMessage.success('导出成功')
  } catch (error: any) {
    ElMessage.error(error.message || '导出失败')
  }
}

// 返回
const handleBack = () => {
  router.back()
}

// 辅助函数
const getMetricName = (key: string) => {
  const names: Record<string, string> = {
    pass_rate: '直通率',
    cpk: 'CPK',
    dimension_pass_rate: '尺寸合格率',
    appearance_score: '外观评审得分',
    defect_rate: '不良率'
  }
  return names[key] || key
}

const getStatusLabel = (status: string) => {
  const labels: Record<string, string> = {
    planned: '计划中',
    in_progress: '进行中',
    completed: '已完成',
    cancelled: '已取消'
  }
  return labels[status] || status
}

const getStatusType = (status: string) => {
  const types: Record<string, any> = {
    planned: 'info',
    in_progress: 'warning',
    completed: 'success',
    cancelled: 'danger'
  }
  return types[status] || ''
}

const formatDate = (dateStr: string, type: 'date' | 'datetime' = 'datetime') => {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  return type === 'date' ? date.toLocaleDateString('zh-CN') : date.toLocaleString('zh-CN')
}

// 初始化
onMounted(() => {
  loadSummary()
})
</script>

<style scoped>
.trial-production-summary {
  min-height: 100vh;
  background-color: #f5f7fa;
}
</style>
