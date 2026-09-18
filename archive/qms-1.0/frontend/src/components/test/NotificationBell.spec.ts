// @ts-nocheck
/**
 * NotificationBell 组件单元测试
 * 
 * 测试通知铃铛组件的核心功能：
 * - 未读消息数量显示
 * - 铃铛图标点击交互
 * - 通知列表抽屉显示
 * - 消息已读状态更新
 * - 轮询机制
 * 
 * Requirements: 2.2.4 站内信通知
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import NotificationBell from '../NotificationBell.vue'
import NotificationList from '../NotificationList.vue'
import { notificationApi } from '@/api/notification'

// Mock notification API
vi.mock('@/api/notification', () => ({
  notificationApi: {
    getUnreadCount: vi.fn(),
    getNotifications: vi.fn(),
    markAsRead: vi.fn(),
    markAllAsRead: vi.fn()
  }
}))

describe('NotificationBell.vue', () => {
  beforeEach(() => {
    // 创建新的 Pinia 实例
    setActivePinia(createPinia())

    // 重置所有 mock
    vi.clearAllMocks()

    // 清除定时器
    vi.clearAllTimers()

    // 使用假定时器
    vi.useFakeTimers()
  })

  afterEach(() => {
    // 恢复真实定时器
    vi.useRealTimers()
  })

  describe('未读消息数量显示', () => {
    it('应该在挂载时获取未读消息数量', async () => {
      // Mock API 返回
      vi.mocked(notificationApi.getUnreadCount).mockResolvedValue({
        unread_count: 5
      })

      const wrapper = mount(NotificationBell)
      await flushPromises()

      // 验证 API 被调用
      expect(notificationApi.getUnreadCount).toHaveBeenCalledTimes(1)

      // 验证徽章显示数字
      const badge = wrapper.find('.el-badge')
      expect(badge.exists()).toBe(true)
    })

    it('未读数量为 0 时应该隐藏徽章', async () => {
      vi.mocked(notificationApi.getUnreadCount).mockResolvedValue({
        unread_count: 0
      })

      const wrapper = mount(NotificationBell)
      await flushPromises()

      // 徽章应该被隐藏（通过 hidden 属性）
      const badge = wrapper.findComponent({ name: 'ElBadge' })
      expect(badge.props('hidden')).toBe(true)
    })

    it('未读数量超过 99 时应该显示 99+', async () => {
      vi.mocked(notificationApi.getUnreadCount).mockResolvedValue({
        unread_count: 150
      })

      const wrapper = mount(NotificationBell)
      await flushPromises()

      const badge = wrapper.findComponent({ name: 'ElBadge' })
      expect(badge.props('max')).toBe(99)
      expect(badge.props('value')).toBe(150)
    })

    it('API 调用失败时应该优雅处理', async () => {
      // Mock console.error 以避免测试输出错误
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { })

      vi.mocked(notificationApi.getUnreadCount).mockRejectedValue(
        new Error('Network error')
      )

      const wrapper = mount(NotificationBell)
      await flushPromises()

      // 组件应该不会崩溃
      expect(wrapper.find('.notification-bell').exists()).toBe(true)

      // 验证错误被记录
      expect(consoleErrorSpy).toHaveBeenCalled()

      consoleErrorSpy.mockRestore()
    })
  })

  describe('铃铛图标点击交互', () => {
    it('点击铃铛应该打开通知列表抽屉', async () => {
      vi.mocked(notificationApi.getUnreadCount).mockResolvedValue({
        unread_count: 3
      })

      const wrapper = mount(NotificationBell)
      await flushPromises()

      // 初始状态抽屉应该关闭
      const drawer = wrapper.findComponent({ name: 'ElDrawer' })
      expect(drawer.props('modelValue')).toBe(false)

      // 点击铃铛按钮
      const button = wrapper.find('.el-button')
      await button.trigger('click')

      // 抽屉应该打开
      expect(drawer.props('modelValue')).toBe(true)
    })

    it('再次点击铃铛应该关闭抽屉', async () => {
      vi.mocked(notificationApi.getUnreadCount).mockResolvedValue({
        unread_count: 3
      })

      const wrapper = mount(NotificationBell)
      await flushPromises()

      const button = wrapper.find('.el-button')

      // 第一次点击 - 打开
      await button.trigger('click')
      let drawer = wrapper.findComponent({ name: 'ElDrawer' })
      expect(drawer.props('modelValue')).toBe(true)

      // 第二次点击 - 关闭
      await button.trigger('click')
      drawer = wrapper.findComponent({ name: 'ElDrawer' })
      expect(drawer.props('modelValue')).toBe(false)
    })

    it('有未读消息时铃铛按钮应该有特殊样式', async () => {
      vi.mocked(notificationApi.getUnreadCount).mockResolvedValue({
        unread_count: 5
      })

      const wrapper = mount(NotificationBell)
      await flushPromises()

      const button = wrapper.find('.el-button')
      expect(button.classes()).toContain('has-unread')
    })

    it('无未读消息时铃铛按钮不应该有特殊样式', async () => {
      vi.mocked(notificationApi.getUnreadCount).mockResolvedValue({
        unread_count: 0
      })

      const wrapper = mount(NotificationBell)
      await flushPromises()

      const button = wrapper.find('.el-button')
      expect(button.classes()).not.toContain('has-unread')
    })
  })

  describe('通知列表抽屉', () => {
    it('应该包含 NotificationList 子组件', async () => {
      vi.mocked(notificationApi.getUnreadCount).mockResolvedValue({
        unread_count: 3
      })

      const wrapper = mount(NotificationBell)
      await flushPromises()

      // 打开抽屉
      await wrapper.find('.el-button').trigger('click')

      // 验证 NotificationList 组件存在
      const notificationList = wrapper.findComponent(NotificationList)
      expect(notificationList.exists()).toBe(true)
    })

    it('抽屉标题应该是"站内信通知"', async () => {
      vi.mocked(notificationApi.getUnreadCount).mockResolvedValue({
        unread_count: 3
      })

      const wrapper = mount(NotificationBell)
      await flushPromises()

      const drawer = wrapper.findComponent({ name: 'ElDrawer' })
      expect(drawer.props('title')).toBe('站内信通知')
    })

    it('抽屉应该从右侧滑出', async () => {
      vi.mocked(notificationApi.getUnreadCount).mockResolvedValue({
        unread_count: 3
      })

      const wrapper = mount(NotificationBell)
      await flushPromises()

      const drawer = wrapper.findComponent({ name: 'ElDrawer' })
      expect(drawer.props('direction')).toBe('rtl')
    })

    it('抽屉宽度应该是 400px', async () => {
      vi.mocked(notificationApi.getUnreadCount).mockResolvedValue({
        unread_count: 3
      })

      const wrapper = mount(NotificationBell)
      await flushPromises()

      const drawer = wrapper.findComponent({ name: 'ElDrawer' })
      expect(drawer.props('size')).toBe('400px')
    })
  })

  describe('消息已读状态更新', () => {
    it('单条消息已读后应该刷新未读数量', async () => {
      // 初始未读数量
      vi.mocked(notificationApi.getUnreadCount)
        .mockResolvedValueOnce({ unread_count: 5 })
        .mockResolvedValueOnce({ unread_count: 4 })

      const wrapper = mount(NotificationBell)
      await flushPromises()

      // 打开抽屉
      await wrapper.find('.el-button').trigger('click')

      // 触发 notification-read 事件
      const notificationList = wrapper.findComponent(NotificationList)
      await notificationList.vm.$emit('notification-read')
      await flushPromises()

      // 验证 API 被再次调用
      expect(notificationApi.getUnreadCount).toHaveBeenCalledTimes(2)
    })

    it('全部已读后应该重置未读数量为 0', async () => {
      vi.mocked(notificationApi.getUnreadCount).mockResolvedValue({
        unread_count: 5
      })

      const wrapper = mount(NotificationBell)
      await flushPromises()

      // 打开抽屉
      await wrapper.find('.el-button').trigger('click')

      // 触发 all-read 事件
      const notificationList = wrapper.findComponent(NotificationList)
      await notificationList.vm.$emit('all-read')
      await flushPromises()

      // 验证徽章被隐藏
      const badge = wrapper.findComponent({ name: 'ElBadge' })
      expect(badge.props('hidden')).toBe(true)
    })
  })

  describe('轮询机制', () => {
    it('应该每 30 秒自动刷新未读数量', async () => {
      vi.mocked(notificationApi.getUnreadCount).mockResolvedValue({
        unread_count: 3
      })

      const wrapper = mount(NotificationBell)
      await flushPromises()

      // 初始调用
      expect(notificationApi.getUnreadCount).toHaveBeenCalledTimes(1)

      // 快进 30 秒
      vi.advanceTimersByTime(30000)
      await flushPromises()

      // 应该再次调用
      expect(notificationApi.getUnreadCount).toHaveBeenCalledTimes(2)

      // 再快进 30 秒
      vi.advanceTimersByTime(30000)
      await flushPromises()

      // 应该第三次调用
      expect(notificationApi.getUnreadCount).toHaveBeenCalledTimes(3)
    })

    it('组件卸载时应该停止轮询', async () => {
      vi.mocked(notificationApi.getUnreadCount).mockResolvedValue({
        unread_count: 3
      })

      const wrapper = mount(NotificationBell)
      await flushPromises()

      // 初始调用
      expect(notificationApi.getUnreadCount).toHaveBeenCalledTimes(1)

      // 卸载组件
      wrapper.unmount()

      // 快进 30 秒
      vi.advanceTimersByTime(30000)
      await flushPromises()

      // 不应该再次调用
      expect(notificationApi.getUnreadCount).toHaveBeenCalledTimes(1)
    })

    it('轮询期间 API 失败不应该影响后续轮询', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { })

      vi.mocked(notificationApi.getUnreadCount)
        .mockResolvedValueOnce({ unread_count: 3 })
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ unread_count: 5 })

      const wrapper = mount(NotificationBell)
      await flushPromises()

      // 第一次成功
      expect(notificationApi.getUnreadCount).toHaveBeenCalledTimes(1)

      // 第二次失败
      vi.advanceTimersByTime(30000)
      await flushPromises()
      expect(notificationApi.getUnreadCount).toHaveBeenCalledTimes(2)

      // 第三次成功
      vi.advanceTimersByTime(30000)
      await flushPromises()
      expect(notificationApi.getUnreadCount).toHaveBeenCalledTimes(3)

      consoleErrorSpy.mockRestore()
    })
  })

  describe('边界情况', () => {
    it('应该处理负数未读数量（防御性编程）', async () => {
      vi.mocked(notificationApi.getUnreadCount).mockResolvedValue({
        unread_count: -1
      })

      const wrapper = mount(NotificationBell)
      await flushPromises()

      // 组件应该不会崩溃
      expect(wrapper.find('.notification-bell').exists()).toBe(true)
    })

    it('应该处理非常大的未读数量', async () => {
      vi.mocked(notificationApi.getUnreadCount).mockResolvedValue({
        unread_count: 999999
      })

      const wrapper = mount(NotificationBell)
      await flushPromises()

      const badge = wrapper.findComponent({ name: 'ElBadge' })
      expect(badge.props('value')).toBe(999999)
      expect(badge.props('max')).toBe(99)
    })
  })
})
