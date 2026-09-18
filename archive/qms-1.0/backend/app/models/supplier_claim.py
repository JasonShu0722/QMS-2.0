"""
Supplier Claim Model
供应商索赔模型 - 记录公司对供应商的索赔信息
"""
from sqlalchemy import Column, Integer, String, Numeric, Date, DateTime, Enum as SQLEnum, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
import enum

from .base import Base


class SupplierClaimStatus(str, enum.Enum):
    """供应商索赔状态枚举"""
    DRAFT = "draft"  # 草稿
    SUBMITTED = "submitted"  # 已提交
    UNDER_NEGOTIATION = "under_negotiation"  # 协商中
    ACCEPTED = "accepted"  # 供应商已接受
    REJECTED = "rejected"  # 供应商拒绝
    PARTIALLY_ACCEPTED = "partially_accepted"  # 部分接受
    PAID = "paid"  # 已支付
    CLOSED = "closed"  # 已关闭


class SupplierClaim(Base):
    """
    供应商索赔模型
    记录公司因供应商质量问题向供应商提出的索赔要求
    支持从客诉单一键转嫁生成
    """
    __tablename__ = "supplier_claims"

    id = Column(Integer, primary_key=True, index=True)
    complaint_id = Column(Integer, ForeignKey("customer_complaints.id"), nullable=True, index=True, comment="关联的客诉单ID（可选）")
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=False, index=True, comment="供应商ID")
    
    # 索赔信息
    claim_amount = Column(Numeric(15, 2), nullable=False, comment="索赔金额")
    claim_currency = Column(String(10), nullable=False, default="CNY", comment="币种（CNY/USD/EUR等）")
    claim_date = Column(Date, nullable=False, comment="索赔日期")
    
    # 索赔详情
    claim_description = Column(String(500), nullable=True, comment="索赔说明")
    material_code = Column(String(50), nullable=True, comment="涉及物料编码")
    defect_qty = Column(Integer, nullable=True, comment="不良数量")
    
    # 流程控制
    status = Column(SQLEnum(SupplierClaimStatus), nullable=False, default=SupplierClaimStatus.DRAFT, comment="索赔状态")
    negotiation_notes = Column(String(1000), nullable=True, comment="协商记录")
    final_amount = Column(Numeric(15, 2), nullable=True, comment="最终索赔金额（协商后）")
    payment_date = Column(Date, nullable=True, comment="实际支付日期")
    
    # 审计字段
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, comment="创建时间")
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow, comment="更新时间")
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True, comment="创建人ID")
    
    # 关系
    complaint = relationship("CustomerComplaint", back_populates="supplier_claims")
    supplier = relationship("Supplier", backref="supplier_claims")
    creator = relationship("User", foreign_keys=[created_by], backref="created_supplier_claims")
    
    def __repr__(self):
        return f"<SupplierClaim(id={self.id}, supplier_id={self.supplier_id}, amount={self.claim_amount}, status={self.status})>"
