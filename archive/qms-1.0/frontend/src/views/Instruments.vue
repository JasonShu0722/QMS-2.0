<template>
  <div class="instruments-container">
    <div class="instruments-content">
      <el-empty description="仪器量具管理功能即将上线">
        <template #image>
          <el-icon :size="100" color="#909399">
            <Tools />
          </el-icon>
        </template>
        <template #default>
          <p class="feature-description">
            该功能将提供仪器量具的全生命周期管理，包括：
          </p>
          <ul class="feature-list">
            <li>仪器量具台账管理</li>
            <li>校准计划与提醒</li>
            <li>MSA 分析记录</li>
            <li>状态监控与互锁</li>
          </ul>
          <el-alert
            title="预留功能"
            type="info"
            :closable="false"
            show-icon
            class="feature-alert"
          >
            此功能为预留接口，将在后续版本中开放使用
          </el-alert>
        </template>
      </el-empty>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Tools } from '@element-plus/icons-vue'

/**
 * 仪器量具管理页面（预留功能）
 * 
 * 功能说明：
 * - 本页面为预留功能接口，当前仅作为占位页面
 * - 通过功能开关（Feature Flag）控制菜单可见性
 * - 后续版本将实现完整的仪器量具管理功能
 * 
 * 对应需求：2.10 仪器与量具管理（预留功能接口）
 */
</script>

<style scoped>
.instruments-container {
  padding: 24px;
  min-height: calc(100vh - 120px);
  display: flex;
  align-items: center;
  justify-content: center;
}

.instruments-content {
  max-width: 600px;
  width: 100%;
}

.feature-description {
  font-size: 16px;
  color: #606266;
  margin: 20px 0 16px;
  text-align: left;
}

.feature-list {
  text-align: left;
  color: #606266;
  padding-left: 24px;
  margin: 16px 0;
  line-height: 2;
}

.feature-list li {
  list-style-type: disc;
}

.feature-alert {
  margin-top: 24px;
}

/* 移动端适配 */
@media (max-width: 768px) {
  .instruments-container {
    padding: 16px;
  }

  .feature-description {
    font-size: 14px;
  }

  .feature-list {
    font-size: 14px;
    padding-left: 20px;
  }
}
</style>
