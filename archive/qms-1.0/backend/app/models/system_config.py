"""
系统配置数据模型
System Config Model - 全局系统参数配置管理
"""
from datetime import datetime
from typing import Optional, Any, Dict
from sqlalchemy import String, DateTime, Integer, JSON, Text
from sqlalchemy.orm import Mapped, mapped_column
import enum

from .base import Base


class ConfigCategory(str, enum.Enum):
    """配置分类枚举"""
    BUSINESS_RULE = "business_rule"    # 业务规则
    TIMEOUT = "timeout"                # 超时时长
    FILE_LIMIT = "file_limit"          # 文件大小限制
    NOTIFICATION = "notification"      # 通知配置


class SystemConfig(Base):
    """
    系统配置模型
    用于存储全局性的系统参数配置，支持 JSON Schema 验证规则
    """
    __tablename__ = "system_configs"
    
    # 主键
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    
    # 配置标识
    config_key: Mapped[str] = mapped_column(
        String(100), 
        unique=True, 
        nullable=False, 
        index=True, 
        comment="配置键（唯一标识）"
    )
    
    # 配置值（JSON 格式存储，支持复杂数据结构）
    config_value: Mapped[Dict[str, Any]] = mapped_column(
        JSON,
        nullable=False,
        comment="配置值（JSON 格式）"
    )
    
    # 配置类型
    config_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        comment="配置数据类型（string/number/boolean/object/array）"
    )
    
    # 配置描述
    description: Mapped[Optional[str]] = mapped_column(
        Text,
        comment="配置项描述说明"
    )
    
    # 配置分类
    category: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        index=True,
        comment="配置分类"
    )
    
    # 验证规则（JSON Schema 格式）
    validation_rule: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        JSON,
        comment="验证规则（JSON Schema）"
    )
    
    # 审计字段
    created_at: Mapped[datetime] = mapped_column(
        DateTime, 
        default=datetime.utcnow, 
        nullable=False, 
        comment="创建时间"
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, 
        default=datetime.utcnow, 
        onupdate=datetime.utcnow, 
        nullable=False, 
        comment="更新时间"
    )
    updated_by: Mapped[Optional[int]] = mapped_column(
        Integer, 
        comment="最后更新人ID"
    )
    
    def __repr__(self) -> str:
        return f"<SystemConfig(id={self.id}, key='{self.config_key}', category='{self.category}')>"
    
    def to_dict(self) -> dict:
        """转换为字典格式"""
        return {
            "id": self.id,
            "config_key": self.config_key,
            "config_value": self.config_value,
            "config_type": self.config_type,
            "description": self.description,
            "category": self.category,
            "validation_rule": self.validation_rule,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "updated_by": self.updated_by,
        }
    
    def validate_value(self) -> tuple[bool, Optional[str]]:
        """
        验证配置值是否符合验证规则
        
        Returns:
            tuple[bool, Optional[str]]: (是否有效, 错误信息)
        """
        if not self.validation_rule:
            return True, None
        
        try:
            # 这里可以集成 jsonschema 库进行验证
            # from jsonschema import validate, ValidationError
            # validate(instance=self.config_value, schema=self.validation_rule)
            return True, None
        except Exception as e:
            return False, str(e)
    
    @classmethod
    def get_default_value(cls, config_key: str) -> Optional[Any]:
        """
        获取配置项的默认值
        当配置缺失时使用预设默认值
        
        Args:
            config_key: 配置键
            
        Returns:
            Optional[Any]: 默认值
        """
        # 预设默认值字典
        defaults = {
            "max_file_upload_size": {"value": 50, "unit": "MB"},
            "session_timeout": {"value": 24, "unit": "hours"},
            "password_expire_days": {"value": 90, "unit": "days"},
            "login_lock_attempts": {"value": 5, "unit": "times"},
            "login_lock_duration": {"value": 30, "unit": "minutes"},
        }
        
        return defaults.get(config_key)
