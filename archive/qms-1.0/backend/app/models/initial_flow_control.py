"""
Initial Flow Control Model (Reserved Interface)
初期流动管理模型（预留功能接口）

功能说明：
本模块为预留功能接口，用于未来实现新品初期流动管理。
当前阶段仅作为静态记录，不执行系统级的生产互锁控制。

预留功能包括：
1. 加严控制配置（如：首批次100%检验、关键尺寸逐件测量）
2. 退出机制自动判断（如：连续N批次合格率达标后自动解除加严）
3. 生产互锁（未来可与MES系统对接，实现自动拦截）

Requirements: 2.8.5
"""
from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, Enum as SQLEnum, ForeignKey, JSON
from sqlalchemy.orm import relationship
from datetime import datetime
import enum

from .base import Base


class FlowControlStatus(str, enum.Enum):
    """初期流动控制状态枚举（预留）"""
    ACTIVE = "active"  # 加严控制中
    MONITORING = "monitoring"  # 监控中（已放宽但仍观察）
    RELEASED = "released"  # 已解除
    SUSPENDED = "suspended"  # 已暂停（异常情况）


class FlowControlType(str, enum.Enum):
    """加严控制类型枚举（预留）"""
    FULL_INSPECTION = "full_inspection"  # 全检
    INCREASED_SAMPLING = "increased_sampling"  # 加大抽样
    KEY_DIMENSION_CHECK = "key_dimension_check"  # 关键尺寸逐件检查
    PROCESS_MONITORING = "process_monitoring"  # 过程监控
    CUSTOM = "custom"  # 自定义


class InitialFlowControl(Base):
    """
    初期流动管理模型（预留功能接口）
    
    实现2.8.5初期流动管理
    当前阶段仅作为静态记录，待整体系统运行成熟度提升后开启
    
    预留字段说明：
    - 所有字段均设置为nullable=True，确保数据库兼容性
    - 未来启用时，可根据实际需求调整字段约束
    """
    __tablename__ = "initial_flow_controls"

    id = Column(Integer, primary_key=True, index=True)
    
    # 关联项目（预留）
    project_id = Column(
        Integer, 
        ForeignKey("new_product_projects.id"), 
        nullable=True, 
        index=True, 
        comment="项目ID（预留）"
    )
    
    # 关联物料（预留）
    material_code = Column(String(100), nullable=True, index=True, comment="物料编码（预留）")
    material_name = Column(String(200), nullable=True, comment="物料名称（预留）")
    
    # 加严控制配置（预留）
    control_type = Column(
        SQLEnum(FlowControlType, native_enum=False, length=50),
        nullable=True,
        comment="加严控制类型（预留）"
    )
    
    control_config = Column(
        JSON, 
        nullable=True, 
        comment="加严控制配置（JSON格式，预留）"
        # 结构示例：{
        #   "inspection_rate": 100,  # 检验比例（%）
        #   "sample_size": 50,  # 抽样数量
        #   "key_dimensions": ["D1", "D2", "D3"],  # 关键尺寸列表
        #   "cpk_threshold": 1.67,  # CPK阈值
        #   "control_duration": 30  # 控制周期（天）
        # }
    )
    
    # 退出机制配置（预留）
    exit_criteria = Column(
        JSON, 
        nullable=True, 
        comment="退出机制配置（JSON格式，预留）"
        # 结构示例：{
        #   "consecutive_batches": 5,  # 连续合格批次数
        #   "pass_rate_threshold": 99.5,  # 合格率阈值（%）
        #   "cpk_threshold": 1.33,  # CPK阈值
        #   "zero_defect_batches": 3  # 零缺陷批次数
        # }
    )
    
    # 自动判断逻辑（预留）
    auto_exit_enabled = Column(Boolean, nullable=True, default=False, comment="是否启用自动退出（预留）")
    exit_evaluation_data = Column(
        JSON, 
        nullable=True, 
        comment="退出评估数据（JSON格式，预留）"
        # 结构示例：{
        #   "evaluated_batches": 3,  # 已评估批次数
        #   "qualified_batches": 3,  # 合格批次数
        #   "average_pass_rate": 99.8,  # 平均合格率
        #   "average_cpk": 1.45,  # 平均CPK
        #   "last_evaluation_date": "2026-01-15"
        # }
    )
    
    # 控制状态（预留）
    status = Column(
        SQLEnum(FlowControlStatus, native_enum=False, length=20),
        nullable=True,
        default=FlowControlStatus.ACTIVE,
        index=True,
        comment="控制状态（预留）"
    )
    
    # 生产互锁配置（预留，未来可与MES对接）
    production_lock_enabled = Column(
        Boolean, 
        nullable=True, 
        default=False, 
        comment="是否启用生产互锁（预留）"
    )
    
    lock_reason = Column(Text, nullable=True, comment="互锁原因（预留）")
    
    # 时间节点（预留）
    start_date = Column(DateTime, nullable=True, comment="开始日期（预留）")
    planned_end_date = Column(DateTime, nullable=True, comment="计划结束日期（预留）")
    actual_end_date = Column(DateTime, nullable=True, comment="实际结束日期（预留）")
    
    # 责任人（预留）
    responsible_person_id = Column(Integer, nullable=True, comment="责任人ID（预留）")
    approver_id = Column(Integer, nullable=True, comment="审批人ID（预留）")
    
    # 备注（预留）
    remarks = Column(Text, nullable=True, comment="备注（预留）")
    
    # 审计字段
    created_at = Column(DateTime, nullable=True, default=datetime.utcnow, comment="创建时间")
    updated_at = Column(DateTime, nullable=True, default=datetime.utcnow, onupdate=datetime.utcnow, comment="更新时间")
    created_by = Column(Integer, nullable=True, comment="创建人ID")
    updated_by = Column(Integer, nullable=True, comment="更新人ID")
    
    # 关系映射（预留）
    project = relationship("NewProductProject", back_populates="initial_flow_controls")
    
    def __repr__(self):
        return f"<InitialFlowControl(id={self.id}, project_id={self.project_id}, material_code='{self.material_code}', status='{self.status}')>"
    
    def to_dict(self) -> dict:
        """转换为字典格式（预留）"""
        return {
            "id": self.id,
            "project_id": self.project_id,
            "material_code": self.material_code,
            "material_name": self.material_name,
            "control_type": self.control_type,
            "control_config": self.control_config,
            "exit_criteria": self.exit_criteria,
            "auto_exit_enabled": self.auto_exit_enabled,
            "exit_evaluation_data": self.exit_evaluation_data,
            "status": self.status,
            "production_lock_enabled": self.production_lock_enabled,
            "lock_reason": self.lock_reason,
            "start_date": self.start_date.isoformat() if self.start_date else None,
            "planned_end_date": self.planned_end_date.isoformat() if self.planned_end_date else None,
            "actual_end_date": self.actual_end_date.isoformat() if self.actual_end_date else None,
            "responsible_person_id": self.responsible_person_id,
            "approver_id": self.approver_id,
            "remarks": self.remarks,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
