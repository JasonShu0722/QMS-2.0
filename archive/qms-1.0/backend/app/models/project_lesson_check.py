"""
Project Lesson Check Model
项目经验教训点检模型 - 记录新品项目对历史经验教训的点检情况
"""
from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime

from .base import Base


class ProjectLessonCheck(Base):
    """
    项目经验教训点检模型
    实现2.8.1经验教训反向注入的核心功能
    强制项目团队逐条勾选历史问题的规避措施
    """
    __tablename__ = "project_lesson_checks"

    id = Column(Integer, primary_key=True, index=True)
    
    # 关联信息
    project_id = Column(Integer, ForeignKey("new_product_projects.id"), nullable=False, index=True, comment="项目ID")
    lesson_id = Column(Integer, ForeignKey("lesson_learned_library.id"), nullable=False, index=True, comment="经验教训ID")
    
    # 点检结果
    is_applicable = Column(Boolean, nullable=False, comment="是否适用于本项目")
    reason_if_not = Column(Text, nullable=True, comment="不适用原因说明")
    
    # 规避证据
    evidence_file_path = Column(String(500), nullable=True, comment="规避证据文件路径（设计截图、文件修改记录等）")
    evidence_description = Column(Text, nullable=True, comment="规避措施描述")
    
    # 点检人员与时间
    checked_by = Column(Integer, nullable=True, comment="点检人ID")
    checked_at = Column(DateTime, nullable=True, comment="点检时间")
    
    # 审核信息（阶段评审时验证）
    verified_by = Column(Integer, nullable=True, comment="验证人ID（阶段评审员）")
    verified_at = Column(DateTime, nullable=True, comment="验证时间")
    verification_result = Column(String(20), nullable=True, comment="验证结果：passed/failed")
    verification_comment = Column(Text, nullable=True, comment="验证意见")
    
    # 审计字段
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, comment="创建时间")
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow, comment="更新时间")
    
    # 关系映射
    project = relationship("NewProductProject", back_populates="lesson_checks")
    lesson = relationship("LessonLearnedLibrary", back_populates="project_checks")
    
    def __repr__(self):
        return f"<ProjectLessonCheck(id={self.id}, project_id={self.project_id}, lesson_id={self.lesson_id}, applicable={self.is_applicable})>"
    
    def to_dict(self) -> dict:
        """转换为字典格式"""
        return {
            "id": self.id,
            "project_id": self.project_id,
            "lesson_id": self.lesson_id,
            "is_applicable": self.is_applicable,
            "reason_if_not": self.reason_if_not,
            "evidence_file_path": self.evidence_file_path,
            "evidence_description": self.evidence_description,
            "checked_by": self.checked_by,
            "checked_at": self.checked_at.isoformat() if self.checked_at else None,
            "verified_by": self.verified_by,
            "verified_at": self.verified_at.isoformat() if self.verified_at else None,
            "verification_result": self.verification_result,
            "verification_comment": self.verification_comment,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }
