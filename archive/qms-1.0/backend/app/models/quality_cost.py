"""
QualityCost Model - 质量成本管理模型（预留功能）

用于记录和分析质量相关的成本数据,包括内部损失、外部损失、鉴定成本和预防成本。
当前为预留功能,所有字段设置为Nullable以兼容双轨环境。
"""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, Date, DateTime, Numeric, JSON

from app.models.base import Base


class QualityCost(Base):
    """
    质量成本管理模型（预留功能）
    
    记录质量相关的各类成本数据，支持按供应商、产品、时间等维度进行分析。
    所有字段设置为Nullable，确保预览环境新增此表时不影响正式环境。
    
    Requirements: 2.11（预留功能）
    """
    __tablename__ = "quality_costs"

    # 主键
    id = Column(Integer, primary_key=True, index=True, comment="成本记录ID")
    
    # 成本分类
    cost_type = Column(
        String(50),
        nullable=True,
        index=True,
        comment="成本类型: internal_failure/external_failure/appraisal/prevention"
    )
    cost_category = Column(
        String(100),
        nullable=True,
        comment="成本细分类别（如：报废、返工、索赔等）"
    )
    
    # 金额信息
    amount = Column(
        Numeric(15, 2),
        nullable=True,
        comment="成本金额"
    )
    currency = Column(
        String(10),
        nullable=True,
        comment="货币单位（默认人民币）"
    )
    
    # 关联业务对象
    related_object_type = Column(
        String(50),
        nullable=True,
        index=True,
        comment="关联业务类型: scar/customer_complaint/scrap/rework等"
    )
    related_object_id = Column(
        Integer,
        nullable=True,
        index=True,
        comment="关联业务对象ID"
    )
    
    # 时间信息
    cost_date = Column(
        Date,
        nullable=True,
        index=True,
        comment="成本发生日期"
    )
    fiscal_year = Column(
        Integer,
        nullable=True,
        index=True,
        comment="财年"
    )
    fiscal_month = Column(
        Integer,
        nullable=True,
        index=True,
        comment="财月"
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
        return f"<QualityCost(id={self.id}, type={self.cost_type}, amount={self.amount}, date={self.cost_date})>"

    def to_dict(self):
        """转换为字典格式"""
        return {
            "id": self.id,
            "cost_type": self.cost_type,
            "cost_category": self.cost_category,
            "amount": float(self.amount) if self.amount else None,
            "currency": self.currency,
            "related_object_type": self.related_object_type,
            "related_object_id": self.related_object_id,
            "cost_date": self.cost_date.isoformat() if self.cost_date else None,
            "fiscal_year": self.fiscal_year,
            "fiscal_month": self.fiscal_month,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class CostAnalysis(Base):
    """
    成本分析模型（预留功能）
    
    用于存储质量成本的分析结果，支持多种分析类型和周期。
    所有字段设置为Nullable，确保预览环境新增此表时不影响正式环境。
    
    Requirements: 2.11（预留功能）
    """
    __tablename__ = "cost_analysis"

    # 主键
    id = Column(Integer, primary_key=True, index=True, comment="分析记录ID")
    
    # 分析类型
    analysis_type = Column(
        String(50),
        nullable=True,
        index=True,
        comment="分析类型: monthly/quarterly/yearly/supplier/product"
    )
    
    # 分析周期
    analysis_period = Column(
        String(50),
        nullable=True,
        index=True,
        comment="分析周期（如：2024-01, 2024-Q1, 2024）"
    )
    
    # 总成本
    total_cost = Column(
        Numeric(15, 2),
        nullable=True,
        comment="总成本金额"
    )
    
    # 分析结果（JSON格式存储详细分析数据）
    analysis_result = Column(
        JSON,
        nullable=True,
        comment="分析结果详情（JSON格式）"
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
        return f"<CostAnalysis(id={self.id}, type={self.analysis_type}, period={self.analysis_period}, total={self.total_cost})>"

    def to_dict(self):
        """转换为字典格式"""
        return {
            "id": self.id,
            "analysis_type": self.analysis_type,
            "analysis_period": self.analysis_period,
            "total_cost": float(self.total_cost) if self.total_cost else None,
            "analysis_result": self.analysis_result,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
