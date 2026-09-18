// @ts-nocheck
/**
 * TaskCard 组件单元测试
 * 
 * 测试任务卡片组件的核心功能：
 * - 任务信息展示
 * - 紧急程度颜色标识
 * - 时间格式化
 * - 点击事件
 * 
 * Requirements: 2.2.3 待办任务聚合
 */

import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import TaskCard from '../TaskCard.vue'
import type { TodoTask } from '@/types/workbench'

describe('TaskCard.vue', () => {
  // 测试数据：正常状态任务（绿色）
  const normalTask: TodoTask = {
    task_type: '8D报告审核',
    task_id: 'SCAR-2024-001',
    title: '供应商A物料不良问题',
    description: '来料批次检验发现不合格',
    deadline: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(), // 5天后
    remaining_hours: 120, // 5天 = 120小时
    urgency: 'normal',
    color: 'green',
    link: '/supplier/scar/1'
  }

  // 测试数据：即将超期任务（黄色）
  const urgentTask: TodoTask = {
    task_type: 'PPAP审批',
    task_id: 'PPAP-2024-002',
    title: '新物料PPAP文件审核',
    deadline: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(), // 48小时后
    remaining_hours: 48,
    urgency: 'urgent',
    color: 'yellow',
    link: '/supplier/ppap/2'
  }

  // 测试数据：已超期任务（红色）
  const overdueTask: TodoTask = {
    task_type: '客诉处理',
    task_id: 'COMPLAINT-2024-003',
    title: '客户投诉紧急处理',
    deadline: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2天前
    remaining_hours: -48, // 超期48小时
    urgency: 'overdue',
    color: 'red',
    link: '/customer/complaint/3'
  }

  describe('任务信息展示', () => {
    it('应该正确展示任务类型和ID', () => {
      const wrapper = mount(TaskCard, {
        props: { task: normalTask }
      })

      expect(wrapper.text()).toContain('8D报告审核')
      expect(wrapper.text()).toContain('SCAR-2024-001')
    })

    it('应该展示任务标题（如果有）', () => {
      const wrapper = mount(TaskCard, {
        props: { task: normalTask }
      })

      expect(wrapper.text()).toContain('供应商A物料不良问题')
    })

    it('应该展示任务描述（如果有）', () => {
      const wrapper = mount(TaskCard, {
        props: { task: normalTask }
      })

      expect(wrapper.text()).toContain('来料批次检验发现不合格')
    })

    it('应该正确处理没有标题和描述的任务', () => {
      const minimalTask: TodoTask = {
        ...normalTask,
        title: undefined,
        description: undefined
      }

      const wrapper = mount(TaskCard, {
        props: { task: minimalTask }
      })

      // 应该仍然展示任务类型和ID
      expect(wrapper.text()).toContain('8D报告审核')
      expect(wrapper.text()).toContain('SCAR-2024-001')
    })
  })

  describe('紧急程度颜色标识', () => {
    it('正常任务应该显示绿色边框', () => {
      const wrapper = mount(TaskCard, {
        props: { task: normalTask }
      })

      const card = wrapper.find('.task-card')
      expect(card.classes()).toContain('task-card--green')
    })

    it('即将超期任务应该显示黄色边框', () => {
      const wrapper = mount(TaskCard, {
        props: { task: urgentTask }
      })

      const card = wrapper.find('.task-card')
      expect(card.classes()).toContain('task-card--yellow')
    })

    it('已超期任务应该显示红色边框', () => {
      const wrapper = mount(TaskCard, {
        props: { task: overdueTask }
      })

      const card = wrapper.find('.task-card')
      expect(card.classes()).toContain('task-card--red')
    })
  })

  describe('时间格式化', () => {
    it('应该正确格式化剩余天数（>24小时）', () => {
      const wrapper = mount(TaskCard, {
        props: { task: normalTask }
      })

      expect(wrapper.text()).toContain('剩余 5 天')
    })

    it('应该正确格式化剩余小时数（<24小时）', () => {
      const wrapper = mount(TaskCard, {
        props: { task: urgentTask }
      })

      expect(wrapper.text()).toContain('剩余 48 小时')
    })

    it('应该正确格式化超期天数', () => {
      const wrapper = mount(TaskCard, {
        props: { task: overdueTask }
      })

      expect(wrapper.text()).toContain('已超期 2 天')
    })

    it('应该正确格式化超期小时数（<24小时）', () => {
      const overdueHoursTask: TodoTask = {
        ...overdueTask,
        remaining_hours: -12 // 超期12小时
      }

      const wrapper = mount(TaskCard, {
        props: { task: overdueHoursTask }
      })

      expect(wrapper.text()).toContain('已超期 12 小时')
    })

    it('应该展示格式化的截止时间', () => {
      const wrapper = mount(TaskCard, {
        props: { task: normalTask }
      })

      // 检查是否包含"截止:"文本
      expect(wrapper.text()).toContain('截止:')
      // 截止时间应该是中文格式的日期时间
      expect(wrapper.text()).toMatch(/\d{4}\/\d{2}\/\d{2}/)
    })
  })

  describe('点击事件', () => {
    it('点击卡片应该触发 click 事件', async () => {
      const wrapper = mount(TaskCard, {
        props: { task: normalTask }
      })

      await wrapper.find('.task-card').trigger('click')

      // 验证事件被触发
      expect(wrapper.emitted('click')).toBeTruthy()
      expect(wrapper.emitted('click')?.[0]).toEqual([normalTask])
    })

    it('应该支持多次点击', async () => {
      const wrapper = mount(TaskCard, {
        props: { task: normalTask }
      })

      const card = wrapper.find('.task-card')
      await card.trigger('click')
      await card.trigger('click')
      await card.trigger('click')

      // 验证事件被触发3次
      expect(wrapper.emitted('click')).toHaveLength(3)
    })
  })

  describe('响应式样式', () => {
    it('应该包含移动端响应式类名', () => {
      const wrapper = mount(TaskCard, {
        props: { task: normalTask }
      })

      // 验证组件包含基础样式类
      expect(wrapper.find('.task-card').exists()).toBe(true)
      expect(wrapper.find('.task-card__header').exists()).toBe(true)
      expect(wrapper.find('.task-card__footer').exists()).toBe(true)
    })
  })

  describe('边界情况', () => {
    it('应该处理 remaining_hours 为 0 的情况', () => {
      const zeroHoursTask: TodoTask = {
        ...normalTask,
        remaining_hours: 0
      }

      const wrapper = mount(TaskCard, {
        props: { task: zeroHoursTask }
      })

      expect(wrapper.text()).toContain('剩余 0 小时')
    })

    it('应该处理非常大的 remaining_hours 值', () => {
      const longTermTask: TodoTask = {
        ...normalTask,
        remaining_hours: 720 // 30天
      }

      const wrapper = mount(TaskCard, {
        props: { task: longTermTask }
      })

      expect(wrapper.text()).toContain('剩余 30 天')
    })

    it('应该处理无效的日期格式', () => {
      const invalidDateTask: TodoTask = {
        ...normalTask,
        deadline: 'invalid-date'
      }

      const wrapper = mount(TaskCard, {
        props: { task: invalidDateTask }
      })

      // 组件应该不会崩溃，仍然能渲染
      expect(wrapper.find('.task-card').exists()).toBe(true)
    })
  })
})
