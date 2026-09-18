"""
Announcement Model - 公告模型

用于系统公告、质量预警、体系文件更新通知等全员通知。
支持重要公告的强制阅读机制和有效期管理。
"""
from datetime import datetime
from enum import Enum
from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime
from sqlalchemy.orm import relationship

from app.models.base import Base


class AnnouncementType(str, Enum):
    """公告类型枚举"""
    SYSTEM = "system"                    # 系统公告（维护通知）
    QUALITY_WARNING = "quality_warning"  # 质量预警
    DOCUMENT_UPDATE = "document_update"  # 体系文件更新通知


class ImportanceLevel(str, Enum):
    """重要程度枚举"""
    NORMAL = "normal"        # 普通
    IMPORTANT = "important"  # 重要（需强制阅读确认）


class Announcement(Base):
    """
    公告模型
    
    用于发布系统级或质量预警类的全员通知。
    重要公告支持强制阅读机制，系统记录阅读人和阅读时间。
    """
    __tablename__ = "announcements"

    # 主键
    id = Column(Integer, primary_key=True, index=True, comment="公告ID")
    
    # 公告内容
    title = Column(String(200), nullable=False, comment="公告标题")
    content = Column(Text, nullable=False, comment="公告内容（支持富文本）")
    
    # 分类与重要性
    announcement_type = Column(
        String(50),
        nullable=False,
        index=True,
        comment="公告类型: system/quality_warning/document_update"
    )
    importance = Column(
        String(20),
        nullable=False,
        default=ImportanceLevel.NORMAL.value,
        index=True,
        comment="重要程度: normal/important"
    )
    
    # 状态管理
    is_active = Column(
        Boolean,
        default=True,
        nullable=False,
        index=True,
        comment="是否激活（可用于撤回公告）"
    )
    published_at = Column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
        index=True,
        comment="发布时间"
    )
    expires_at = Column(
        DateTime,
        nullable=True,
        index=True,
        comment="过期时间（可选，过期后自动隐藏）"
    )
    
    # 审计字段
    created_at = Column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
        comment="创建时间"
    )
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
        comment="更新时间"
    )
    created_by = Column(Integer, nullable=True, comment="创建人ID")
    
    # 关系定义（阅读记录通过中间表管理）
    # announcement_reads = relationship("AnnouncementRead", back_populates="announcement")

    def __repr__(self):
        return f"<Announcement(id={self.id}, title={self.title}, type={self.announcement_type}, importance={self.importance})>"

    def to_dict(self):
        """转换为字典格式"""
        return {
            "id": self.id,
            "title": self.title,
            "content": self.content,
            "announcement_type": self.announcement_type,
            "importance": self.importance,
            "is_active": self.is_active,
            "published_at": self.published_at.isoformat() if self.published_at else None,
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "created_by": self.created_by,
        }
