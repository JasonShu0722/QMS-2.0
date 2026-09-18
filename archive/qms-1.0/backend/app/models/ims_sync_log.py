"""
IMS同步日志数据模型
IMSSyncLog Model - 记录与IMS系统的数据同步状态
"""
from datetime import date, datetime
from typing import Optional
from sqlalchemy import String, DateTime, Integer, Date, Text, Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column
import enum

from .base import Base


class SyncStatus(str, enum.Enum):
    """同步状态枚举"""
    SUCCESS = "success"  # 同步成功
    FAILED = "failed"  # 同步失败
    PARTIAL = "partial"  # 部分成功
    IN_PROGRESS = "in_progress"  # 同步中


class SyncType(str, enum.Enum):
    """同步类型枚举"""
    INCOMING_INSPECTION = "incoming_inspection"  # 入库检验数据
    PRODUCTION_OUTPUT = "production_output"  # 成品产出数据
    PROCESS_TEST = "process_test"  # 制程测试数据
    PROCESS_DEFECTS = "process_defects"  # 制程不良记录
    SHIPMENT_DATA = "shipment_data"  # 发货数据
    FIRST_PASS_TEST = "first_pass_test"  # 一次测试数据
    IQC_RESULTS = "iqc_results"  # IQC检验结果
    SPECIAL_APPROVAL = "special_approval"  # 特采记录


class IMSSyncLog(Base):
    """
    IMS同步日志模型
    记录每次与IMS系统的数据同步操作，用于监控集成健康度和问题追溯
    """
    __tablename__ = "ims_sync_logs"
    
    # 主键
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    
    # 同步类型
    sync_type: Mapped[str] = mapped_column(
        SQLEnum(SyncType, native_enum=False, length=50),
        nullable=False,
        index=True,
        comment="同步类型"
    )
    
    # 同步日期
    sync_date: Mapped[date] = mapped_column(
        Date,
        nullable=False,
        index=True,
        comment="同步日期"
    )
    
    # 同步状态
    status: Mapped[str] = mapped_column(
        SQLEnum(SyncStatus, native_enum=False, length=20),
        nullable=False,
        index=True,
        comment="同步状态"
    )
    
    # 同步记录数
    records_count: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
        comment="同步记录数量"
    )
    
    # 错误信息
    error_message: Mapped[Optional[str]] = mapped_column(
        Text,
        comment="错误信息详情"
    )
    
    # 同步开始时间
    started_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        comment="同步开始时间"
    )
    
    # 同步结束时间
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime,
        comment="同步结束时间"
    )
    
    # 审计字段
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
        comment="创建时间"
    )
    
    def __repr__(self) -> str:
        return (
            f"<IMSSyncLog(id={self.id}, "
            f"sync_type='{self.sync_type}', "
            f"sync_date='{self.sync_date}', "
            f"status='{self.status}', "
            f"records_count={self.records_count})>"
        )
    
    def to_dict(self) -> dict:
        """转换为字典格式"""
        return {
            "id": self.id,
            "sync_type": self.sync_type,
            "sync_date": self.sync_date.isoformat(),
            "status": self.status,
            "records_count": self.records_count,
            "error_message": self.error_message,
            "started_at": self.started_at.isoformat(),
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "created_at": self.created_at.isoformat(),
        }
    
    def get_duration_seconds(self) -> Optional[float]:
        """
        获取同步耗时（秒）
        Returns:
            同步耗时秒数，如果未完成则返回None
        """
        if self.completed_at is None:
            return None
        
        duration = self.completed_at - self.started_at
        return duration.total_seconds()
    
    def is_successful(self) -> bool:
        """判断同步是否成功"""
        return self.status == SyncStatus.SUCCESS
    
    def is_failed(self) -> bool:
        """判断同步是否失败"""
        return self.status == SyncStatus.FAILED
