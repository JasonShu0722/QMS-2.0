import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { PermissionOperation, PermissionTree, User } from '@/types/user'
import { detectEntryEnvironment, normalizeEntryEnvironment, type EntryEnvironment } from '@/utils/environment'

/**
 * Authentication store
 *
 * Environment rules:
 * - On deployed domains, runtime hostname is the source of truth.
 * - In local development, `current_environment` in localStorage is used.
 * - Login responses from the backend settle the authenticated runtime environment.
 */
export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(localStorage.getItem('access_token'))
  const userInfo = ref<User | null>(null)
  const permissionTree = ref<PermissionTree>({})
  const currentEnvironment = ref<EntryEnvironment>(detectEntryEnvironment())
  const passwordExpired = ref(localStorage.getItem('password_expired') === 'true')

  const isAuthenticated = computed(() => !!token.value)
  const isSupplier = computed(() => userInfo.value?.user_type === 'supplier')
  const isInternal = computed(() => userInfo.value?.user_type === 'internal')
  const isPreviewEnv = computed(() => currentEnvironment.value === 'preview')
  const isPlatformAdmin = computed(() => !!userInfo.value?.is_platform_admin)
  const allowedEnvironments = computed(() => {
    const raw = userInfo.value?.allowed_environments?.split(',').map((item) => item.trim()).filter(Boolean)
    return raw && raw.length > 0 ? raw : ['stable']
  })

  function initUserInfo() {
    const storedUserInfo = localStorage.getItem('user_info')
    if (!storedUserInfo) {
      return
    }

    try {
      userInfo.value = JSON.parse(storedUserInfo)
    } catch (error) {
      console.error('Failed to parse user info from localStorage:', error)
      logout()
    }
  }

  function initPermissionTree() {
    const storedPermissionTree = localStorage.getItem('permission_tree')
    if (!storedPermissionTree) {
      return
    }

    try {
      permissionTree.value = JSON.parse(storedPermissionTree)
    } catch (error) {
      console.error('Failed to parse permission tree from localStorage:', error)
      localStorage.removeItem('permission_tree')
      permissionTree.value = {}
    }
  }

  function setPermissionTree(nextPermissionTree: PermissionTree) {
    permissionTree.value = nextPermissionTree
    localStorage.setItem('permission_tree', JSON.stringify(nextPermissionTree))
  }

  function setPasswordExpired(nextValue: boolean) {
    passwordExpired.value = nextValue
    localStorage.setItem('password_expired', String(nextValue))
  }

  function clearPasswordExpiredReminder() {
    passwordExpired.value = false
    localStorage.removeItem('password_expired')
  }

  function hasPermissionLocal(modulePath: string, operation: PermissionOperation): boolean {
    if (!isAuthenticated.value || !userInfo.value) {
      return false
    }

    if (isPlatformAdmin.value) {
      return true
    }

    if (modulePath === 'quality.data_panel' && operation === 'read') {
      return isInternal.value || isSupplier.value
    }

    if (modulePath === 'supplier.performance' && operation === 'read') {
      return isSupplier.value || permissionTree.value?.[modulePath]?.[operation] === true
    }

    return permissionTree.value?.[modulePath]?.[operation] === true
  }

  async function loadPermissionTree(force = false): Promise<void> {
    if (!isAuthenticated.value) {
      permissionTree.value = {}
      return
    }

    if (!force && Object.keys(permissionTree.value).length > 0) {
      return
    }

    try {
      const { authApi } = await import('@/api/auth')
      const nextPermissionTree = await authApi.getPermissionTree()
      setPermissionTree(nextPermissionTree)
    } catch (error) {
      console.error('Failed to load permission tree:', error)
      if (force) {
        permissionTree.value = {}
        localStorage.removeItem('permission_tree')
      }
    }
  }

  async function login(
    username: string,
    password: string,
    userType: 'internal' | 'supplier',
    captcha?: string,
    captchaId?: string
  ): Promise<void> {
    const { authApi } = await import('@/api/auth')

    const response = await authApi.login({
      username,
      password,
      user_type: userType,
      captcha,
      captcha_id: captchaId
    })

    token.value = response.access_token
    userInfo.value = response.user_info
    currentEnvironment.value = normalizeEntryEnvironment(response.environment)

    localStorage.setItem('access_token', response.access_token)
    localStorage.setItem(
      'user_info',
      JSON.stringify({
        ...response.user_info,
        allowed_environments: response.allowed_environments.join(',')
      })
    )
    localStorage.setItem('current_environment', currentEnvironment.value)
    setPasswordExpired(response.password_expired)
    await loadPermissionTree(true)

    const { useFeatureFlagStore } = await import('@/stores/featureFlag')
    const featureFlagStore = useFeatureFlagStore()
    await featureFlagStore.loadFeatureFlags(true)

    const { useProblemManagementStore } = await import('@/stores/problemManagement')
    const problemManagementStore = useProblemManagementStore()
    await problemManagementStore.loadCatalog(true)
  }

  function logout() {
    token.value = null
    userInfo.value = null
    permissionTree.value = {}
    currentEnvironment.value = detectEntryEnvironment()
    localStorage.removeItem('access_token')
    localStorage.removeItem('user_info')
    localStorage.removeItem('permission_tree')
    localStorage.removeItem('current_environment')
    localStorage.removeItem('password_expired')

    void import('@/stores/problemManagement').then(({ useProblemManagementStore }) => {
      const problemManagementStore = useProblemManagementStore()
      problemManagementStore.reset()
    })
  }

  async function checkPermission(
    modulePath: string,
    operation: PermissionOperation
  ): Promise<boolean> {
    if (!isAuthenticated.value || !userInfo.value) {
      return false
    }

    try {
      const { authApi } = await import('@/api/auth')
      if (hasPermissionLocal(modulePath, operation)) {
        return true
      }
      return await authApi.checkPermission(modulePath, operation)
    } catch (error) {
      console.error('Permission check failed:', error)
      return false
    }
  }

  async function refreshUserInfo(): Promise<void> {
    if (!isAuthenticated.value) {
      return
    }

    try {
      const { authApi } = await import('@/api/auth')
      const response = await authApi.getCurrentUser()
      userInfo.value = response
      localStorage.setItem('user_info', JSON.stringify(response))
      await loadPermissionTree(true)

      const { useProblemManagementStore } = await import('@/stores/problemManagement')
      const problemManagementStore = useProblemManagementStore()
      await problemManagementStore.loadCatalog(true)
    } catch (error) {
      console.error('Failed to refresh user info:', error)
      logout()
    }
  }

  function updateToken(newToken: string) {
    token.value = newToken
    localStorage.setItem('access_token', newToken)
  }

  initUserInfo()
  initPermissionTree()

  return {
    token,
    userInfo,
    permissionTree,
    currentEnvironment,
    passwordExpired,
    isAuthenticated,
    isSupplier,
    isInternal,
    isPreviewEnv,
    isPlatformAdmin,
    allowedEnvironments,
    login,
    logout,
    hasPermissionLocal,
    loadPermissionTree,
    checkPermission,
    refreshUserInfo,
    updateToken,
    setPasswordExpired,
    clearPasswordExpiredReminder
  }
})
