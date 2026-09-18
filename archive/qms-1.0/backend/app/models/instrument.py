"""
Instrument Model - 仪器量具管理模型（预留功能）

用于管理仪器量具的基本信息和校准状态。
当前为预留功能，所有字段设置为Nullable以兼容双轨环境。
"""
from datetime import datetime
from enum import Enum
from sqlalchemy import Column, Integer, String, Date, DateTime
from sqlalchemy.orm import relationship

from app.models.base import Base


class InstrumentType(str, Enum):
    """仪器类型枚举"""
    MEASURING = "measuring"          # 测量仪器
    TESTING = "testing"              # 测试设备
    CALIBRATION = "calibration"      # 校准设备
    INSPECTION = "inspection"        # 检验工具
    OTHER = "other"                  # 其他


class InstrumentStatus(str, Enum):
    """仪器状态枚举"""
    ACTIVE = "active"        # 在用
    EXPIRED = "expired"      # 已过期
    FROZEN = "frozen"        # 已冻结
    RETIRED = "retired"      # 已报废


class Instrument(Base):
    """
    仪器量具管理模型（预留功能）
    
    记录仪器量具的基本信息、校准状态和有效期。
    所有字段设置为Nullable，确保预览环境新增此表时不影响正式环境。
    
    Requirements: 2.10（预留功能）
    """
    __tablename__ = "instruments"

    # 主键
    id = Column(Integer, primary_key=True, index=True, comment="仪器ID")
    
    # 仪器基本信息
    instrument_code = Column(
        String(100),
        nullable=True,
        index=True,
        unique=True,
        comment="仪器编码（唯一标识）"
    )
    instrument_name = Column(
        String(255),
        nullable=True,
        comment="仪器名称"
    )
    instrument_type = Column(
        String(50),
        nullable=True,
        index=True,
        comment="仪器类型: measuring/testing/calibration/inspection/other"
    )
    
    # 校准信息
    calibration_date = Column(
        Date,
        nullable=True,
        comment="最近校准日期"
    )
    next_calibration_date = Column(
        Date,
        nullable=True,
        index=True,
        comment="下次校准日期"
    )
    calibration_cert_path = Column(
        String(500),
        nullable=True,
        comment="校准证书文件路径"
    )
    
    # 状态
    status = Column(
        String(20),
        nullable=True,
        index=True,
        default="active",
        comment="仪器状态: active/expired/frozen/retired"
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
        return f"<Instrument(id={self.id}, code={self.instrument_code}, name={self.instrument_name})>"

    def to_dict(self):
        """转换为字典格式"""
        return {
            "id": self.id,
            "instrument_code": self.instrument_code,
            "instrument_name": self.instrument_name,
            "instrument_type": self.instrument_type,
            "calibration_date": self.calibration_date.isoformat() if self.calibration_date else None,
            "next_calibration_date": self.next_calibration_date.isoformat() if self.next_calibration_date else None,
            "calibration_cert_path": self.calibration_cert_path,
            "status": self.status,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "created_by": self.created_by,
            "updated_by": self.updated_by,
        }
