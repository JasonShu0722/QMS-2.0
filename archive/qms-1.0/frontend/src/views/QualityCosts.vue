<template>
  <div class="quality-costs-container">
    <div class="quality-costs-content">
      <el-empty description="质量成本管理功能即将上线">
        <template #image>
          <el-icon :size="100" color="#909399">
            <Money />
          </el-icon>
        </template>
        <template #default>
          <p class="feature-description">
            该功能将提供质量成本的全面管理，包括：
          </p>
          <ul class="feature-list">
            <li>内部损失成本统计（报废、重工）</li>
            <li>外部损失成本统计（客诉索赔、售后处理）</li>
            <li>质量成本趋势分析（COQ 趋势图）</li>
            <li>损失归因分析（供应商、产品型号）</li>
            <li>质量成本决策看板</li>
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
import { Money } from '@element-plus/icons-vue'

/**
 * 质量成本管理页面（预留功能）
 * 
 * 功能说明：
 * - 本页面为预留功能接口，当前仅作为占位页面
 * - 通过功能开关（Feature Flag）控制菜单可见性
 * - 后续版本将实现完整的质量成本管理功能
 * 
 * 对应需求：2.11 质量成本管理（预留功能接口）
 */
</script>

<style scoped>
.quality-costs-container {
  padding: 24px;
  min-height: calc(100vh - 120px);
  display: flex;
  align-items: center;
  justify-content: center;
}

.quality-costs-content {
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
  .quality-costs-container {
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
