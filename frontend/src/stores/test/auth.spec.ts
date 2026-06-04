import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'

const loginMock = vi.fn()
const getCurrentUserMock = vi.fn()
const checkPermissionMock = vi.fn()
const getPermissionTreeMock = vi.fn()
const loadFeatureFlagsMock = vi.fn()
const loadProblemManagementCatalogMock = vi.fn()
const resetProblemManagementCatalogMock = vi.fn()

vi.mock('@/api/auth', () => ({
  authApi: {
    login: loginMock,
    getCurrentUser: getCurrentUserMock,
    checkPermission: checkPermissionMock,
    getPermissionTree: getPermissionTreeMock
  }
}))

vi.mock('@/stores/featureFlag', () => ({
  useFeatureFlagStore: () => ({
    loadFeatureFlags: loadFeatureFlagsMock
  })
}))

vi.mock('@/stores/problemManagement', () => ({
  useProblemManagementStore: () => ({
    loadCatalog: loadProblemManagementCatalogMock,
    reset: resetProblemManagementCatalogMock
  })
}))

type StorageState = Record<string, string>

function installStorage(initialState: StorageState = {}) {
  const state: StorageState = { ...initialState }

  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: vi.fn((key: string) => state[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        state[key] = String(value)
      }),
      removeItem: vi.fn((key: string) => {
        delete state[key]
      }),
      clear: vi.fn(() => {
        Object.keys(state).forEach((key) => delete state[key])
      })
    }
  })

  return state
}

function installLocation(hostname: string, href: string) {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      hostname,
      href,
      reload: vi.fn()
    }
  })
}

describe('auth store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    installStorage()
    installLocation('localhost', 'http://localhost:5173/login')
    getPermissionTreeMock.mockResolvedValue({})
  })

  it('hydrates preview environment from local storage on localhost', () => {
    installStorage({ current_environment: 'preview' })

    const store = useAuthStore()

    expect(store.currentEnvironment).toBe('preview')
    expect(store.allowedEnvironments).toEqual(['stable'])
  })

  it('persists normalized session data after login', async () => {
    loginMock.mockResolvedValue({
      access_token: 'token-123',
      token_type: 'bearer',
      environment: 'preview',
      allowed_environments: ['stable', 'preview'],
      password_expired: false,
      user_info: {
        id: 7,
        username: 'platform-admin',
        full_name: 'Platform Admin',
        email: 'admin@example.com',
        user_type: 'internal',
        status: 'active',
        allowed_environments: 'stable,preview',
        is_platform_admin: true,
        created_at: '2026-03-31T00:00:00Z',
        updated_at: '2026-03-31T00:00:00Z'
      }
    })

    const store = useAuthStore()
    await store.login('platform-admin', 'Secret123!', 'internal')

    expect(store.token).toBe('token-123')
    expect(store.currentEnvironment).toBe('preview')
    expect(store.isPlatformAdmin).toBe(true)
    expect(store.allowedEnvironments).toEqual(['stable', 'preview'])
    expect(store.passwordExpired).toBe(false)
    expect(window.localStorage.setItem).toHaveBeenCalledWith('access_token', 'token-123')
    expect(window.localStorage.setItem).toHaveBeenCalledWith('current_environment', 'preview')
    expect(window.localStorage.setItem).toHaveBeenCalledWith('password_expired', 'false')
    expect(getPermissionTreeMock).toHaveBeenCalled()
    expect(loadFeatureFlagsMock).toHaveBeenCalledWith(true)
    expect(loadProblemManagementCatalogMock).toHaveBeenCalledWith(true)
  })

  it('persists password-expired reminder state after login', async () => {
    loginMock.mockResolvedValue({
      access_token: 'token-expired',
      token_type: 'bearer',
      environment: 'stable',
      allowed_environments: ['stable'],
      password_expired: true,
      user_info: {
        id: 8,
        username: 'expired-user',
        full_name: 'Expired User',
        email: 'expired@example.com',
        user_type: 'internal',
        status: 'active',
        allowed_environments: 'stable',
        created_at: '2026-03-31T00:00:00Z',
        updated_at: '2026-03-31T00:00:00Z'
      }
    })

    const store = useAuthStore()
    await store.login('expired-user', 'Secret123!', 'internal')

    expect(store.passwordExpired).toBe(true)
    expect(window.localStorage.setItem).toHaveBeenCalledWith('password_expired', 'true')
  })

  it('normalizes unsupported backend environment markers back to stable', async () => {
    loginMock.mockResolvedValue({
      access_token: 'token-dev',
      token_type: 'bearer',
      environment: 'dev',
      allowed_environments: ['stable', 'preview'],
      password_expired: false,
      user_info: {
        id: 9,
        username: 'local-admin',
        full_name: 'Local Admin',
        email: 'local-admin@example.com',
        user_type: 'internal',
        status: 'active',
        allowed_environments: 'stable,preview',
        is_platform_admin: true,
        created_at: '2026-03-31T00:00:00Z',
        updated_at: '2026-03-31T00:00:00Z'
      }
    })

    const store = useAuthStore()
    await store.login('local-admin', 'Secret123!', 'internal')

    expect(store.currentEnvironment).toBe('stable')
    expect(window.localStorage.setItem).toHaveBeenCalledWith('current_environment', 'stable')
    expect(loadProblemManagementCatalogMock).toHaveBeenCalledWith(true)
  })

  it('hydrates permission tree and supports local permission checks', () => {
    installStorage({
      access_token: 'token-local',
      user_info: JSON.stringify({
        id: 11,
        username: 'quality-user',
        full_name: 'Quality User',
        email: 'quality@example.com',
        user_type: 'internal',
        status: 'active',
        created_at: '2026-03-31T00:00:00Z',
        updated_at: '2026-03-31T00:00:00Z'
      }),
      permission_tree: JSON.stringify({
        'quality.data_panel': { read: true },
        'quality.process': { read: false }
      })
    })

    const store = useAuthStore()

    expect(store.hasPermissionLocal('quality.data_panel', 'read')).toBe(true)
    expect(store.hasPermissionLocal('quality.process', 'read')).toBe(false)
  })

  it('treats quality dashboard as visible for authenticated internal accounts without explicit permission tree entries', () => {
    installStorage({
      access_token: 'token-local-internal',
      user_info: JSON.stringify({
        id: 12,
        username: 'internal-user',
        full_name: 'Internal User',
        email: 'internal@example.com',
        user_type: 'internal',
        status: 'active',
        created_at: '2026-03-31T00:00:00Z',
        updated_at: '2026-03-31T00:00:00Z'
      }),
      permission_tree: JSON.stringify({})
    })

    const store = useAuthStore()

    expect(store.hasPermissionLocal('quality.data_panel', 'read')).toBe(true)
    expect(store.hasPermissionLocal('supplier.performance', 'read')).toBe(false)
  })

  it('treats quality dashboard as visible for authenticated supplier accounts', () => {
    installStorage({
      access_token: 'token-local',
      user_info: JSON.stringify({
        id: 13,
        username: 'supplier-user',
        full_name: 'Supplier User',
        email: 'supplier@example.com',
        user_type: 'supplier',
        status: 'active',
        created_at: '2026-03-31T00:00:00Z',
        updated_at: '2026-03-31T00:00:00Z'
      }),
      permission_tree: JSON.stringify({})
    })

    const store = useAuthStore()

    expect(store.hasPermissionLocal('quality.data_panel', 'read')).toBe(true)
    expect(store.hasPermissionLocal('supplier.performance', 'read')).toBe(true)
  })

  it('refreshes user info and preserves normalized payload fields', async () => {
    installStorage({
      access_token: 'token-abc',
      user_info: JSON.stringify({
        id: 1,
        username: 'supplier_user',
        full_name: 'Supplier User',
        email: 'supplier@example.com',
        user_type: 'supplier',
        status: 'active',
        allowed_environments: 'stable',
        created_at: '2026-03-31T00:00:00Z',
        updated_at: '2026-03-31T00:00:00Z'
      })
    })

    getCurrentUserMock.mockResolvedValue({
      id: 1,
      username: 'supplier_user',
      full_name: 'Supplier User',
      email: 'supplier@example.com',
      user_type: 'supplier',
      status: 'active',
      supplier_id: 5,
      supplier_name: 'Northwind Components',
      signature_image_path: '/uploads/signatures/supplier_user.png',
      allowed_environments: 'stable,preview',
      created_at: '2026-03-31T00:00:00Z',
      updated_at: '2026-03-31T00:00:00Z'
    })

    const store = useAuthStore()
    await store.refreshUserInfo()

    expect(store.userInfo?.supplier_name).toBe('Northwind Components')
    expect(store.userInfo?.signature_image_path).toBe('/uploads/signatures/supplier_user.png')
    expect(store.allowedEnvironments).toEqual(['stable', 'preview'])
    expect(getPermissionTreeMock).toHaveBeenCalled()
    expect(loadProblemManagementCatalogMock).toHaveBeenCalledWith(true)
  })
})
