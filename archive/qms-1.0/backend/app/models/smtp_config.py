"""
SMTPConfig Model - 邮件服务器配置模型

用于配置SMTP邮件服务器参数,支持连接测试和多配置管理。
"""
from datetime import datetime
from enum import Enum
from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime

from app.models.base import Base


class TestResult(str, Enum):
    """测试结果枚举"""
    SUCCESS = "success"  # 测试成功
    FAILED = "failed"    # 测试失败


class SMTPConfig(Base):
    """
    SMTP邮件服务器配置模型
    
    存储邮件服务器的连接参数，支持加密存储密码和连接测试。
    系统可配置多个SMTP服务器，通过is_active标识当前使用的配置。
    """
    __tablename__ = "smtp_configs"

    # 主键
    id = Column(Integer, primary_key=True, index=True, comment="配置ID")
    
    # 配置名称
    config_name = Column(
        String(100),
        unique=True,
        nullable=False,
        comment="配置名称（唯一标识）"
    )
    
    # SMTP服务器参数
    smtp_host = Column(String(255), nullable=False, comment="SMTP服务器地址")
    smtp_port = Column(Integer, nullable=False, comment="SMTP端口（通常为25/465/587）")
    smtp_user = Column(String(255), nullable=False, comment="SMTP用户名")
    smtp_password_encrypted = Column(
        Text,
        nullable=False,
        comment="SMTP密码（加密存储）"
    )
    use_tls = Column(
        Boolean,
        default=True,
        nullable=False,
        comment="是否使用TLS加密"
    )
    
    # 发件人信息
    from_email = Column(String(255), nullable=False, comment="发件人邮箱地址")
    from_name = Column(String(100), nullable=True, comment="发件人显示名称")
    
    # 状态管理
    is_active = Column(
        Boolean,
        default=True,
        nullable=False,
        index=True,
        comment="是否为当前激活配置"
    )
    
    # 测试记录
    last_test_at = Column(
        DateTime,
        nullable=True,
        comment="最后测试时间"
    )
    last_test_result = Column(
        String(20),
        nullable=True,
        comment="最后测试结果: success/failed"
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

    def __repr__(self):
        return f"<SMTPConfig(id={self.id}, name={self.config_name}, host={self.smtp_host}, active={self.is_active})>"

    def to_dict(self, include_password=False):
        """
        转换为字典格式
        
        Args:
            include_password: 是否包含密码（默认不包含，用于安全传输）
        """
        data = {
            "id": self.id,
            "config_name": self.config_name,
            "smtp_host": self.smtp_host,
            "smtp_port": self.smtp_port,
            "smtp_user": self.smtp_user,
            "use_tls": self.use_tls,
            "from_email": self.from_email,
            "from_name": self.from_name,
            "is_active": self.is_active,
            "last_test_at": self.last_test_at.isoformat() if self.last_test_at else None,
            "last_test_result": self.last_test_result,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
        
        if include_password:
            data["smtp_password_encrypted"] = self.smtp_password_encrypted
        
        return data
