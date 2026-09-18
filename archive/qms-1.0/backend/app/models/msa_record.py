"""
MSARecord Model - MSA分析记录模型（预留功能）

用于管理仪器量具的MSA（测量系统分析）记录。
当前为预留功能，所有字段设置为Nullable以兼容双轨环境。
"""
from datetime import datetime
from enum import Enum
from sqlalchemy import Column, Integer, String, Date, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship

from app.models.base import Base


class MSAType(str, Enum):
    """MSA分析类型枚举"""
    GRR = "grr"                      # 重复性与再现性分析
    BIAS = "bias"                    # 偏倚分析
    LINEARITY = "linearity"          # 线性分析
    STABILITY = "stability"          # 稳定性分析
    OTHER = "other"                  # 其他


class MSAResult(str, Enum):
    """MSA分析结果枚举"""
    PASS = "pass"                    # 通过
    FAIL = "fail"                    # 不通过
    CONDITIONAL = "conditional"      # 有条件通过


class MSARecord(Base):
    """
    MSA分析记录模型（预留功能）
    
    记录仪器量具的MSA分析结果和报告。
    所有字段设置为Nullable，确保预览环境新增此表时不影响正式环境。
    
    Requirements: 2.10（预留功能）
    """
    __tablename__ = "msa_records"

    # 主键
    id = Column(Integer, primary_key=True, index=True, comment="MSA记录ID")
    
    # 关联仪器
    instrument_id = Column(
        Integer,
        ForeignKey("instruments.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        comment="关联的仪器ID"
    )
    
    # MSA分析信息
    msa_type = Column(
        String(50),
        nullable=True,
        index=True,
        comment="MSA分析类型: grr/bias/linearity/stability/other"
    )
    msa_date = Column(
        Date,
        nullable=True,
        index=True,
        comment="MSA分析日期"
    )
    msa_result = Column(
        String(20),
        nullable=True,
        index=True,
        comment="MSA分析结果: pass/fail/conditional"
    )
    msa_report_path = Column(
        String(500),
        nullable=True,
        comment="MSA分析报告文件路径"
    )
    
    # 分析详情（可选）
    grr_percentage = Column(
        String(20),
        nullable=True,
        comment="GRR百分比（如适用）"
    )
    remarks = Column(
        Text,
        nullable=True,
        comment="备注说明"
    )
    
    # 审计字段
    created_at = Column(
        DateTime,
        default=datetime.utcnow,
        nullable=True,
        comment="创建时间"
    )
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=True,
        comment="更新时间"
    )
    created_by = Column(
        Integer,
        nullable=True,
        comment="创建人用户ID"
    )
    updated_by = Column(
        Integer,
        nullable=True,
        comment="更新人用户ID"
    )

    def __repr__(self):
        return f"<MSARecord(id={self.id}, instrument_id={self.instrument_id}, type={self.msa_type}, result={self.msa_result})>"

    def to_dict(self):
        """转换为字典格式"""
        return {
            "id": self.id,
            "instrument_id": self.instrument_id,
            "msa_type": self.msa_type,
            "msa_date": self.msa_date.isoformat() if self.msa_date else None,
            "msa_result": self.msa_result,
            "msa_report_path": self.msa_report_path,
            "grr_percentage": self.grr_percentage,
            "remarks": self.remarks,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "created_by": self.created_by,
            "updated_by": self.updated_by,
        }
