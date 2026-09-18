<template>
  <div class="audit-report p-4 md:p-6">
    <div class="flex justify-between items-center mb-6">
      <div>
        <h1 class="text-2xl font-bold">审核报告</h1>
        <p class="text-sm text-gray-500 mt-1">Audit Report - 审核结果与雷达图分析</p>
      </div>
      <el-button @click="$router.back()">返回</el-button>
    </div>

    <el-card v-loading="loading">
      <div v-if="execution && template">
        <!-- 基本信息 -->
        <el-descriptions :column="2" border class="mb-6">
          <el-descriptions-item label="审核日期">
            {{ formatDateTime(execution.audit_date) }}
          </el-descriptions-item>
          <el-descriptions-item label="审核模板">
            {{ template.template_name }}
          </el-descriptions-item>
          <el-descriptions-item label="最终得分">
            <span class="text-2xl font-bold" :class="getScoreColor(execution.final_score)">
              {{ execution.final_score }}
            </span>
          </el-descriptions-item>
          <el-descriptions-item label="等级评定">
            <el-tag :type="getGradeType(execution.grade)" size="large">
              {{ execution.grade }}
            </el-tag>
          </el-descriptions-item>
        </el-descriptions>

        <!-- 雷达图 -->
        <div class="mb-6">
          <h3 class="text-lg font-bold mb-4">审核雷达图</h3>
          <div ref="radarChartRef" style="width: 100%; height: 400px;"></div>
        </div>

        <!-- 检查表结果 -->
        <div class="mb-6">
          <h3 class="text-lg font-bold mb-4">检查表详细结果</h3>
          <el-table :data="checklistResultsArray" border>
            <el-table-column prop="item_id" label="条款ID" width="120" />
            <el-table-column prop="title" label="条款标题" min-width="200" />
            <el-table-column label="得分" width="100">
              <template #default="{ row }">
                <span :class="getScoreColor(row.score_percentage)">
                  {{ row.score }} / {{ row.max_score }}
                </span>
              </template>
            </el-table-column>
            <el-table-column label="是否NC" width="100">
              <template #default="{ row }">
                <el-tag v-if="row.is_nc" type="danger">是</el-tag>
                <el-tag v-else type="success">否</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="comment" label="评价意见" min-width="200" />
          </el-table>
        </div>

        <!-- 不符合项汇总 -->
        <div v-if="ncItems.length > 0" class="mb-6">
          <h3 class="text-lg font-bold mb-4">不符合项 (NC) 汇总</h3>
          <el-alert
            v-for="(nc, index) in ncItems"
            :key="index"
            :title="`${nc.item_id}: ${nc.title}`"
            type="error"
            :description="nc.nc_description"
            show-icon
            class="mb-2"
          />
        </div>

        <!-- 审核总结 -->
        <div v-if="execution.summary">
          <h3 class="text-lg font-bold mb-4">审核总结</h3>
          <el-card shadow="never">
            <pre class="whitespace-pre-wrap">{{ execution.summary }}</pre>
          </el-card>
        </div>

        <!-- 操作按钮 -->
        <div class="mt-6 flex gap-2">
          <el-button type="primary" @click="handleDownloadReport">
            <el-icon><Download /></el-icon>
            下载PDF报告
          </el-button>
          <el-button @click="handlePrint">
            <el-icon><Printer /></el-icon>
            打印
          </el-button>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Download, Printer } from '@element-plus/icons-vue';
import * as echarts from 'echarts';
import { getAuditExecution, getAuditTemplate, generateAuditReport } from '@/api/audit';
import type { AuditExecution, AuditTemplate } from '@/types/audit';

const route = useRoute();
const loading = ref(false);
const execution = ref<AuditExecution | null>(null);
const template = ref<AuditTemplate | null>(null);
const radarChartRef = ref<HTMLElement>();
const checklistResultsArray = ref<any[]>([]);
const ncItems = ref<any[]>([]);

const loadData = async () => {
  loading.value = true;
  try {
    const executionId = parseInt(route.params.id as string);
    execution.value = await getAuditExecution(executionId);
    template.value = await getAuditTemplate(execution.value.template_id);
    
    // 处理检查表结果
    processChecklistResults();
    
    // 渲染雷达图
    await nextTick();
    renderRadarChart();
  } catch (error: any) {
    ElMessage.error(error.message || '加载失败');
  } finally {
    loading.value = false;
  }
};

const processChecklistResults = () => {
  if (!execution.value || !template.value) return;
  
  const results = execution.value.checklist_results;
  checklistResultsArray.value = [];
  ncItems.value = [];
  
  Object.entries(results).forEach(([itemId, result]: [string, any]) => {
    const templateItem = template.value!.checklist_items[itemId];
    const item = {
      item_id: itemId,
      title: templateItem?.title || '',
      score: result.score,
      max_score: templateItem?.max_score || 10,
      score_percentage: (result.score / (templateItem?.max_score || 10)) * 100,
      comment: result.comment || '',
      is_nc: result.is_nc
    };
    
    checklistResultsArray.value.push(item);
    
    if (result.is_nc) {
      ncItems.value.push({
        ...item,
        nc_description: result.nc_description
      });
    }
  });
};

const renderRadarChart = () => {
  if (!radarChartRef.value || !execution.value || !template.value) return;
  
  const chart = echarts.init(radarChartRef.value);
  
  // 准备雷达图数据
  const indicator = checklistResultsArray.value.map(item => ({
    name: item.item_id,
    max: item.max_score
  }));
  
  const data = checklistResultsArray.value.map(item => item.score);
  
  const option = {
    title: {
      text: '审核雷达图分析'
    },
    tooltip: {},
    radar: {
      indicator: indicator
    },
    series: [{
      name: '审核得分',
      type: 'radar',
      data: [{
        value: data,
        name: '实际得分',
        areaStyle: {
          color: 'rgba(64, 158, 255, 0.3)'
        }
      }]
    }]
  };
  
  chart.setOption(option);
  
  // 响应式
  window.addEventListener('resize', () => chart.resize());
};

const handleDownloadReport = async () => {
  if (!execution.value) return;
  
  try {
    const response = await generateAuditReport(execution.value.id, {
      include_radar_chart: true,
      include_photos: true
    });
    
    window.open(response.report_url, '_blank');
    ElMessage.success('报告生成成功');
  } catch (error: any) {
    ElMessage.error(error.message || '生成报告失败');
  }
};

const handlePrint = () => {
  window.print();
};

const getScoreColor = (score?: number): string => {
  if (!score) return 'text-gray-400';
  if (score >= 90) return 'text-green-600';
  if (score >= 80) return 'text-blue-600';
  if (score >= 70) return 'text-yellow-600';
  return 'text-red-600';
};

const getGradeType = (grade?: string) => {
  const types: Record<string, any> = {
    A: 'success',
    B: 'success',
    C: 'warning',
    D: 'danger'
  };
  return types[grade || ''] || 'info';
};

const formatDateTime = (dateStr: string): string => {
  return new Date(dateStr).toLocaleString('zh-CN');
};

onMounted(() => {
  loadData();
});
</script>

<style scoped>
.audit-report {
  min-height: 100vh;
  background-color: #f5f7fa;
}

@media print {
  .audit-report {
    background-color: white;
  }
}
</style>
