// @ts-nocheck
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import Login from '../Login.vue'
import { authApi } from '@/api/auth'
import {
  clearRememberedLogin,
  loadRememberedLogin,
  persistRememberedLogin
} from '@/utils/loginRemembering'

vi.mock('@/api/auth', () => ({
  authApi: {
    login: vi.fn(),
    getCaptcha: vi.fn(),
    getCurrentUser: vi.fn(),
    checkPermission: vi.fn(),
    getPermissionTree: vi.fn().mockResolvedValue({})
  }
}))

vi.mock('@/stores/featureFlag', () => ({
  useFeatureFlagStore: () => ({
    loadFeatureFlags: vi.fn().mockResolvedValue(undefined)
  })
}))

vi.mock('element-plus', async () => {
  const actual = await vi.importActual('element-plus')
  return {
    ...actual,
    ElMessage: {
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn()
    }
  }
})

const buildLoginResponse = (overrides = {}) => ({
  access_token: 'test-token',
  token_type: 'bearer',
  environment: 'stable',
  allowed_environments: ['stable'],
  password_expired: false,
  user_info: {
    id: 1,
    username: 'testuser',
    full_name: '测试用户',
    email: 'test@example.com',
    user_type: 'internal',
    department: '质量管理部',
    position: 'SQE',
    status: 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  ...overrides
})

describe('Login.vue', () => {
  let router: any
  let pinia: any

  const createMemoryStorage = () => {
    const state = new Map<string, string>()

    return {
      getItem(key: string) {
        return state.has(key) ? state.get(key)! : null
      },
      setItem(key: string, value: string) {
        state.set(key, value)
      },
      removeItem(key: string) {
        state.delete(key)
      }
    }
  }

  const mountLogin = () => mount(Login, {
    global: {
      plugins: [router, pinia, ElementPlus]
    }
  })

  beforeEach(async () => {
    pinia = createPinia()
    setActivePinia(pinia)

    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/login', component: Login },
        { path: '/workbench', component: { template: '<div>Workbench</div>' } },
        { path: '/register', redirect: '/login' }
      ]
    })

    vi.clearAllMocks()
    localStorage.clear()

    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1280
    })

    await router.push('/login')
    await router.isReady()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders the login page and keeps key entry points', () => {
    const wrapper = mountLogin()

    expect(wrapper.find('.login-container').exists()).toBe(true)
    expect(wrapper.find('.user-type-selector').exists()).toBe(true)
    expect(wrapper.text()).toContain('账号登录')
    expect(wrapper.find('.hero-copy').exists()).toBe(true)
    expect(wrapper.text()).toContain('让质量更透明')
    expect(wrapper.find('.entry-environments').exists()).toBe(false)
    expect(wrapper.find('a[href="/register"]').exists()).toBe(false)
  })

  it('keeps the register entry hidden when supplier login is selected', async () => {
    vi.mocked(authApi.getCaptcha).mockResolvedValue({
      captcha_image: 'data:image/png;base64,test',
      captcha_id: 'captcha-1',
    })

    const wrapper = mountLogin()
    wrapper.vm.userType = 'supplier'

    await wrapper.vm.$nextTick()
    await flushPromises()

    expect(wrapper.find('a[href="/register"]').exists()).toBe(false)
  })

  it('defaults to internal login', () => {
    const wrapper = mountLogin()
    expect(wrapper.vm.userType).toBe('internal')
  })

  it('loads captcha when switching to supplier login', async () => {
    vi.mocked(authApi.getCaptcha).mockResolvedValue({
      captcha_image: 'data:image/png;base64,test',
      captcha_id: 'captcha-1'
    })

    const wrapper = mountLogin()
    wrapper.vm.userType = 'supplier'

    await wrapper.vm.$nextTick()
    await flushPromises()

    expect(authApi.getCaptcha).toHaveBeenCalledTimes(1)
    expect(wrapper.vm.captchaId).toBe('captcha-1')
  })

  it('keeps the SSO button for internal users', async () => {
    const wrapper = mountLogin()
    await wrapper.vm.$nextTick()

    const ssoButton = wrapper.find('.sso-button')
    expect(ssoButton.exists()).toBe(true)
    expect(ssoButton.attributes('disabled')).toBeDefined()
  })

  it('blocks submit when username or password is empty', async () => {
    const wrapper = mountLogin()
    wrapper.vm.loginForm.username = ''
    wrapper.vm.loginForm.password = 'Test@123456'

    await wrapper.vm.handleLogin()
    await flushPromises()

    expect(authApi.login).not.toHaveBeenCalled()
  })

  it('blocks supplier submit when captcha is empty', async () => {
    const wrapper = mountLogin()
    wrapper.vm.userType = 'supplier'
    wrapper.vm.loginForm.username = 'supplier1'
    wrapper.vm.loginForm.password = 'Supplier@123'
    wrapper.vm.loginForm.captcha = ''

    await wrapper.vm.$nextTick()
    await wrapper.vm.handleLogin()
    await flushPromises()

    expect(authApi.login).not.toHaveBeenCalled()
  })

  it('submits internal login and navigates to workbench', async () => {
    vi.mocked(authApi.login).mockResolvedValue(buildLoginResponse())

    const wrapper = mountLogin()
    wrapper.vm.loginForm.username = 'testuser'
    wrapper.vm.loginForm.password = 'Test@123456'

    await wrapper.vm.handleLogin()
    await flushPromises()

    expect(authApi.login).toHaveBeenCalledWith({
      username: 'testuser',
      password: 'Test@123456',
      user_type: 'internal',
      captcha: undefined,
      captcha_id: undefined
    })
    expect(router.currentRoute.value.path).toBe('/workbench')
  })

  it('submits supplier login with captcha fields', async () => {
    vi.mocked(authApi.getCaptcha).mockResolvedValue({
      captcha_image: 'data:image/png;base64,test',
      captcha_id: 'captcha-123'
    })
    vi.mocked(authApi.login).mockResolvedValue(buildLoginResponse({
      access_token: 'supplier-token',
      user_info: {
        id: 2,
        username: 'supplier1',
        full_name: '供应商用户',
        email: 'supplier@example.com',
        user_type: 'supplier',
        supplier_id: 1,
        supplier_name: '示例供应商',
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    }))

    const wrapper = mountLogin()
    wrapper.vm.userType = 'supplier'
    await wrapper.vm.$nextTick()
    await flushPromises()

    wrapper.vm.loginForm.username = 'supplier1'
    wrapper.vm.loginForm.password = 'Supplier@123'
    wrapper.vm.loginForm.captcha = '1234'

    await wrapper.vm.handleLogin()
    await flushPromises()

    expect(authApi.login).toHaveBeenCalledWith({
      username: 'supplier1',
      password: 'Supplier@123',
      user_type: 'supplier',
      captcha: '1234',
      captcha_id: 'captcha-123'
    })
  })

  it('refreshes captcha and clears input after supplier login failure', async () => {
    vi.mocked(authApi.getCaptcha)
      .mockResolvedValueOnce({
        captcha_image: 'data:image/png;base64,first',
        captcha_id: 'captcha-1'
      })
      .mockResolvedValueOnce({
        captcha_image: 'data:image/png;base64,second',
        captcha_id: 'captcha-2'
      })
    vi.mocked(authApi.login).mockRejectedValue({
      response: {
        data: {
          detail: '验证码错误'
        }
      }
    })

    const wrapper = mountLogin()
    wrapper.vm.userType = 'supplier'
    await wrapper.vm.$nextTick()
    await flushPromises()

    wrapper.vm.loginForm.username = 'supplier1'
    wrapper.vm.loginForm.password = 'Supplier@123'
    wrapper.vm.loginForm.captcha = 'wrong'

    await wrapper.vm.handleLogin()
    await flushPromises()

    expect(authApi.getCaptcha).toHaveBeenCalledTimes(2)
    expect(wrapper.vm.captchaId).toBe('captcha-2')
    expect(wrapper.vm.loginForm.captcha).toBe('')
  })

  it('tracks mobile mode from viewport width', () => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 640
    })

    const wrapper = mountLogin()
    expect(wrapper.vm.isMobile).toBe(true)
  })

  it('persists remembered credentials with helper functions', () => {
    const storage = createMemoryStorage()

    persistRememberedLogin(storage, {
      username: 'testuser',
      password: 'Test@123456',
      userType: 'internal'
    })

    expect(loadRememberedLogin(storage)).toEqual({
      username: 'testuser',
      password: 'Test@123456',
      userType: 'internal'
    })
  })

  it('clears remembered credentials with helper functions', () => {
    const storage = createMemoryStorage()

    persistRememberedLogin(storage, {
      username: 'saveduser',
      password: 'savedpass',
      userType: 'supplier'
    })

    clearRememberedLogin(storage)

    expect(loadRememberedLogin(storage)).toBeNull()
  })
})
