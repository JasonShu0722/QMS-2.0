"""
Operation Log Model - 操作日志审计模型

记录用户的关键操作（提交、修改、删除），包含操作前后的数据快照，
用于安全审计和问题追溯。
"""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship

from app.models.base import Base


class OperationLog(Base):
    """
    操作日志审计模型
    
    记录所有关键操作的详细信息，包括操作人、操作类型、目标对象、
    数据快照（修改前后对比）以及请求来源信息。
    """
    __tablename__ = "operation_logs"

    # 主键
    id = Column(Integer, primary_key=True, index=True, comment="日志ID")
    
    # 操作人
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        comment="操作用户ID（删除用户后保留日志）"
    )
    
    # 操作信息
    operation_type = Column(
        String(50),
        nullable=False,
        index=True,
        comment="操作类型: create/update/delete/login/logout"
    )
    target_module = Column(
        String(100),
        nullable=False,
        index=True,
        comment="目标模块: user/permission/supplier/scar等"
    )
    target_id = Column(
        Integer,
        nullable=True,
        index=True,
        comment="目标对象ID（如用户ID、单据ID）"
    )
    
    # 数据快照（用于修改操作的前后对比）
    before_data = Column(
        JSON,
        nullable=True,
        comment="操作前数据快照（JSON格式）"
    )
    after_data = Column(
        JSON,
        nullable=True,
        comment="操作后数据快照（JSON格式）"
    )
    
    # 请求信息（用于安全审计）
    ip_address = Column(String(45), nullable=True, comment="客户端IP地址（支持IPv6）")
    user_agent = Column(Text, nullable=True, comment="浏览器User-Agent")
    
    # 审计字段
    created_at = Column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
        index=True,
        comment="操作时间"
    )
    
    # 关系定义
    user = relationship("User", back_populates="operation_logs")

    def __repr__(self):
        return f"<OperationLog(id={self.id}, user_id={self.user_id}, operation={self.operation_type}, module={self.target_module})>"

    def to_dict(self):
        """转换为字典格式"""
        return {
            "id": self.id,
            "user_id": self.user_id,
            "operation_type": self.operation_type,
            "target_module": self.target_module,
            "target_id": self.target_id,
            "before_data": self.before_data,
            "after_data": self.after_data,
            "ip_address": self.ip_address,
            "user_agent": self.user_agent,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
