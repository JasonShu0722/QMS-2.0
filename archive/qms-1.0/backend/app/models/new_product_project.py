"""
New Product Project Model
新品项目模型 - 新品质量管理的核心实体
"""
from sqlalchemy import Column, Integer, String, DateTime, Enum as SQLEnum
from sqlalchemy.orm import relationship
from datetime import datetime
import enum

from .base import Base


class ProjectStage(str, enum.Enum):
    """项目阶段枚举"""
    CONCEPT = "concept"  # 概念阶段
    DESIGN = "design"  # 设计阶段
    DEVELOPMENT = "development"  # 开发阶段
    VALIDATION = "validation"  # 验证阶段
    TRIAL_PRODUCTION = "trial_production"  # 试产阶段
    SOP = "sop"  # 量产阶段
    CLOSED = "closed"  # 项目关闭


class ProjectStatus(str, enum.Enum):
    """项目状态枚举"""
    ACTIVE = "active"  # 进行中
    ON_HOLD = "on_hold"  # 暂停
    COMPLETED = "completed"  # 已完成
    CANCELLED = "cancelled"  # 已取消


class NewProductProject(Base):
    """
    新品项目模型
    管理新品开发项目的全生命周期
    """
    __tablename__ = "new_product_projects"

    id = Column(Integer, primary_key=True, index=True)
    
    # 项目基础信息
    project_code = Column(String(50), unique=True, nullable=False, index=True, comment="项目代码")
    project_name = Column(String(200), nullable=False, comment="项目名称")
    product_type = Column(String(100), nullable=True, comment="产品类型")
    
    # 项目管理信息
    project_manager = Column(String(100), nullable=True, comment="项目经理")
    project_manager_id = Column(Integer, nullable=True, comment="项目经理用户ID")
    
    # 项目阶段与状态
    current_stage = Column(
        SQLEnum(ProjectStage, native_enum=False, length=50),
        nullable=False,
        default=ProjectStage.CONCEPT,
        index=True,
        comment="当前阶段"
    )
    status = Column(
        SQLEnum(ProjectStatus, native_enum=False, length=20),
        nullable=False,
        default=ProjectStatus.ACTIVE,
        index=True,
        comment="项目状态"
    )
    
    # 时间节点
    planned_sop_date = Column(DateTime, nullable=True, comment="计划SOP日期")
    actual_sop_date = Column(DateTime, nullable=True, comment="实际SOP日期")
    
    # 审计字段
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, comment="创建时间")
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow, comment="更新时间")
    created_by = Column(Integer, nullable=True, comment="创建人ID")
    updated_by = Column(Integer, nullable=True, comment="更新人ID")
    
    # 关系映射
    lesson_checks = relationship("ProjectLessonCheck", back_populates="project", cascade="all, delete-orphan")
    stage_reviews = relationship("StageReview", back_populates="project", cascade="all, delete-orphan")
    trial_productions = relationship("TrialProduction", back_populates="project", cascade="all, delete-orphan")
    initial_flow_controls = relationship("InitialFlowControl", back_populates="project", cascade="all, delete-orphan")
    
    def __repr__(self):
        return f"<NewProductProject(id={self.id}, code='{self.project_code}', name='{self.project_name}', stage='{self.current_stage}')>"
    
    def to_dict(self) -> dict:
        """转换为字典格式"""
        return {
            "id": self.id,
            "project_code": self.project_code,
            "project_name": self.project_name,
            "product_type": self.product_type,
            "project_manager": self.project_manager,
            "project_manager_id": self.project_manager_id,
            "current_stage": self.current_stage,
            "status": self.status,
            "planned_sop_date": self.planned_sop_date.isoformat() if self.planned_sop_date else None,
            "actual_sop_date": self.actual_sop_date.isoformat() if self.actual_sop_date else None,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }
