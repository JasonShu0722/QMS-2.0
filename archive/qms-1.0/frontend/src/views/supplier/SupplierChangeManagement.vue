<template>
  <div class="page-container">
    <el-card>
      <template #header>
        <div class="card-header">
          <h2>供应商变更管理</h2>
          <el-button type="primary" disabled>
            <el-icon><Plus /></el-icon>
            新建变更申请
          </el-button>
        </div>
      </template>
      <el-empty description="功能开发中，敬请期待">
        <template #image>
          <el-icon :size="80" color="#c0c4cc"><Document /></el-icon>
        </template>
      </el-empty>
      <div class="feature-desc">
        <p>本模块将实现以下功能：</p>
        <ul>
          <li>供应商在线提交 PCN（过程变更通知）申请</li>
          <li>采购工程师/SQE 发起内部评估流程</li>
          <li>验证通过后供应商执行切换并上传断点信息</li>
        </ul>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { Plus, Document } from '@element-plus/icons-vue'
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
