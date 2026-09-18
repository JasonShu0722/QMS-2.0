"""
Lesson Learned Model
经验教训模型 - 记录从质量问题中沉淀的经验教训
"""
from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, Enum as SQLEnum, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
import enum

from .base import Base


class SourceType(str, enum.Enum):
    """经验教训来源类型枚举"""
    CUSTOMER_COMPLAINT = "customer_complaint"  # 客诉（2.7模块）
    SUPPLIER_8D = "supplier_8d"  # 供应商8D（2.5模块）
    PROCESS_ISSUE = "process_issue"  # 制程问题（2.6模块）
    MANUAL = "manual"  # 手工录入


class LessonLearned(Base):
    """
    经验教训模型
    从各模块的8D报告中提取并沉淀经验教训
    用于新品项目的反向注入和历史问题查重
    """
    __tablename__ = "lesson_learned"

    id = Column(Integer, primary_key=True, index=True)
    
    # 来源信息
    source_type = Column(SQLEnum(SourceType), nullable=False, comment="来源类型")
    source_id = Column(Integer, nullable=True, comment="来源记录ID（如客诉单ID、8D报告ID）")
    
    # 经验教训内容
    lesson_title = Column(String(200), nullable=False, comment="经验教训标题")
    lesson_content = Column(Text, nullable=False, comment="经验教训详细内容")
    root_cause = Column(Text, nullable=False, comment="根本原因")
    preventive_action = Column(Text, nullable=False, comment="预防措施")
    
    # 适用场景标签（用于智能推送）
    applicable_scenarios = Column(String(500), nullable=True, comment="适用场景标签（逗号分隔）")
    product_types = Column(String(200), nullable=True, comment="适用产品类型（逗号分隔）")
    process_types = Column(String(200), nullable=True, comment="适用工序类型（逗号分隔）")
    
    # 状态控制
    is_active = Column(Boolean, nullable=False, default=True, comment="是否启用（用于经验教训库管理）")
    
    # 审批信息
    approved_by = Column(Integer, ForeignKey("users.id"), nullable=True, comment="批准人ID")
    approved_at = Column(DateTime, nullable=True, comment="批准时间")
    
    # 审计字段
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, comment="创建时间")
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow, comment="更新时间")
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True, comment="创建人ID")
    
    # 关系
    approver = relationship("User", foreign_keys=[approved_by], backref="approved_lessons")
    creator = relationship("User", foreign_keys=[created_by], backref="created_lessons")
    
    def __repr__(self):
        return f"<LessonLearned(id={self.id}, title={self.lesson_title}, source={self.source_type})>"
