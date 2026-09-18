<template>
  <div class="audit-execution p-4 md:p-6">
    <div class="flex justify-between items-center mb-6">
      <div>
        <h1 class="text-2xl font-bold">审核执行</h1>
        <p class="text-sm text-gray-500 mt-1">Audit Execution - 审核实施与打分</p>
      </div>
      <el-button type="primary" @click="handleCreate">
        <el-icon><Plus /></el-icon>
        创建审核记录
      </el-button>
    </div>

    <!-- 筛选 -->
    <el-card class="mb-6">
      <el-form :inline="true" :model="queryForm">
        <el-form-item label="状态">
          <el-select v-model="queryForm.status" placeholder="全部" clearable>
            <el-option label="草稿" value="draft" />
            <el-option label="已完成" value="completed" />
            <el-option label="NC待关闭" value="nc_open" />
            <el-option label="NC已关闭" value="nc_closed" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="loadExecutions">查询</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 列表 -->
    <el-card v-loading="loading">
      <el-table :data="executions" stripe>
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="audit_date" label="审核日期" width="180">
          <template #default="{ row }">
            {{ formatDateTime(row.audit_date) }}
          </template>
        </el-table-column>
        <el-table-column label="得分" width="100">
          <template #default="{ row }">
            <span v-if="row.final_score" class="font-bold">{{ row.final_score }}</span>
            <span v-else class="text-gray-400">-</span>
          </template>
        </el-table-column>
        <el-table-column label="等级" width="80">
          <template #default="{ row }">
            <el-tag v-if="row.grade" :type="getGradeType(row.grade)">
              {{ row.grade }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="getStatusType(row.status)">
              {{ getStatusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="250" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="handleScore(row)">打分</el-button>
            <el-button link type="success" @click="handleGenerateReport(row.id)">
              生成报告
            </el-button>
            <el-button link @click="handleView(row)">查看</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="mt-4 flex justify-end">
        <el-pagination
          v-model:current-page="queryForm.page"
          v-model:page-size="queryForm.page_size"
          :total="total"
          layout="total, prev, pager, next"
          @current-change="loadExecutions"
        />
      </div>
    </el-card>

    <!-- 打分对话框 -->
    <el-dialog v-model="showScoreDialog" title="审核打分" width="90%" fullscreen>
      <div v-if="currentExecution && currentTemplate">
        <el-alert type="info" :closable="false" class="mb-4">
          <template #title>
            <div class="flex justify-between">
              <span>{{ currentTemplate.template_name }}</span>
              <span>当前得分: {{ calculateTotalScore() }}</span>
            </div>
          </template>
        </el-alert>

        <div v-for="(item, itemId) in currentTemplate.checklist_items" :key="itemId" class="mb-4">
          <el-card>
            <template #header>
              <div class="flex justify-between items-center">
                <span class="font-bold">{{ itemId }}: {{ item.title }}</span>
                <el-tag>满分: {{ item.max_score }}</el-tag>
              </div>
            </template>

            <p class="text-gray-600 mb-3">{{ item.description }}</p>

            <el-form-item label="评分">
              <el-rate
                v-model="scoreForm[itemId].score"
                :max="item.max_score"
                show-score
                score-template="{value} 分"
              />
            </el-form-item>

            <el-form-item label="评价意见">
              <el-input
                v-model="scoreForm[itemId].comment"
                type="textarea"
                :rows="2"
                placeholder="请输入评价意见"
              />
            </el-form-item>

            <el-form-item label="是否不符合项">
              <el-switch v-model="scoreForm[itemId].is_nc" />
            </el-form-item>

            <el-form-item v-if="scoreForm[itemId].is_nc" label="不符合项描述">
              <el-input
                v-model="scoreForm[itemId].nc_description"
                type="textarea"
                :rows="3"
                placeholder="请详细描述不符合项"
              />
            </el-form-item>

            <el-form-item label="证据照片">
              <el-upload
                action="/api/v1/upload"
                list-type="picture-card"
                :on-success="(response: any) => handlePhotoSuccess(response, itemId)"
              >
                <el-icon><Plus /></el-icon>
              </el-upload>
            </el-form-item>
          </el-card>
        </div>
      </div>

      <template #footer>
        <el-button @click="showScoreDialog = false">取消</el-button>
        <el-button type="primary" @click="handleSubmitScore" :loading="submitting">
          提交打分
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { Plus } from '@element-plus/icons-vue';
import {
  getAuditExecutions,
  getAuditTemplate,
  submitChecklist,
  generateAuditReport
} from '@/api/audit';
import type { AuditExecution, AuditTemplate, ChecklistItemScore } from '@/types/audit';

const loading = ref(false);
const submitting = ref(false);
const executions = ref<AuditExecution[]>([]);
const total = ref(0);
const showScoreDialog = ref(false);
const currentExecution = ref<AuditExecution | null>(null);
const currentTemplate = ref<AuditTemplate | null>(null);

const queryForm = reactive({
  status: '',
  page: 1,
  page_size: 20
});

const scoreForm = ref<Record<string, ChecklistItemScore>>({});

const loadExecutions = async () => {
  loading.value = true;
  try {
    const response = await getAuditExecutions(queryForm);
    executions.value = response.items;
    total.value = response.total;
  } catch (error: any) {
    ElMessage.error(error.message || '加载失败');
  } finally {
    loading.value = false;
  }
};

const handleCreate = () => {
  ElMessage.info('请先创建审核计划，然后从计划中创建执行记录');
};

const handleScore = async (execution: AuditExecution) => {
  try {
    currentExecution.value = execution;
    currentTemplate.value = await getAuditTemplate(execution.template_id);
    
    // 初始化打分表单
    scoreForm.value = {};
    Object.keys(currentTemplate.value.checklist_items).forEach(itemId => {
      scoreForm.value[itemId] = {
        item_id: itemId,
        score: 0,
        comment: '',
        evidence_photos: [],
        is_nc: false,
        nc_description: ''
      };
    });
    
    showScoreDialog.value = true;
  } catch (error: any) {
    ElMessage.error(error.message || '加载模板失败');
  }
};

const handlePhotoSuccess = (response: any, itemId: string) => {
  if (!scoreForm.value[itemId].evidence_photos) {
    scoreForm.value[itemId].evidence_photos = [];
  }
  scoreForm.value[itemId].evidence_photos!.push(response.file_path);
};

const calculateTotalScore = (): number => {
  if (!currentTemplate.value) return 0;
  
  let total = 0;
  let maxTotal = 0;
  
  Object.entries(currentTemplate.value.checklist_items).forEach(([itemId, item]: [string, any]) => {
    total += scoreForm.value[itemId]?.score || 0;
    maxTotal += item.max_score || 10;
  });
  
  return maxTotal > 0 ? Math.round((total / maxTotal) * 100) : 0;
};

const handleSubmitScore = async () => {
  if (!currentExecution.value) return;
  
  submitting.value = true;
  try {
    const checklist_results = Object.values(scoreForm.value);
    await submitChecklist(currentExecution.value.id, { checklist_results });
    
    ElMessage.success('提交成功');
    showScoreDialog.value = false;
    await loadExecutions();
  } catch (error: any) {
    ElMessage.error(error.message || '提交失败');
  } finally {
    submitting.value = false;
  }
};

const handleGenerateReport = async (id: number) => {
  try {
    const response = await generateAuditReport(id);
    ElMessage.success('报告生成成功');
    window.open(response.report_url, '_blank');
  } catch (error: any) {
    ElMessage.error(error.message || '生成报告失败');
  }
};

const handleView = (_execution: AuditExecution) => {
  ElMessage.info('查看详情功能');
};

const getStatusLabel = (status: string): string => {
  const labels: Record<string, string> = {
    draft: '草稿',
    completed: '已完成',
    nc_open: 'NC待关闭',
    nc_closed: 'NC已关闭'
  };
  return labels[status] || status;
};

const getStatusType = (status: string) => {
  const types: Record<string, any> = {
    draft: 'info',
    completed: 'success',
    nc_open: 'warning',
    nc_closed: 'success'
  };
  return types[status] || 'info';
};

const getGradeType = (grade: string) => {
  const types: Record<string, any> = {
    A: 'success',
    B: 'success',
    C: 'warning',
    D: 'danger'
  };
  return types[grade] || 'info';
};

const formatDateTime = (dateStr: string): string => {
  return new Date(dateStr).toLocaleString('zh-CN');
};

onMounted(() => {
  loadExecutions();
});
</script>

<style scoped>
.audit-execution {
  min-height: 100vh;
  background-color: #f5f7fa;
}
</style>
