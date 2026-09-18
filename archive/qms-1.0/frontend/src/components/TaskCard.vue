<template>
  <div class="task-card" :class="`task-card--${task.color}`" @click="handleClick">
    <div class="task-card__header">
      <el-tag :type="tagType" size="small">{{ task.task_type }}</el-tag>
      <span class="task-card__id">{{ task.task_id }}</span>
    </div>

    <div v-if="task.title" class="task-card__title">{{ task.title }}</div>
    <div v-if="task.description" class="task-card__description">{{ task.description }}</div>

    <div class="task-card__footer">
      <div class="task-card__time">
        <el-icon><Clock /></el-icon>
        <span>{{ formattedRemainingTime }}</span>
      </div>
      <div class="task-card__deadline">截止: {{ formattedDeadline }}</div>
    </div>

    <div class="task-card__indicator" :class="`task-card__indicator--${task.color}`"></div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Clock } from '@element-plus/icons-vue'
import type { TodoTask } from '@/types/workbench'

interface Props {
  task: TodoTask
}

const props = defineProps<Props>()

const emit = defineEmits<{
  click: [task: TodoTask]
}>()

const tagType = computed(() => {
  switch (props.task.color) {
    case 'red':
      return 'danger'
    case 'yellow':
      return 'warning'
    case 'green':
      return 'success'
    default:
      return 'info'
  }
})

const formattedRemainingTime = computed(() => {
  const hours = props.task.remaining_hours

  if (!Number.isFinite(hours)) {
    return '待安排'
  }

  if (hours < 0) {
    const overdue = Math.abs(hours)
    return overdue < 24 ? `已超期 ${Math.floor(overdue)} 小时` : `已超期 ${Math.floor(overdue / 24)} 天`
  }

  return hours < 24 ? `剩余 ${Math.floor(hours)} 小时` : `剩余 ${Math.floor(hours / 24)} 天`
})

const formattedDeadline = computed(() => {
  if (!props.task.deadline) {
    return '待确认'
  }

  return new Date(props.task.deadline).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
})

function handleClick() {
  emit('click', props.task)
}
</script>

<style scoped>
.task-card {
  position: relative;
  overflow: hidden;
  cursor: pointer;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  background: #fff;
  padding: 16px;
  transition: all 0.3s;
}

.task-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);
}

.task-card--red {
  border-left: 4px solid #f56c6c;
}

.task-card--yellow {
  border-left: 4px solid #e6a23c;
}

.task-card--green {
  border-left: 4px solid #67c23a;
}

.task-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.task-card__id {
  color: #606266;
  font-size: 14px;
  font-weight: 500;
}

.task-card__title {
  margin-bottom: 8px;
  color: #303133;
  font-size: 15px;
  font-weight: 500;
  line-height: 1.5;
}

.task-card__description {
  margin-bottom: 12px;
  color: #606266;
  font-size: 13px;
  line-height: 1.5;
}

.task-card__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #909399;
  font-size: 12px;
}

.task-card__time {
  display: flex;
  align-items: center;
  gap: 4px;
  font-weight: 500;
}

.task-card--red .task-card__time {
  color: #f56c6c;
}

.task-card--yellow .task-card__time {
  color: #e6a23c;
}

.task-card--green .task-card__time {
  color: #67c23a;
}

.task-card__indicator {
  position: absolute;
  top: 0;
  right: 0;
  height: 0;
  width: 0;
  border-style: solid;
  border-width: 0 40px 40px 0;
  opacity: 0.1;
}

.task-card__indicator--red {
  border-color: transparent #f56c6c transparent transparent;
}

.task-card__indicator--yellow {
  border-color: transparent #e6a23c transparent transparent;
}

.task-card__indicator--green {
  border-color: transparent #67c23a transparent transparent;
}

@media (max-width: 768px) {
  .task-card {
    padding: 12px;
  }

  .task-card__header {
    margin-bottom: 8px;
  }

  .task-card__title {
    margin-bottom: 6px;
    font-size: 14px;
  }

  .task-card__description {
    margin-bottom: 8px;
    font-size: 12px;
  }

  .task-card__footer {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }
}
</style>
