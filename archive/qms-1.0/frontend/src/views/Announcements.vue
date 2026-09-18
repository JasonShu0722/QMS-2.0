<template>
  <div class="announcements-page">
    <div class="page-header">
      <h1>公告栏</h1>
      <p class="page-description">查看系统公告、质量预警和文件更新通知</p>
    </div>

    <el-card class="announcements-card" shadow="never">
      <AnnouncementList ref="announcementListRef" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import AnnouncementList from '@/components/AnnouncementList.vue'

const announcementListRef = ref<InstanceType<typeof AnnouncementList>>()

// 可以通过 announcementListRef.value?.refresh() 刷新列表
</script>

<style scoped lang="scss">
.announcements-page {
  padding: 20px;
  max-width: 1200px;
  margin: 0 auto;

  .page-header {
    margin-bottom: 24px;

    h1 {
      margin: 0 0 8px 0;
      font-size: 28px;
      font-weight: 600;
      color: var(--el-text-color-primary);
    }

    .page-description {
      margin: 0;
      font-size: 14px;
      color: var(--el-text-color-secondary);
    }
  }

  .announcements-card {
    border-radius: 8px;
  }
}

// 移动端适配
@media (max-width: 768px) {
  .announcements-page {
    padding: 12px;

    .page-header {
      h1 {
        font-size: 22px;
      }

      .page-description {
        font-size: 13px;
      }
    }
  }
}
</style>
