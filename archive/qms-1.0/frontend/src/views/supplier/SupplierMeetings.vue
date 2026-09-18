<template>
  <div class="page-container">
    <el-card>
      <template #header>
        <div class="card-header">
          <h2>供应商会议管理</h2>
          <el-button type="primary" disabled>
            <el-icon><Plus /></el-icon>
            新建会议
          </el-button>
        </div>
      </template>
      <el-empty description="功能开发中，敬请期待">
        <template #image>
          <el-icon :size="80" color="#c0c4cc"><ChatDotRound /></el-icon>
        </template>
      </el-empty>
      <div class="feature-desc">
        <p>本模块将实现以下功能：</p>
        <ul>
          <li>月度绩效为 C/D 级供应商自动生成品质改善会议任务</li>
          <li>供应商上传《物料品质问题改善报告》</li>
          <li>SQE 录入参会信息及会议纪要</li>
          <li>供应商未参会或未提交报告的违规处罚联动</li>
        </ul>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { Plus, ChatDotRound } from '@element-plus/icons-vue'
</script>

<style scoped>
.page-container {
  max-width: 1000px;
  margin: 0 auto;
}
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.card-header h2 {
  margin: 0;
  font-size: 18px;
}
.feature-desc {
  margin-top: 24px;
  padding: 16px;
  background-color: #f5f7fa;
  border-radius: 8px;
  color: #606266;
}
.feature-desc ul {
  padding-left: 20px;
  margin-top: 8px;
}
.feature-desc li {
  line-height: 2;
}
</style>
