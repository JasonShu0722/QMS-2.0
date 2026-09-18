<template>
  <div class="page-container">
    <el-card>
      <template #header>
        <div class="card-header">
          <h2>专项数据分析</h2>
        </div>
      </template>
      <el-empty description="功能开发中，敬请期待">
        <template #image>
          <el-icon :size="80" color="#c0c4cc"><TrendCharts /></el-icon>
        </template>
      </el-empty>
      <div class="feature-desc">
        <p>本模块将实现以下功能：</p>
        <ul>
          <li>供应商质量数据分析：自动生成 Top5 供应商清单（来料批次合格率、物料上线不良 PPM）</li>
          <li>制程质量数据分析：分类统计及月度趋势推移</li>
          <li>客户质量数据分析：0KM PPM、售后 PPM 分类统计及月度趋势推移</li>
        </ul>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { TrendCharts } from '@element-plus/icons-vue'
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
