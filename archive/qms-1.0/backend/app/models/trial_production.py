"""
Trial Production Model
试产记录模型 - 试产目标与实绩管理
"""
from sqlalchemy import Column, Integer, String, Text, DateTime, Enum as SQLEnum, ForeignKey, JSON
from sqlalchemy.orm import relationship
from datetime import datetime
import enum

from .base import Base


class TrialStatus(str, enum.Enum):
    """试产状态枚举"""
    PLANNED = "planned"  # 计划中
    IN_PROGRESS = "in_progress"  # 进行中
    COMPLETED = "completed"  # 已完成
    CANCELLED = "cancelled"  # 已取消


class TrialProduction(Base):
    """
    试产记录模型
    实现2.8.3试产目标与实绩管理
    自动抓取IMS数据并结合手工录入生成试产总结报告
    """
    __tablename__ = "trial_productions"

    id = Column(Integer, primary_key=True, index=True)
    
    # 关联项目
    project_id = Column(Integer, ForeignKey("new_product_projects.id"), nullable=False, index=True, comment="项目ID")
    
    # 试产基础信息
    work_order = Column(String(100), nullable=False, index=True, comment="IMS工单号")
    trial_batch = Column(String(50), nullable=True, comment="试产批次号")
    trial_date = Column(DateTime, nullable=True, comment="试产日期")
    
    # 目标指标（JSON格式）
    # 结构示例：{
    #   "pass_rate": {"target": 95, "unit": "%"},
    #   "cpk": {"target": 1.33, "unit": ""},
    #   "dimension_pass_rate": {"target": 100, "unit": "%"}
    # }
    target_metrics = Column(JSON, nullable=True, comment="目标指标（JSON格式）")
    
    # 实绩指标（JSON格式）
    # 结构示例：{
    #   "input_qty": 1000,  # 投入数（IMS自动抓取）
    #   "output_qty": 950,  # 产出数（IMS自动抓取）
    #   "first_pass_qty": 920,  # 一次合格数（IMS自动抓取）
    #   "defect_qty": 30,  # 不良数（IMS自动抓取）
    #   "pass_rate": {"actual": 96.8, "status": "pass"},  # 自动计算
    #   "cpk": {"actual": 1.45, "status": "pass"},  # 手工录入
    #   "dimension_pass_rate": {"actual": 100, "status": "pass"}  # 手工录入
    # }
    actual_metrics = Column(JSON, nullable=True, comment="实绩指标（JSON格式）")
    
    # IMS数据同步状态
    ims_sync_status = Column(String(20), nullable=True, comment="IMS数据同步状态：pending/synced/failed")
    ims_sync_at = Column(DateTime, nullable=True, comment="IMS数据同步时间")
    ims_sync_error = Column(Text, nullable=True, comment="IMS同步错误信息")
    
    # 试产状态
    status = Column(
        SQLEnum(TrialStatus, native_enum=False, length=20),
        nullable=False,
        default=TrialStatus.PLANNED,
        index=True,
        comment="试产状态"
    )
    
    # 试产总结
    summary_report_path = Column(String(500), nullable=True, comment="试产总结报告路径（Excel/PDF）")
    summary_comments = Column(Text, nullable=True, comment="试产总结评价")
    
    # 审计字段
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, comment="创建时间")
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow, comment="更新时间")
    created_by = Column(Integer, nullable=True, comment="创建人ID")
    updated_by = Column(Integer, nullable=True, comment="更新人ID")
    
    # 关系映射
    project = relationship("NewProductProject", back_populates="trial_productions")
    trial_issues = relationship("TrialIssue", back_populates="trial_production", cascade="all, delete-orphan")
    
    def __repr__(self):
        return f"<TrialProduction(id={self.id}, project_id={self.project_id}, work_order='{self.work_order}', status='{self.status}')>"
    
    def to_dict(self) -> dict:
        """转换为字典格式"""
        return {
            "id": self.id,
            "project_id": self.project_id,
            "work_order": self.work_order,
            "trial_batch": self.trial_batch,
            "trial_date": self.trial_date.isoformat() if self.trial_date else None,
            "target_metrics": self.target_metrics,
            "actual_metrics": self.actual_metrics,
            "ims_sync_status": self.ims_sync_status,
            "ims_sync_at": self.ims_sync_at.isoformat() if self.ims_sync_at else None,
            "status": self.status,
            "summary_report_path": self.summary_report_path,
            "summary_comments": self.summary_comments,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }
