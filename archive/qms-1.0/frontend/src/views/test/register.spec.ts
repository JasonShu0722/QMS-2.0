// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'

import Register from '../Register.vue'
import { authApi } from '@/api/auth'

const messageMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}))

vi.mock('@/api/auth', () => ({
  authApi: {
    register: vi.fn(),
  },
}))

vi.mock('element-plus', async () => {
  const actual = await vi.importActual('element-plus')
  return {
    ...actual,
    ElMessage: messageMocks,
  }
})

describe('Register.vue', () => {
  let router: any
  let pinia: any

  const mountRegister = () =>
    mount(Register, {
      global: {
        plugins: [router, pinia, ElementPlus],
      },
    })

  beforeEach(async () => {
    pinia = createPinia()
    setActivePinia(pinia)

    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/register', component: Register },
        { path: '/login', component: { template: '<div>Login</div>' } },
      ],
    })

    vi.clearAllMocks()

    await router.push('/register')
    await router.isReady()
  })

  it('renders the internal-only registration page', () => {
    const wrapper = mountRegister()

    expect(wrapper.find('.register-container').exists()).toBe(true)
    expect(wrapper.find('.register-panel-shell').exists()).toBe(true)
    expect(wrapper.text()).toContain('用户注册')
    expect(wrapper.text()).toContain('统一账号申请入口')
    expect(wrapper.text()).toContain('仅开放内部员工申请')
    expect(wrapper.text()).not.toContain('供应商')
  })

  it('submits internal registration payload and returns to login', async () => {
    vi.mocked(authApi.register).mockResolvedValue({ message: '注册成功' })

    const wrapper = mountRegister()
    wrapper.vm.registerForm.username = 'internal_user'
    wrapper.vm.registerForm.full_name = '测试员工'
    wrapper.vm.registerForm.password = 'Test@123456'
    wrapper.vm.registerForm.confirmPassword = 'Test@123456'
    wrapper.vm.registerForm.email = 'internal_user@ics-energy.com'
    wrapper.vm.registerForm.phone = '13800138000'
    wrapper.vm.registerForm.department = '质量管理部'
    wrapper.vm.registerForm.position = '质量工程师'

    await wrapper.vm.handleRegister()
    await flushPromises()

    expect(authApi.register).toHaveBeenCalledWith({
      username: 'internal_user',
      password: 'Test@123456',
      full_name: '测试员工',
      email: 'internal_user@ics-energy.com',
      phone: '13800138000',
      user_type: 'internal',
      department: '质量管理部',
      position: '质量工程师',
    })
    expect(router.currentRoute.value.path).toBe('/login')
  })

  it('blocks submission for emails outside the internal policy', async () => {
    const wrapper = mountRegister()
    wrapper.vm.registerForm.username = 'invalid_email_user'
    wrapper.vm.registerForm.full_name = '测试员工'
    wrapper.vm.registerForm.password = 'Test@123456'
    wrapper.vm.registerForm.confirmPassword = 'Test@123456'
    wrapper.vm.registerForm.email = 'internal_user@example.com'
    wrapper.vm.registerForm.department = '质量管理部'

    await wrapper.vm.handleRegister()
    await flushPromises()

    expect(authApi.register).not.toHaveBeenCalled()
    expect(messageMocks.error).toHaveBeenCalledWith('注册信息校验未通过，请检查后重试')
  })

  it('blocks submission when required fields are incomplete', async () => {
    const wrapper = mountRegister()
    wrapper.vm.registerForm.username = ''
    wrapper.vm.registerForm.full_name = '测试员工'
    wrapper.vm.registerForm.password = 'Test@123456'
    wrapper.vm.registerForm.confirmPassword = 'Test@123456'
    wrapper.vm.registerForm.email = 'internal_user@ics-energy.com'
    wrapper.vm.registerForm.department = '质量管理部'

    await wrapper.vm.handleRegister()
    await flushPromises()

    expect(authApi.register).not.toHaveBeenCalled()
  })
})
