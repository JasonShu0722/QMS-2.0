"""
Announcement Schemas - 公告相关的 Pydantic 数据校验模型
"""
from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel, Field


class AnnouncementBase(BaseModel):
    """公告基础模型"""
    title: str = Field(..., max_length=200, description="公告标题")
    content: str = Field(..., description="公告内容（支持富文本）")
    announcement_type: str = Field(..., description="公告类型: system/quality_warning/document_update")
    importance: str = Field(default="normal", description="重要程度: normal/important")
    expires_at: Optional[datetime] = Field(None, description="过期时间（可选）")


class AnnouncementCreate(AnnouncementBase):
    """创建公告请求模型"""
    pass


class AnnouncementUpdate(BaseModel):
    """更新公告请求模型"""
    title: Optional[str] = Field(None, max_length=200, description="公告标题")
    content: Optional[str] = Field(None, description="公告内容")
    announcement_type: Optional[str] = Field(None, description="公告类型")
    importance: Optional[str] = Field(None, description="重要程度")
    expires_at: Optional[datetime] = Field(None, description="过期时间")
    is_active: Optional[bool] = Field(None, description="是否激活")


class AnnouncementResponse(AnnouncementBase):
    """公告响应模型"""
    id: int = Field(..., description="公告ID")
    is_active: bool = Field(..., description="是否激活")
    published_at: datetime = Field(..., description="发布时间")
    created_at: datetime = Field(..., description="创建时间")
    updated_at: datetime = Field(..., description="更新时间")
    created_by: Optional[int] = Field(None, description="创建人ID")
    is_read: Optional[bool] = Field(None, description="当前用户是否已读（仅在用户查询时返回）")

    class Config:
        from_attributes = True


class AnnouncementListResponse(BaseModel):
    """公告列表响应模型"""
    total: int = Field(..., description="总数量")
    announcements: List[AnnouncementResponse] = Field(..., description="公告列表")


class AnnouncementReadRequest(BaseModel):
    """记录阅读请求模型"""
    pass  # 不需要额外参数，用户ID从token获取，公告ID从路径获取


class AnnouncementReadResponse(BaseModel):
    """记录阅读响应模型"""
    success: bool = Field(..., description="是否成功")
    message: str = Field(..., description="响应消息")


class AnnouncementStatisticsResponse(BaseModel):
    """公告阅读统计响应模型"""
    announcement_id: int = Field(..., description="公告ID")
    announcement_title: str = Field(..., description="公告标题")
    total_users: int = Field(..., description="总用户数")
    read_count: int = Field(..., description="已读人数")
    unread_count: int = Field(..., description="未读人数")
    read_rate: float = Field(..., description="阅读率（百分比）")
    read_users: List[dict] = Field(..., description="已读用户清单")


class UserReadInfo(BaseModel):
    """用户阅读信息"""
    user_id: int = Field(..., description="用户ID")
    username: str = Field(..., description="用户名")
    full_name: str = Field(..., description="姓名")
    read_at: datetime = Field(..., description="阅读时间")

    class Config:
        from_attributes = True
