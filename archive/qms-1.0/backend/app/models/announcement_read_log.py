"""
AnnouncementReadLog Model - 公告阅读记录模型

记录用户对重要公告的阅读确认,用于统计阅读率和强制阅读机制。
"""
from datetime import datetime
from sqlalchemy import Column, Integer, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship

from app.models.base import Base


class AnnouncementReadLog(Base):
    """
    公告阅读记录模型
    
    记录用户对公告的阅读时间，用于统计阅读率和实现强制阅读机制。
    每个用户对每条公告只能有一条阅读记录（唯一约束）。
    """
    __tablename__ = "announcement_read_logs"

    # 主键
    id = Column(Integer, primary_key=True, index=True, comment="记录ID")
    
    # 关联公告
    announcement_id = Column(
        Integer,
        ForeignKey("announcements.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="公告ID"
    )
    
    # 关联用户
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="阅读用户ID"
    )
    
    # 阅读时间
    read_at = Column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
        comment="阅读时间"
    )
    
    # 唯一约束：每个用户对每条公告只能有一条阅读记录
    __table_args__ = (
        UniqueConstraint('announcement_id', 'user_id', name='uq_announcement_user'),
    )
    
    # 关系定义
    announcement = relationship("Announcement", backref="read_logs")
    user = relationship("User", backref="announcement_reads")

    def __repr__(self):
        return f"<AnnouncementReadLog(id={self.id}, announcement_id={self.announcement_id}, user_id={self.user_id})>"

    def to_dict(self):
        """转换为字典格式"""
        return {
            "id": self.id,
            "announcement_id": self.announcement_id,
            "user_id": self.user_id,
            "read_at": self.read_at.isoformat() if self.read_at else None,
        }
