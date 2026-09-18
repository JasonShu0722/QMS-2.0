<template>
  <div class="quality-dashboard">
    <div class="dashboard-header">
      <div class="controls">
        <el-date-picker
          v-model="selectedDate"
          type="date"
          placeholder="选择日期"
          format="YYYY-MM-DD"
          value-format="YYYY-MM-DD"
          @change="loadDashboard"
        />

        <el-select
          v-model="selectedMetricType"
          placeholder="选择指标类型"
          class="control-field"
          @change="loadTrendData"
        >
          <el-option
            v-for="metric in availableMetrics"
            :key="metric.value"
            :label="metric.label"
            :value="metric.value"
          />
        </el-select>

        <el-date-picker
          v-model="dateRange"
          type="daterange"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          format="YYYY-MM-DD"
          value-format="YYYY-MM-DD"
          @change="loadTrendData"
        />

        <el-button :icon="Refresh" @click="refreshAll">刷新</el-button>
      </div>
    </div>

    <div v-if="loading" class="loading-container">
      <el-skeleton :rows="6" animated />
    </div>

    <div v-else class="dashboard-content">
      <div class="metrics-grid">
        <el-card
          v-for="metric in visibleDashboardMetrics"
          :key="metric.metric_type"
          class="metric-card"
          :class="[
            getMetricCardClass(metric.status),
            { 'metric-card--active': metric.metric_type === selectedMetricType },
          ]"
          shadow="hover"
          @click="handleMetricClick(metric)"
        >
          <div class="metric-header">
            <span class="metric-name">{{ metric.metric_name }}</span>
            <el-tag :type="getTagType(metric.status)" size="small">
              {{ getStatusText(metric.status) }}
            </el-tag>
          </div>

          <div class="metric-value">
            {{ formatMetricValue(metric.current_value, metric.metric_type, metric.hasData) }}
          </div>

          <div class="metric-footer">
            <span>
              目标:
              {{ formatMetricValue(metric.target_value, metric.metric_type, metric.hasData && metric.target_value !== null) }}
            </span>
            <span :class="getTrendClass(metric.trend)">
              <template v-if="metric.hasData && metric.change_percentage !== null">
                <el-icon v-if="metric.trend === 'up'"><Top /></el-icon>
                <el-icon v-else-if="metric.trend === 'down'"><Bottom /></el-icon>
                <el-icon v-else><Minus /></el-icon>
                {{ `${Math.abs(metric.change_percentage).toFixed(1)}%` }}
              </template>
              <template v-else>--</template>
            </span>
          </div>
        </el-card>
      </div>

      <el-card class="summary-card" v-if="dashboardSummary">
        <div class="summary-content">
          <div class="summary-item">
            <div class="summary-value">{{ dashboardSummary.total_metrics }}</div>
            <div class="summary-label">总指标数</div>
          </div>
          <div class="summary-item">
            <div class="summary-value summary-value--good">{{ dashboardSummary.good_count }}</div>
            <div class="summary-label">达标指标</div>
          </div>
          <div class="summary-item">
            <div class="summary-value summary-value--danger">{{ dashboardSummary.danger_count }}</div>
            <div class="summary-label">未达标指标</div>
          </div>
        </div>
      </el-card>

      <el-card class="chart-card" v-if="selectedMetricType">
        <template #header>
          <div class="card-toolbar">
            <span class="card-toolbar__title">{{ getMetricLabel(selectedMetricType) }}趋势分析</span>
            <el-button-group>
              <el-button size="small" @click="setQuickDateRange('week')">近 7 天</el-button>
              <el-button size="small" @click="setQuickDateRange('month')">近 30 天</el-button>
              <el-button size="small" @click="setQuickDateRange('quarter')">近 3 个月</el-button>
            </el-button-group>
          </div>
        </template>
        <div ref="trendChartRef" class="chart-container"></div>
      </el-card>
    </div>

    <AIAssistant />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Bottom, Minus, Refresh, Top } from '@element-plus/icons-vue'
import * as echarts from 'echarts'
import type { ECharts } from 'echarts'
import {
  getDashboard,
  getMetricTrend,
} from '@/api/quality-metrics'
import { useAuthStore } from '@/stores/auth'
import type {
  DashboardMetricSummary,
  DashboardResponse,
  MetricStatus,
  MetricTrendResponse,
} from '@/types/quality-metrics'
import AIAssistant from '@/components/AIAssistant.vue'

type QuickRange = 'week' | 'month' | 'quarter'
type DisplayDashboardMetric = DashboardMetricSummary & { hasData: boolean }

const INTERNAL_METRICS = [
  { label: '来料批次合格率', value: 'incoming_batch_pass_rate' },
  { label: '物料上线不良PPM', value: 'material_online_ppm' },
  { label: '过程不合格率', value: 'process_defect_rate' },
  { label: '过程直通率', value: 'process_fpy' },
  { label: '0KM不良PPM', value: '0km_ppm' },
  { label: '3MIS售后不良PPM', value: '3mis_ppm' },
  { label: '12MIS售后不良PPM', value: '12mis_ppm' },
]

const SUPPLIER_METRICS = INTERNAL_METRICS.filter((metric) =>
  ['incoming_batch_pass_rate', 'material_online_ppm'].includes(metric.value)
)

const authStore = useAuthStore()

const loading = ref(false)
const selectedDate = ref<string>(new Date().toISOString().split('T')[0])
const selectedMetricType = ref<string>('')
const dateRange = ref<[string, string]>([
  new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  new Date().toISOString().split('T')[0],
])
const dashboardData = ref<DashboardResponse>()

const trendChartRef = ref<HTMLElement>()

let trendChart: ECharts | null = null

const availableMetrics = computed(() => (authStore.isSupplier ? SUPPLIER_METRICS : INTERNAL_METRICS))
const availableMetricTypes = computed(() => new Set(availableMetrics.value.map((metric) => metric.value)))
const visibleDashboardMetrics = computed<DisplayDashboardMetric[]>(() =>
  availableMetrics.value.map((metric) => {
    const matchedMetric = (dashboardData.value?.metrics || []).find(
      (item) => item.metric_type === metric.value
    )

    if (matchedMetric) {
      return {
        ...matchedMetric,
        hasData: true,
      }
    }

    return {
      metric_type: metric.value,
      metric_name: metric.label,
      current_value: 0,
      target_value: null,
      is_target_met: null,
      status: 'unknown',
      trend: 'stable',
      change_percentage: null,
      hasData: false,
    }
  })
)
const dashboardSummary = computed(() => {
  const metrics = visibleDashboardMetrics.value.filter((metric) => metric.hasData)
  if (!metrics.length) {
    return null
  }

  return {
    total_metrics: metrics.length,
    good_count: metrics.filter((metric) => metric.status === 'good').length,
    danger_count: metrics.filter((metric) => metric.status === 'danger').length,
  }
})

const getMetricLabel = (metricType: string): string =>
  availableMetrics.value.find((metric) => metric.value === metricType)?.label || metricType

async function loadDashboard() {
  loading.value = true
  try {
    dashboardData.value = await getDashboard(selectedDate.value)

    const nextMetric = visibleDashboardMetrics.value[0]?.metric_type || availableMetrics.value[0]?.value || ''
    if (!availableMetricTypes.value.has(selectedMetricType.value)) {
      selectedMetricType.value = nextMetric
    }

    if (selectedMetricType.value) {
      await loadTrendData()
    }
  } catch (error) {
    console.error('Failed to load dashboard:', error)
    ElMessage.error('加载质量数据面板失败')
  } finally {
    loading.value = false
  }
}

async function loadTrendData() {
  if (!selectedMetricType.value || !dateRange.value) {
    return
  }

  try {
    const response: MetricTrendResponse = await getMetricTrend({
      metric_type: selectedMetricType.value,
      start_date: dateRange.value[0],
      end_date: dateRange.value[1],
    })
    renderTrendChart(response)
  } catch (error) {
    console.error('Failed to load trend data:', error)
    ElMessage.error('加载趋势数据失败')
  }
}

function renderTrendChart(data: MetricTrendResponse) {
  if (!trendChartRef.value) {
    return
  }

  if (!trendChart) {
    trendChart = echarts.init(trendChartRef.value)
  }

  if (!data.data_points.length) {
    trendChart.setOption({
      graphic: [
        {
          type: 'text',
          left: 'center',
          top: 'middle',
          style: {
            text: '暂无趋势数据',
            fill: '#909399',
            fontSize: 16,
            fontWeight: 500,
          },
        },
      ],
      xAxis: { show: false },
      yAxis: { show: false },
      series: [],
    })
    return
  }

  const option: echarts.EChartsOption = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
    },
    legend: {
      data: ['实际值', '目标值'],
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: data.data_points.map((point) => point.metric_date),
    },
    yAxis: {
      type: 'value',
      name: getMetricLabel(selectedMetricType.value),
    },
    series: [
      {
        name: '实际值',
        type: 'line',
        smooth: true,
        data: data.data_points.map((point) => point.value),
        itemStyle: { color: '#409eff' },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(64, 158, 255, 0.3)' },
            { offset: 1, color: 'rgba(64, 158, 255, 0.05)' },
          ]),
        },
      },
      {
        name: '目标值',
        type: 'line',
        data: data.data_points.map((point) => point.target_value),
        lineStyle: {
          type: 'dashed',
          color: '#67c23a',
        },
        itemStyle: { color: '#67c23a' },
      },
    ],
  }

  trendChart.setOption(option)
}

function setQuickDateRange(range: QuickRange) {
  const end = new Date()
  const start = new Date()

  if (range === 'week') {
    start.setDate(end.getDate() - 7)
  } else if (range === 'month') {
    start.setDate(end.getDate() - 30)
  } else {
    start.setMonth(end.getMonth() - 3)
  }

  dateRange.value = [
    start.toISOString().split('T')[0],
    end.toISOString().split('T')[0],
  ]
  loadTrendData()
}

function refreshAll() {
  loadDashboard()
}

function handleMetricClick(metric: DisplayDashboardMetric) {
  selectedMetricType.value = metric.metric_type
  loadTrendData()
}

function formatMetricValue(value: number | null, metricType: string, hasData = true): string {
  if (!hasData || value === null || Number.isNaN(value)) {
    return '--'
  }

  if (metricType.includes('ppm')) {
    return `${value.toFixed(0)} PPM`
  }

  if (metricType.includes('rate') || metricType.includes('fpy')) {
    return `${value.toFixed(2)}%`
  }

  return value.toFixed(2)
}

function getMetricCardClass(status: MetricStatus): string {
  if (status === 'good') {
    return 'metric-card--good'
  }
  if (status === 'danger') {
    return 'metric-card--danger'
  }
  if (status === 'warning') {
    return 'metric-card--warning'
  }
  return 'metric-card--default'
}

function getTagType(status: MetricStatus): 'success' | 'danger' | 'warning' | 'info' {
  if (status === 'good') {
    return 'success'
  }
  if (status === 'danger') {
    return 'danger'
  }
  if (status === 'warning') {
    return 'warning'
  }
  return 'info'
}

function getStatusText(status: MetricStatus): string {
  if (status === 'good') {
    return '达标'
  }
  if (status === 'danger') {
    return '未达标'
  }
  if (status === 'warning') {
    return '预警'
  }
  return '未知'
}

function getTrendClass(trend: string): string {
  if (trend === 'up') {
    return 'metric-trend metric-trend--up'
  }
  if (trend === 'down') {
    return 'metric-trend metric-trend--down'
  }
  return 'metric-trend metric-trend--stable'
}

function handleResize() {
  trendChart?.resize()
}

onMounted(() => {
  loadDashboard()
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  trendChart?.dispose()
  window.removeEventListener('resize', handleResize)
})
</script>

<style scoped>
.quality-dashboard {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.control-field {
  width: 240px;
}

.loading-container {
  padding: 40px;
}

.dashboard-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
}

.metric-card {
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.metric-card--active {
  box-shadow: 0 0 0 2px rgba(64, 158, 255, 0.22);
}

.metric-card:hover {
  transform: translateY(-2px);
}

.metric-card--good {
  border-left: 4px solid #67c23a;
}

.metric-card--warning {
  border-left: 4px solid #e6a23c;
}

.metric-card--danger {
  border-left: 4px solid #f56c6c;
}

.metric-card--default {
  border-left: 4px solid #c0c4cc;
}

.metric-header,
.metric-footer,
.card-toolbar,
.summary-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.metric-header {
  align-items: flex-start;
  margin-bottom: 10px;
}

.metric-name,
.card-toolbar__title {
  font-weight: 600;
  color: #1f2a37;
}

.metric-value {
  margin-bottom: 12px;
  font-size: 30px;
  font-weight: 700;
  color: #111827;
}

.metric-footer {
  color: #6b7280;
  font-size: 13px;
}

.metric-trend {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 600;
}

.metric-trend--up {
  color: #f56c6c;
}

.metric-trend--down {
  color: #67c23a;
}

.metric-trend--stable {
  color: #909399;
}

.summary-card,
.chart-card {
  border-radius: 16px;
}

.summary-content {
  justify-content: space-around;
}

.summary-item {
  text-align: center;
}

.summary-value {
  font-size: 28px;
  font-weight: 700;
  color: #111827;
}

.summary-value--good {
  color: #67c23a;
}

.summary-value--danger {
  color: #f56c6c;
}

.summary-label {
  margin-top: 6px;
  color: #6b7280;
  font-size: 13px;
}

.chart-container {
  width: 100%;
  min-height: 400px;
}

@media (max-width: 768px) {
  .controls,
  .summary-content,
  .card-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .control-field {
    width: 100%;
  }

  .chart-container {
    min-height: 320px;
  }
}
</style>
