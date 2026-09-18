"""
Customer Claim Model
客户索赔模型 - 记录客户对公司的索赔信息
"""
from sqlalchemy import Column, Integer, String, Numeric, Date, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime

from .base import Base


class CustomerClaim(Base):
    """
    客户索赔模型
    记录客户因质量问题向公司提出的索赔要求
    """
    __tablename__ = "customer_claims"

    id = Column(Integer, primary_key=True, index=True)
    complaint_id = Column(Integer, ForeignKey("customer_complaints.id"), nullable=False, index=True, comment="关联的客诉单ID")
    
    # 索赔信息
    claim_amount = Column(Numeric(15, 2), nullable=False, comment="索赔金额")
    claim_currency = Column(String(10), nullable=False, default="CNY", comment="币种（CNY/USD/EUR等）")
    claim_date = Column(Date, nullable=False, comment="索赔日期")
    customer_name = Column(String(200), nullable=False, comment="客户名称")
    
    # 索赔详情
    claim_description = Column(String(500), nullable=True, comment="索赔说明")
    claim_reference = Column(String(100), nullable=True, comment="客户索赔单号")
    
    # 审计字段
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, comment="创建时间")
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow, comment="更新时间")
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True, comment="创建人ID")
    
    # 关系
    complaint = relationship("CustomerComplaint", back_populates="customer_claims")
    creator = relationship("User", foreign_keys=[created_by], backref="created_customer_claims")
    
    def __repr__(self):
        return f"<CustomerClaim(id={self.id}, complaint_id={self.complaint_id}, amount={self.claim_amount})>"
