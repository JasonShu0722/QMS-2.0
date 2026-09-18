/**
 * 公告类型定义
 */

/**
 * 公告类型枚举
 */
export type AnnouncementType = 'system' | 'quality_alert' | 'document_update'

/**
 * 公告重要性枚举
 */
export type AnnouncementImportance = 'normal' | 'important'

/**
 * 公告数据结构
 */
export interface Announcement {
  id: number
  title: string
  content: string
  type: AnnouncementType
  importance: AnnouncementImportance
  is_published: boolean
  published_at: string
  created_by: number
  created_at: string
  updated_at: string
  is_read?: boolean // 当前用户是否已读
  read_at?: string // 当前用户阅读时间
}

/**
 * 公告列表响应
 */
export interface AnnouncementListResponse {
  announcements: Announcement[]
  total: number
  page: number
  page_size: number
}

/**
 * 标记已读请求
 */
export interface MarkAnnouncementReadRequest {
  announcement_id: number
}

/**
 * 标记已读响应
 */
export interface MarkAnnouncementReadResponse {
  message: string
}
