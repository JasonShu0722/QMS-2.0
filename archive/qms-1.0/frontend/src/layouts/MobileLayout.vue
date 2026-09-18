<template>
  <div class="mobile-layout">
    <div class="mobile-header">
      <div class="header-left">
        <el-icon class="menu-icon" @click="toggleDrawer">
          <Menu />
        </el-icon>
        <span class="logo">QMS</span>
        <span v-if="isPreview" class="environment-badge">预览环境</span>
      </div>
      <div class="header-right">
        <el-icon class="user-icon" @click="showUserMenu = true">
          <User />
        </el-icon>
      </div>
    </div>

    <div class="mobile-content">
      <slot />
    </div>

    <el-drawer v-model="drawerVisible" direction="ltr" :size="280" title="菜单">
      <el-menu :default-active="activeMenu" router @select="handleMenuSelect">
        <el-menu-item v-for="item in visiblePrimaryItems" :key="item.index" :index="item.index">
          <el-icon><component :is="item.icon" /></el-icon>
          <template #title>{{ item.title }}</template>
        </el-menu-item>

        <el-sub-menu v-for="section in visibleSections" :key="section.index" :index="section.index">
          <template #title>
            <el-icon><component :is="section.icon" /></el-icon>
            <span>{{ section.title }}</span>
          </template>
          <el-menu-item v-for="child in section.children" :key="child.index" :index="child.index">
            {{ child.title }}
          </el-menu-item>
        </el-sub-menu>

        <el-menu-item v-for="item in visibleReservedItems" :key="item.index" :index="item.index">
          <el-icon><component :is="item.icon" /></el-icon>
          <template #title>{{ item.title }}</template>
        </el-menu-item>
      </el-menu>
    </el-drawer>

    <el-dialog v-model="showUserMenu" title="用户菜单" width="90%" :show-close="true">
      <div class="user-menu-content">
        <div class="user-info-section">
          <el-icon class="user-avatar"><User /></el-icon>
          <div class="user-name">{{ authStore.userInfo?.full_name || '用户' }}</div>
        </div>
        <el-divider />
        <el-button v-if="canSwitchEnvironment" type="primary" class="menu-button" @click="switchEnvironment">
          {{ switchButtonText }}
        </el-button>
        <el-button v-if="firstAdminPath" class="menu-button" @click="goToAdmin">进入系统管理</el-button>
        <el-button class="menu-button" @click="goToProfile">个人中心</el-button>
        <el-button type="danger" class="menu-button" @click="handleLogout">退出登录</el-button>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Menu, User } from '@element-plus/icons-vue'
import { useEnvironment } from '@/composables/useEnvironment'
import { useAuthStore } from '@/stores/auth'
import { useFeatureFlagStore } from '@/stores/featureFlag'
import { NAV_SECTIONS, PRIMARY_NAV_ITEMS, RESERVED_NAV_ITEMS } from '@/config/navigation'
import { canAccessRouteMeta, type RouteAccessMeta } from '@/utils/accessControl'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const featureFlagStore = useFeatureFlagStore()

const drawerVisible = ref(false)
const showUserMenu = ref(false)

const { isPreview, switchButtonText, switchEnvironment, syncEnvironmentState } = useEnvironment()
const activeMenu = computed(() => route.path)
const canSwitchEnvironment = computed(() => authStore.allowedEnvironments.length > 1)
const routeAccessContext = computed(() => ({
  isAuthenticated: authStore.isAuthenticated,
  isInternal: authStore.isInternal,
  isSupplier: authStore.isSupplier,
  isPlatformAdmin: authStore.isPlatformAdmin,
  isFeatureEnabled: (featureKey: string) => featureFlagStore.isFeatureEnabled(featureKey),
  hasPermission: (modulePath: string, operation: 'create' | 'read' | 'update' | 'delete' | 'export') =>
    authStore.hasPermissionLocal(modulePath, operation),
}))

function canAccessPath(path: string) {
  const resolved = router.resolve(path)
  if (!resolved.matched.length) {
    return false
  }

  return canAccessRouteMeta(resolved.meta as RouteAccessMeta, routeAccessContext.value)
}

const visiblePrimaryItems = computed(() =>
  PRIMARY_NAV_ITEMS.filter((item) => canAccessPath(item.index))
)

const visibleSections = computed(() =>
  NAV_SECTIONS.map((section) => ({
    ...section,
    children: section.children.filter((child) => canAccessPath(child.index)),
  })).filter((section) => section.children.length > 0)
)

const visibleReservedItems = computed(() =>
  RESERVED_NAV_ITEMS.filter((item) => canAccessPath(item.index))
)

const firstAdminPath = computed(
  () => visibleSections.value.find((section) => section.index === 'admin')?.children[0]?.index ?? ''
)

function toggleDrawer() {
  drawerVisible.value = !drawerVisible.value
}

function handleMenuSelect() {
  drawerVisible.value = false
}

function goToProfile() {
  showUserMenu.value = false
  router.push('/workbench')
}

function goToAdmin() {
  showUserMenu.value = false
  router.push(firstAdminPath.value || '/workbench')
}

function handleLogout() {
  authStore.logout()
  showUserMenu.value = false
  router.push('/login')
}

onMounted(async () => {
  syncEnvironmentState()
  if (authStore.isAuthenticated) {
    await Promise.all([
      featureFlagStore.loadFeatureFlags(),
      authStore.loadPermissionTree(),
    ])
  }
})
</script>

<style scoped>
.mobile-layout {
  display: flex;
  min-height: 100vh;
  width: 100%;
  flex-direction: column;
}

.mobile-header {
  position: fixed;
  top: 0;
  right: 0;
  left: 0;
  z-index: 1000;
  display: flex;
  height: 56px;
  align-items: center;
  justify-content: space-between;
  background-color: #409eff;
  color: #fff;
  padding: 0 16px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.menu-icon,
.user-icon {
  cursor: pointer;
  margin: -8px;
  padding: 8px;
  font-size: 24px;
}

.logo {
  font-size: 20px;
  font-weight: 700;
}

.environment-badge {
  border-radius: 4px;
  background-color: #f56c6c;
  padding: 2px 8px;
  font-size: 12px;
}

.mobile-content {
  margin-top: 56px;
  flex: 1;
  background-color: #f0f2f5;
  padding: 16px;
}

.user-menu-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.user-info-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 16px 0;
}

.user-avatar {
  font-size: 48px;
  color: #409eff;
}

.user-name {
  font-size: 18px;
  font-weight: 700;
}

.menu-button {
  min-height: 44px;
  width: 100%;
  padding: 12px 20px;
  font-size: 16px;
}

:deep(.el-input__inner) {
  height: 44px !important;
  font-size: 16px !important;
}

:deep(.el-button) {
  min-height: 44px;
  font-size: 16px;
}
</style>
