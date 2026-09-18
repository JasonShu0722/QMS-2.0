<template>
  <div class="audit-checklist-mobile h-screen flex flex-col bg-gray-50">
    <!-- 顶部标题栏 - 全屏模式 -->
    <div class="bg-blue-600 text-white p-4 flex justify-between items-center">
      <div>
        <h1 class="text-lg font-bold">移动端审核打分</h1>
        <p class="text-xs opacity-90">{{ currentTemplate?.template_name }}</p>
      </div>
      <div class="text-right">
        <div class="text-2xl font-bold">{{ calculateProgress() }}%</div>
        <div class="text-xs">完成进度</div>
      </div>
    </div>

    <!-- 检查表条款列表 - 可滚动 -->
    <div class="flex-1 overflow-y-auto p-4">
      <div v-for="(item, itemId) in currentTemplate?.checklist_items" :key="itemId" class="mb-4">
        <div class="bg-white rounded-lg shadow p-4">
          <!-- 条款标题 -->
          <div class="flex justify-between items-start mb-3">
            <div class="flex-1">
              <div class="font-bold text-gray-800 mb-1">{{ itemId }}</div>
              <div class="text-sm text-gray-600">{{ item.title }}</div>
            </div>
            <div class="ml-2 text-xs text-gray-500">满分: {{ item.max_score }}</div>
          </div>

          <!-- 条款描述 -->
          <p class="text-sm text-gray-600 mb-3">{{ item.description }}</p>

          <!-- 评分滑块 - 大号触控 -->
          <div class="mb-3">
            <div class="flex justify-between items-center mb-2">
              <span class="text-sm text-gray-600">评分</span>
              <span class="text-lg font-bold text-blue-600">
                {{ scoreForm[itemId]?.score || 0 }} 分
              </span>
            </div>
            <input
              type="range"
              v-model.number="scoreForm[itemId].score"
              :min="0"
              :max="item.max_score"
              class="w-full h-8"
            />
          </div>

          <!-- 不符合项开关 -->
          <div class="flex items-center justify-between mb-3 p-3 bg-gray-50 rounded">
            <span class="text-sm font-medium">标记为不符合项 (NC)</span>
            <label class="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                v-model="scoreForm[itemId].is_nc"
                class="sr-only peer"
              />
              <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          <!-- NC描述 - 仅在标记为NC时显示 -->
          <div v-if="scoreForm[itemId]?.is_nc" class="mb-3">
            <textarea
              v-model="scoreForm[itemId].nc_description"
              placeholder="请详细描述不符合项..."
              class="w-full p-3 border rounded-lg text-sm"
              rows="3"
            ></textarea>
          </div>

          <!-- 拍照按钮 - 大号触控 -->
          <button
            @click="handleTakePhoto(itemId)"
            class="w-full py-3 bg-green-500 text-white rounded-lg font-medium active:bg-green-600"
          >
            📷 拍摄证据照片 ({{ scoreForm[itemId]?.evidence_photos?.length || 0 }})
          </button>

          <!-- 评价意见 -->
          <textarea
            v-model="scoreForm[itemId].comment"
            placeholder="评价意见（选填）"
            class="w-full mt-3 p-3 border rounded-lg text-sm"
            rows="2"
          ></textarea>
        </div>
      </div>
    </div>

    <!-- 底部提交按钮 - 固定 -->
    <div class="p-4 bg-white border-t">
      <button
        @click="handleSubmit"
        :disabled="submitting"
        class="w-full py-4 bg-blue-600 text-white rounded-lg font-bold text-lg active:bg-blue-700 disabled:bg-gray-400"
      >
        {{ submitting ? '提交中...' : '提交审核结果' }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { getAuditExecution, getAuditTemplate, submitChecklist } from '@/api/audit';
import type { AuditExecution, AuditTemplate, ChecklistItemScore } from '@/types/audit';

const route = useRoute();
const router = useRouter();
const submitting = ref(false);
const currentExecution = ref<AuditExecution | null>(null);
const currentTemplate = ref<AuditTemplate | null>(null);
const scoreForm = ref<Record<string, ChecklistItemScore>>({});

const loadData = async () => {
  const executionId = parseInt(route.params.id as string);
  try {
    currentExecution.value = await getAuditExecution(executionId);
    currentTemplate.value = await getAuditTemplate(currentExecution.value.template_id);
    
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
  } catch (error: any) {
    ElMessage.error(error.message || '加载失败');
  }
};

const calculateProgress = (): number => {
  if (!currentTemplate.value) return 0;
  const total = Object.keys(currentTemplate.value.checklist_items).length;
  const scored = Object.values(scoreForm.value).filter(item => item.score > 0).length;
  return total > 0 ? Math.round((scored / total) * 100) : 0;
};

const handleTakePhoto = (itemId: string) => {
  // 调用移动端相机API
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.capture = 'environment';
  input.onchange = (e: any) => {
    const file = e.target.files[0];
    if (file) {
      // 上传照片逻辑
      ElMessage.success('照片已添加');
      if (!scoreForm.value[itemId].evidence_photos) {
        scoreForm.value[itemId].evidence_photos = [];
      }
      scoreForm.value[itemId].evidence_photos!.push(URL.createObjectURL(file));
    }
  };
  input.click();
};

const handleSubmit = async () => {
  if (!currentExecution.value) return;
  
  submitting.value = true;
  try {
    const checklist_results = Object.values(scoreForm.value);
    await submitChecklist(currentExecution.value.id, { checklist_results });
    
    ElMessage.success('提交成功');
    router.back();
  } catch (error: any) {
    ElMessage.error(error.message || '提交失败');
  } finally {
    submitting.value = false;
  }
};

onMounted(() => {
  loadData();
});
</script>

<style scoped>
/* 移动端全屏样式 */
.audit-checklist-mobile {
  -webkit-user-select: none;
  user-select: none;
}

/* 自定义滑块样式 */
input[type="range"] {
  -webkit-appearance: none;
  appearance: none;
  background: #e5e7eb;
  border-radius: 4px;
  outline: none;
}

input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 24px;
  height: 24px;
  background: #2563eb;
  cursor: pointer;
  border-radius: 50%;
}

input[type="range"]::-moz-range-thumb {
  width: 24px;
  height: 24px;
  background: #2563eb;
  cursor: pointer;
  border-radius: 50%;
  border: none;
}
</style>
