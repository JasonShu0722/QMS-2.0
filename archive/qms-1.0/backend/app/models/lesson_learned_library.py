"""
Lesson Learned Library Model
经验教训库模型 - 用于新品项目的经验教训管理
"""
from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, Enum as SQLEnum
from sqlalchemy.orm import relationship
from datetime import datetime
import enum

from .base import Base


class SourceModule(str, enum.Enum):
    """经验教训来源模块枚举"""
    SUPPLIER_QUALITY = "supplier_quality"  # 供应商质量管理（2.5模块）
    PROCESS_QUALITY = "process_quality"  # 过程质量管理（2.6模块）
    CUSTOMER_QUALITY = "customer_quality"  # 客户质量管理（2.7模块）
    MANUAL = "manual"  # 手工录入


class LessonLearnedLibrary(Base):
    """
    经验教训库模型
    用于新品项目的经验教训反向注入
    从各模块的8D结案记录中提取并沉淀
    """
    __tablename__ = "lesson_learned_library"

    id = Column(Integer, primary_key=True, index=True)
    
    # 经验教训内容
    lesson_title = Column(String(200), nullable=False, comment="经验教训标题")
    lesson_content = Column(Text, nullable=False, comment="经验教训详细内容")
    
    # 来源信息
    source_module = Column(
        SQLEnum(SourceModule, native_enum=False, length=50),
        nullable=False,
        comment="来源模块"
    )
    source_record_id = Column(Integer, nullable=True, comment="来源记录ID（8D报告ID等）")
    
    # 根本原因与预防措施
    root_cause = Column(Text, nullable=False, comment="根本原因")
    preventive_action = Column(Text, nullable=False, comment="预防措施")
    
    # 适用场景标签（用于智能推送）
    applicable_scenarios = Column(Text, nullable=True, comment="适用场景描述")
    
    # 状态控制
    is_active = Column(Boolean, nullable=False, default=True, index=True, comment="是否启用")
    
    # 审计字段
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, comment="创建时间")
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow, comment="更新时间")
    created_by = Column(Integer, nullable=True, comment="创建人ID")
    updated_by = Column(Integer, nullable=True, comment="更新人ID")
    
    # 关系映射
    project_checks = relationship("ProjectLessonCheck", back_populates="lesson")
    
    def __repr__(self):
        return f"<LessonLearnedLibrary(id={self.id}, title='{self.lesson_title}', source='{self.source_module}')>"
    
    def to_dict(self) -> dict:
        """转换为字典格式"""
        return {
            "id": self.id,
            "lesson_title": self.lesson_title,
            "lesson_content": self.lesson_content,
            "source_module": self.source_module,
            "source_record_id": self.source_record_id,
            "root_cause": self.root_cause,
            "preventive_action": self.preventive_action,
            "applicable_scenarios": self.applicable_scenarios,
            "is_active": self.is_active,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }
