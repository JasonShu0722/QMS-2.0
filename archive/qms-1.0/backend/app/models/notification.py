"""
Notification Model - 站内信通知模型

用于系统内部消息推送,包括流程异常、系统提醒、预警通知等。
支持未读/已读状态管理和消息链接跳转。
"""
from datetime import datetime
from enum import Enum
from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship

from app.models.base import Base


class MessageType(str, Enum):
    """消息类型枚举"""
    WORKFLOW_EXCEPTION = "workflow_exception"  # 流程异常通知
    SYSTEM_ALERT = "system_alert"              # 系统提醒
    WARNING = "warning"                        # 预警通知


class Notification(Base):
    """
    站内信通知模型
    
    用于记录系统推送给用户的各类通知消息，支持已读/未读状态管理。
    """
    __tablename__ = "notifications"

    # 主键
    id = Column(Integer, primary_key=True, index=True, comment="通知ID")
    
    # 关联用户
    user_id = Column(
        Integer, 
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="接收用户ID"
    )
    
    # 消息内容
    message_type = Column(
        String(50),
        nullable=False,
        index=True,
        comment="消息类型: workflow_exception/system_alert/warning"
    )
    title = Column(String(200), nullable=False, comment="消息标题")
    content = Column(Text, nullable=False, comment="消息内容")
    link = Column(String(500), nullable=True, comment="跳转链接（可选）")
    
    # 状态管理
    is_read = Column(Boolean, default=False, nullable=False, index=True, comment="是否已读")
    read_at = Column(DateTime, nullable=True, comment="阅读时间")
    
    # 审计字段
    created_at = Column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
        index=True,
        comment="创建时间"
    )
    
    # 关系定义
    user = relationship("User", back_populates="notifications")

    def __repr__(self):
        return f"<Notification(id={self.id}, user_id={self.user_id}, type={self.message_type}, is_read={self.is_read})>"

    def to_dict(self):
        """转换为字典格式"""
        return {
            "id": self.id,
            "user_id": self.user_id,
            "message_type": self.message_type,
            "title": self.title,
            "content": self.content,
            "link": self.link,
            "is_read": self.is_read,
            "read_at": self.read_at.isoformat() if self.read_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
