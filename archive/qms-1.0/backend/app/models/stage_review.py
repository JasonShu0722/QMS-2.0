"""
Stage Review Model
阶段评审模型 - 新品项目的质量阀门管理
"""
from sqlalchemy import Column, Integer, String, Text, DateTime, Enum as SQLEnum, ForeignKey, JSON
from sqlalchemy.orm import relationship
from datetime import datetime
import enum

from .base import Base


class ReviewResult(str, enum.Enum):
    """评审结果枚举"""
    PASSED = "passed"  # 通过
    CONDITIONAL_PASS = "conditional_pass"  # 有条件通过
    FAILED = "failed"  # 不通过
    PENDING = "pending"  # 待评审


class StageReview(Base):
    """
    阶段评审模型
    实现2.8.2阶段评审与交付物管理
    作为项目转段的质量阀门
    """
    __tablename__ = "stage_reviews"

    id = Column(Integer, primary_key=True, index=True)
    
    # 关联项目
    project_id = Column(Integer, ForeignKey("new_product_projects.id"), nullable=False, index=True, comment="项目ID")
    
    # 评审信息
    stage_name = Column(String(100), nullable=False, comment="阶段名称（如：概念评审、设计评审、试产评审）")
    review_date = Column(DateTime, nullable=True, comment="评审日期")
    planned_review_date = Column(DateTime, nullable=True, comment="计划评审日期")
    
    # 交付物清单（JSON格式）
    # 结构示例：[
    #   {"name": "DFMEA", "required": true, "file_path": "/uploads/...", "status": "submitted"},
    #   {"name": "控制计划", "required": true, "file_path": null, "status": "missing"}
    # ]
    deliverables = Column(JSON, nullable=True, comment="交付物清单（JSON格式）")
    
    # 评审结果
    review_result = Column(
        SQLEnum(ReviewResult, native_enum=False, length=30),
        nullable=False,
        default=ReviewResult.PENDING,
        comment="评审结果"
    )
    review_comments = Column(Text, nullable=True, comment="评审意见")
    
    # 评审人员（支持多人评审，存储用户ID数组的JSON字符串）
    reviewer_ids = Column(String(500), nullable=True, comment="评审人ID列表（逗号分隔）")
    
    # 条件通过的整改要求
    conditional_requirements = Column(Text, nullable=True, comment="有条件通过时的整改要求")
    conditional_deadline = Column(DateTime, nullable=True, comment="整改截止日期")
    
    # 审计字段
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, comment="创建时间")
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow, comment="更新时间")
    created_by = Column(Integer, nullable=True, comment="创建人ID")
    
    # 关系映射
    project = relationship("NewProductProject", back_populates="stage_reviews")
    
    def __repr__(self):
        return f"<StageReview(id={self.id}, project_id={self.project_id}, stage='{self.stage_name}', result='{self.review_result}')>"
    
    def to_dict(self) -> dict:
        """转换为字典格式"""
        return {
            "id": self.id,
            "project_id": self.project_id,
            "stage_name": self.stage_name,
            "review_date": self.review_date.isoformat() if self.review_date else None,
            "planned_review_date": self.planned_review_date.isoformat() if self.planned_review_date else None,
            "deliverables": self.deliverables,
            "review_result": self.review_result,
            "review_comments": self.review_comments,
            "reviewer_ids": self.reviewer_ids,
            "conditional_requirements": self.conditional_requirements,
            "conditional_deadline": self.conditional_deadline.isoformat() if self.conditional_deadline else None,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }
