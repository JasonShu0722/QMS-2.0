"""
质量指标数据模型
QualityMetric Model - 质量数据面板核心指标存储
"""
from datetime import date, datetime
from typing import Optional
from sqlalchemy import String, DateTime, Integer, Date, Numeric, ForeignKey, Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column
import enum

from .base import Base


class MetricType(str, enum.Enum):
    """指标类型枚举"""
    INCOMING_BATCH_PASS_RATE = "incoming_batch_pass_rate"  # 来料批次合格率
    MATERIAL_ONLINE_PPM = "material_online_ppm"  # 物料上线不良PPM
    PROCESS_DEFECT_RATE = "process_defect_rate"  # 制程不合格率
    PROCESS_FPY = "process_fpy"  # 制程直通率 (First Pass Yield)
    OKM_PPM = "okm_ppm"  # 0KM不良PPM
    MIS_3_PPM = "mis_3_ppm"  # 3MIS售后不良PPM (滚动3个月)
    MIS_12_PPM = "mis_12_ppm"  # 12MIS售后不良PPM (滚动12个月)


class QualityMetric(Base):
    """
    质量指标模型
    存储各类质量指标的计算结果，支持多维度统计分析
    """
    __tablename__ = "quality_metrics"
    
    # 主键
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    
    # 指标类型
    metric_type: Mapped[str] = mapped_column(
        SQLEnum(MetricType, native_enum=False, length=50),
        nullable=False,
        index=True,
        comment="指标类型"
    )
    
    # 时间维度
    metric_date: Mapped[date] = mapped_column(
        Date,
        nullable=False,
        index=True,
        comment="指标日期"
    )
    
    # 指标值
    value: Mapped[float] = mapped_column(
        Numeric(15, 4),
        nullable=False,
        comment="指标实际值"
    )
    
    # 目标值
    target_value: Mapped[Optional[float]] = mapped_column(
        Numeric(15, 4),
        comment="指标目标值"
    )
    
    # 分类维度 - 产品类型
    product_type: Mapped[Optional[str]] = mapped_column(
        String(100),
        index=True,
        comment="产品类型"
    )
    
    # 分类维度 - 供应商
    supplier_id: Mapped[Optional[int]] = mapped_column(
        Integer,
        ForeignKey("suppliers.id", ondelete="SET NULL"),
        index=True,
        comment="关联供应商ID"
    )
    
    # 分类维度 - 产线
    line_id: Mapped[Optional[str]] = mapped_column(
        String(50),
        index=True,
        comment="产线ID"
    )
    
    # 分类维度 - 工序
    process_id: Mapped[Optional[str]] = mapped_column(
        String(50),
        index=True,
        comment="工序ID"
    )
    
    # 审计字段
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
        comment="创建时间"
    )
    
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
        comment="更新时间"
    )
    
    def __repr__(self) -> str:
        return (
            f"<QualityMetric(id={self.id}, "
            f"metric_type='{self.metric_type}', "
            f"metric_date='{self.metric_date}', "
            f"value={self.value})>"
        )
    
    def to_dict(self) -> dict:
        """转换为字典格式"""
        return {
            "id": self.id,
            "metric_type": self.metric_type,
            "metric_date": self.metric_date.isoformat(),
            "value": float(self.value),
            "target_value": float(self.target_value) if self.target_value else None,
            "product_type": self.product_type,
            "supplier_id": self.supplier_id,
            "line_id": self.line_id,
            "process_id": self.process_id,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }
    
    def is_target_met(self) -> Optional[bool]:
        """
        判断指标是否达标
        Returns:
            True: 达标
            False: 未达标
            None: 无目标值
        """
        if self.target_value is None:
            return None
        
        # 对于PPM和不合格率类指标，值越小越好
        if self.metric_type in [
            MetricType.MATERIAL_ONLINE_PPM,
            MetricType.PROCESS_DEFECT_RATE,
            MetricType.OKM_PPM,
            MetricType.MIS_3_PPM,
            MetricType.MIS_12_PPM,
        ]:
            return self.value <= self.target_value
        
        # 对于合格率和直通率类指标，值越大越好
        if self.metric_type in [
            MetricType.INCOMING_BATCH_PASS_RATE,
            MetricType.PROCESS_FPY,
        ]:
            return self.value >= self.target_value
        
        return None
