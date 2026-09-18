"""
Shipment Data Model
发货数据模型 - 维护过去24个月的分月出货数据
"""
from sqlalchemy import Column, Integer, String, Date, DateTime, Index
from datetime import datetime

from .base import Base


class ShipmentData(Base):
    """
    发货数据模型
    用途：
    - 计算 0KM 不良 PPM (2.4.1)
    - 计算 3MIS 售后不良 PPM（滚动3个月）(2.4.1)
    - 计算 12MIS 售后不良 PPM（滚动12个月）(2.4.1)
    
    维护策略：
    - 保留过去 24 个月的分月出货数据
    - 每日从 IMS/ERP/SAP 同步发货记录
    - 按客户代码、产品类型、出货日期进行分类统计
    """
    __tablename__ = "shipment_data"

    id = Column(Integer, primary_key=True, index=True)
    
    # 核心字段
    customer_code = Column(String(50), nullable=False, index=True, comment="客户代码")
    product_type = Column(String(100), nullable=False, index=True, comment="产品类型")
    shipment_date = Column(Date, nullable=False, index=True, comment="出货日期")
    shipment_qty = Column(Integer, nullable=False, default=0, comment="出货数量")
    
    # 可选字段（用于追溯和分析）
    work_order = Column(String(50), nullable=True, comment="工单号")
    batch_number = Column(String(50), nullable=True, comment="批次号")
    destination = Column(String(200), nullable=True, comment="目的地")
    
    # 审计字段
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, comment="创建时间")
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow, comment="更新时间")
    
    # 复合索引：优化按客户、产品、日期范围查询
    __table_args__ = (
        Index('idx_shipment_customer_product_date', 'customer_code', 'product_type', 'shipment_date'),
        Index('idx_shipment_date_range', 'shipment_date'),
    )
    
    def __repr__(self):
        return (
            f"<ShipmentData(id={self.id}, "
            f"customer={self.customer_code}, "
            f"product={self.product_type}, "
            f"date={self.shipment_date}, "
            f"qty={self.shipment_qty})>"
        )
    
    def to_dict(self):
        """转换为字典格式"""
        return {
            "id": self.id,
            "customer_code": self.customer_code,
            "product_type": self.product_type,
            "shipment_date": self.shipment_date.isoformat(),
            "shipment_qty": self.shipment_qty,
            "work_order": self.work_order,
            "batch_number": self.batch_number,
            "destination": self.destination,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }
