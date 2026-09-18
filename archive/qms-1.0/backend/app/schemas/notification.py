"""
Notification Schemas - 通知相关的 Pydantic 数据校验模型
"""
from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel, Field


class NotificationBase(BaseModel):
    """通知基础模型"""
    message_type: str = Field(..., description="消息类型")
    title: str = Field(..., max_length=200, description="消息标题")
    content: str = Field(..., description="消息内容")
    link: Optional[str] = Field(None, max_length=500, description="跳转链接")


class NotificationCreate(NotificationBase):
    """创建通知请求模型"""
    user_ids: List[int] = Field(..., description="接收用户ID列表")


class NotificationResponse(NotificationBase):
    """通知响应模型"""
    id: int = Field(..., description="通知ID")
    user_id: int = Field(..., description="接收用户ID")
    is_read: bool = Field(..., description="是否已读")
    read_at: Optional[datetime] = Field(None, description="阅读时间")
    created_at: datetime = Field(..., description="创建时间")

    class Config:
        from_attributes = True


class NotificationListResponse(BaseModel):
    """通知列表响应模型"""
    total: int = Field(..., description="总数量")
    notifications: List[NotificationResponse] = Field(..., description="通知列表")


class UnreadCountResponse(BaseModel):
    """未读消息数量响应模型"""
    unread_count: int = Field(..., description="未读消息数量")


class MarkReadResponse(BaseModel):
    """标记已读响应模型"""
    success: bool = Field(..., description="是否成功")
    message: str = Field(..., description="响应消息")
    affected_count: Optional[int] = Field(None, description="影响的消息数量")
