"""
InstrumentCalibration Model - 仪器校准管理模型（预留功能）

用于管理仪器量具的校准记录和MSA分析报告。
当前为预留功能,所有字段设置为Nullable以兼容双轨环境。
"""
from datetime import datetime, date
from enum import Enum
from sqlalchemy import Column, Integer, String, Date, DateTime

from app.models.base import Base


class CalibrationStatus(str, Enum):
    """校准状态枚举"""
    VALID = "valid"      # 有效
    EXPIRED = "expired"  # 已过期
    FROZEN = "frozen"    # 已冻结


class InstrumentCalibration(Base):
    """
    仪器校准管理模型（预留功能）
    
    记录仪器量具的校准信息、有效期和MSA分析报告。
    所有字段设置为Nullable，确保预览环境新增此表时不影响正式环境。
    """
    __tablename__ = "instrument_calibrations"

    # 主键
    id = Column(Integer, primary_key=True, index=True, comment="记录ID")
    
    # 仪器基本信息
    instrument_code = Column(
        String(100),
        nullable=True,
        index=True,
        comment="仪器编码"
    )
    instrument_name = Column(
        String(255),
        nullable=True,
        comment="仪器名称"
    )
    
    # 校准信息
    calibration_date = Column(
        Date,
        nullable=True,
        comment="校准日期"
    )
    next_calibration_date = Column(
        Date,
        nullable=True,
        index=True,
        comment="下次校准日期"
    )
    calibration_status = Column(
        String(20),
        nullable=True,
        index=True,
        comment="校准状态: valid/expired/frozen"
    )
    calibration_certificate_path = Column(
        String(500),
        nullable=True,
        comment="校准证书文件路径"
    )
    
    # 责任人
    responsible_user_id = Column(
        Integer,
        nullable=True,
        comment="责任人用户ID"
    )
    
    # MSA分析报告
    msa_report_path = Column(
        String(500),
        nullable=True,
        comment="MSA分析报告文件路径"
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

    def __repr__(self):
        return f"<InstrumentCalibration(id={self.id}, code={self.instrument_code}, status={self.calibration_status})>"

    def to_dict(self):
        """转换为字典格式"""
        return {
            "id": self.id,
            "instrument_code": self.instrument_code,
            "instrument_name": self.instrument_name,
            "calibration_date": self.calibration_date.isoformat() if self.calibration_date else None,
            "next_calibration_date": self.next_calibration_date.isoformat() if self.next_calibration_date else None,
            "calibration_status": self.calibration_status,
            "calibration_certificate_path": self.calibration_certificate_path,
            "responsible_user_id": self.responsible_user_id,
            "msa_report_path": self.msa_report_path,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
