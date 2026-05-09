import request from '@/utils/request'
import type {
  NotificationListResponse,
  UnreadCountResponse,
  NotificationType
} from '@/types/notification'

/**
 * 通知相关 API
 */
export const notificationApi = {
  /**
   * 获取通知列表
   * @param type 消息类型筛选（可选）
   * @param page 页码
   * @param pageSize 每页数量
   */
  getNotifications(
    type?: NotificationType,
    page: number = 1,
    pageSize: number = 20
  ): Promise<NotificationListResponse> {
    const params: any = { page, page_size: pageSize }
    if (type) {
      params.message_type = type
    }
    return request.get('/v1/notifications', { params })
  },

  /**
   * 获取未读消息数量
   */
  getUnreadCount(): Promise<UnreadCountResponse> {
    return request.get('/v1/notifications/unread-count')
  },

  /**
   * 标记单条消息为已读
   * @param notificationId 消息ID
   */
  markAsRead(notificationId: number): Promise<{ message: string }> {
    return request.put(`/v1/notifications/${notificationId}/read`)
  },

  /**
   * 一键标记全部已读
   */
  markAllAsRead(): Promise<{ message: string }> {
    return request.put('/v1/notifications/read-all')
  }
}
