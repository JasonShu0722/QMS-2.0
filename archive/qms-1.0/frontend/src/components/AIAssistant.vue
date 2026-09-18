<template>
  <div class="ai-assistant">
    <!-- AI 对话框触发按钮 -->
    <el-button
      v-if="!isOpen"
      type="primary"
      :icon="ChatDotRound"
      circle
      size="large"
      class="ai-trigger-button"
      @click="toggleDialog"
    >
    </el-button>

    <!-- AI 对话框 -->
    <el-dialog
      v-model="isOpen"
      title="AI 智能助手"
      width="600px"
      :close-on-click-modal="false"
      class="ai-dialog"
    >
      <!-- 对话历史 -->
      <div class="chat-history" ref="chatHistoryRef">
        <div
          v-for="(message, index) in chatHistory"
          :key="index"
          :class="['message', message.role]"
        >
          <div class="message-content">
            <div class="message-header">
              <span class="role-label">
                {{ message.role === 'user' ? '您' : 'AI助手' }}
              </span>
              <span class="timestamp">{{ formatTime(message.timestamp) }}</span>
            </div>
            <div class="message-text">{{ message.content }}</div>
            
            <!-- 显示数据表格 -->
            <div v-if="message.data" class="message-data">
              <el-table :data="formatTableData(message.data)" size="small" max-height="300">
                <el-table-column
                  v-for="col in getTableColumns(message.data)"
                  :key="col"
                  :prop="col"
                  :label="col"
                />
              </el-table>
            </div>

            <!-- 显示图表 -->
            <div v-if="message.chartConfig" class="message-chart">
              <div :ref="el => setChartRef(el, index)" style="width: 100%; height: 300px;"></div>
            </div>
          </div>
        </div>

        <!-- 加载中提示 -->
        <div v-if="isLoading" class="message assistant loading">
          <div class="message-content">
            <el-icon class="is-loading"><Loading /></el-icon>
            <span>AI 正在思考...</span>
          </div>
        </div>
      </div>

      <!-- 输入框 -->
      <template #footer>
        <div class="chat-input-container">
          <el-input
            v-model="userInput"
            placeholder="输入您的问题，例如：查询上个月来料批次合格率最低的5个供应商"
            type="textarea"
            :rows="2"
            @keydown.enter.ctrl="handleSend"
          />
          <div class="input-actions">
            <el-button @click="clearHistory" text>清空历史</el-button>
            <el-button
              type="primary"
              :loading="isLoading"
              :disabled="!userInput.trim()"
              @click="handleSend"
            >
              发送 (Ctrl+Enter)
            </el-button>
          </div>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { ChatDotRound, Loading } from '@element-plus/icons-vue';
import * as echarts from 'echarts';
import type { ECharts } from 'echarts';
import { naturalLanguageQuery } from '@/api/quality-metrics';
import type { AIQueryResponse } from '@/types/quality-metrics';

// 消息类型
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  data?: unknown;
  chartConfig?: unknown;
}

// 状态
const isOpen = ref(false);
const isLoading = ref(false);
const userInput = ref('');
const chatHistory = ref<ChatMessage[]>([]);
const chatHistoryRef = ref<HTMLElement>();
const chartInstances = ref<Map<number, ECharts>>(new Map());

// 切换对话框
const toggleDialog = () => {
  isOpen.value = !isOpen.value;
};

// 格式化时间
const formatTime = (date: Date): string => {
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
};

// 发送消息
const handleSend = async () => {
  const question = userInput.value.trim();
  if (!question || isLoading.value) return;

  // 添加用户消息
  chatHistory.value.push({
    role: 'user',
    content: question,
    timestamp: new Date()
  });

  userInput.value = '';
  isLoading.value = true;

  // 滚动到底部
  await nextTick();
  scrollToBottom();

  try {
    // 调用 AI API
    const response: AIQueryResponse = await naturalLanguageQuery({ question });

    // 添加 AI 回复
    chatHistory.value.push({
      role: 'assistant',
      content: response.answer,
      timestamp: new Date(),
      data: response.data,
      chartConfig: response.chart_config
    });

    // 渲染图表
    if (response.chart_config) {
      await nextTick();
      const chartIndex = chatHistory.value.length - 1;
      renderChart(chartIndex, response.chart_config);
    }

    // 滚动到底部
    await nextTick();
    scrollToBottom();
  } catch (error: unknown) {
    console.error('AI query failed:', error);
    
    let errorMessage = 'AI 查询失败，请稍后重试';
    if (error && typeof error === 'object' && 'response' in error) {
      const response = (error as { response?: { data?: { detail?: string } } }).response;
      if (response?.data?.detail) {
        errorMessage = response.data.detail;
      }
    }

    chatHistory.value.push({
      role: 'assistant',
      content: `抱歉，${errorMessage}`,
      timestamp: new Date()
    });

    ElMessage.error(errorMessage);
  } finally {
    isLoading.value = false;
  }
};

// 清空历史
const clearHistory = () => {
  chatHistory.value = [];
  // 销毁所有图表实例
  chartInstances.value.forEach(chart => chart.dispose());
  chartInstances.value.clear();
};

// 滚动到底部
const scrollToBottom = () => {
  if (chatHistoryRef.value) {
    chatHistoryRef.value.scrollTop = chatHistoryRef.value.scrollHeight;
  }
};

// 设置图表引用
const setChartRef = (el: Element | ComponentPublicInstance | null, index: number) => {
  if (el && el instanceof HTMLElement) {
    // 存储 DOM 元素，稍后渲染图表
    const message = chatHistory.value[index];
    if (message?.chartConfig) {
      nextTick(() => {
        renderChart(index, message.chartConfig);
      });
    }
  }
};

// 渲染图表
const renderChart = (index: number, chartConfig: unknown) => {
  // 查找对应的 DOM 元素
  const chartElements = document.querySelectorAll('.message-chart > div');
  const chartElement = chartElements[chartElements.length - 1] as HTMLElement;
  
  if (!chartElement) return;

  // 销毁旧实例
  if (chartInstances.value.has(index)) {
    chartInstances.value.get(index)?.dispose();
  }

  // 创建新实例
  const chart = echarts.init(chartElement);
  chart.setOption(chartConfig as echarts.EChartsOption);
  chartInstances.value.set(index, chart);

  // 响应式调整
  window.addEventListener('resize', () => {
    chart.resize();
  });
};

// 格式化表格数据
const formatTableData = (data: unknown): unknown[] => {
  if (Array.isArray(data)) {
    return data;
  }
  if (typeof data === 'object' && data !== null) {
    return [data];
  }
  return [];
};

// 获取表格列
const getTableColumns = (data: unknown): string[] => {
  const tableData = formatTableData(data);
  if (tableData.length === 0) return [];
  
  const firstRow = tableData[0];
  if (typeof firstRow === 'object' && firstRow !== null) {
    return Object.keys(firstRow);
  }
  return [];
};

// 组件卸载时清理
onMounted(() => {
  return () => {
    chartInstances.value.forEach(chart => chart.dispose());
    chartInstances.value.clear();
  };
});
</script>

<script lang="ts">
import type { ComponentPublicInstance } from 'vue';
export default {
  name: 'AIAssistant'
};
</script>

<style scoped>
.ai-assistant {
  position: relative;
}

.ai-trigger-button {
  position: fixed;
  bottom: 30px;
  right: 30px;
  z-index: 1000;
  width: 60px;
  height: 60px;
  font-size: 24px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.ai-trigger-button:hover {
  transform: scale(1.1);
  transition: transform 0.2s;
}

.ai-dialog :deep(.el-dialog__body) {
  padding: 0;
  height: 500px;
  display: flex;
  flex-direction: column;
}

.chat-history {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  background-color: #f5f7fa;
}

.message {
  margin-bottom: 16px;
  display: flex;
}

.message.user {
  justify-content: flex-end;
}

.message.assistant {
  justify-content: flex-start;
}

.message-content {
  max-width: 80%;
  padding: 12px 16px;
  border-radius: 8px;
  background-color: #fff;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.message.user .message-content {
  background-color: #409eff;
  color: #fff;
}

.message-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-size: 12px;
}

.message.user .message-header {
  color: rgba(255, 255, 255, 0.8);
}

.message.assistant .message-header {
  color: #909399;
}

.role-label {
  font-weight: 600;
}

.timestamp {
  opacity: 0.7;
}

.message-text {
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.message-data {
  margin-top: 12px;
}

.message-chart {
  margin-top: 12px;
}

.message.loading {
  opacity: 0.7;
}

.message.loading .message-content {
  display: flex;
  align-items: center;
  gap: 8px;
}

.chat-input-container {
  padding: 16px;
  border-top: 1px solid #dcdfe6;
  background-color: #fff;
}

.input-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 12px;
}

/* 移动端适配 */
@media (max-width: 768px) {
  .ai-trigger-button {
    bottom: 20px;
    right: 20px;
    width: 50px;
    height: 50px;
    font-size: 20px;
  }

  .ai-dialog {
    width: 95% !important;
  }

  .ai-dialog :deep(.el-dialog__body) {
    height: 400px;
  }

  .message-content {
    max-width: 90%;
  }
}
</style>
