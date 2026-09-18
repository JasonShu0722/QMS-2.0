import request from '@/utils/request'
import type {
  Announcement,
  AnnouncementListResponse,
  MarkAnnouncementReadResponse
} from '@/types/announcement'

/**
 * 公告相关 API
 */
export const announcementApi = {
  /**
   * 获取公告列表
   * @param page 页码
   * @param pageSize 每页数量
   */
  getAnnouncements(
    page: number = 1,
    pageSize: number = 20
  ): Promise<AnnouncementListResponse> {
    return request.get('/v1/announcements', {
      params: { page, page_size: pageSize }
    })
  },

  /**
   * 获取未读重要公告列表（用于登录后弹窗）
   */
  getUnreadImportantAnnouncements(): Promise<Announcement[]> {
    return request.get('/v1/announcements/unread-important')
  },

  /**
   * 标记公告为已读
   * @param announcementId 公告ID
   */
  markAsRead(announcementId: number): Promise<MarkAnnouncementReadResponse> {
    return request.post(`/v1/announcements/${announcementId}/read`)
  }
}
