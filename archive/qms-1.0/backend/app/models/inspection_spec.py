"""
物料检验规范数据模型
Inspection Specification - 物料检验规范及定期报告管理
"""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, Enum as SQLEnum, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
import enum

from .base import Base


class InspectionSpecStatus(str, enum.Enum):
    """检验规范状态枚举"""
    DRAFT = "draft"              # 草稿
    PENDING_REVIEW = "pending_review"  # 待审核
    APPROVED = "approved"        # 已批准
    ARCHIVED = "archived"        # 已归档（旧版本）


class InspectionSpec(Base):
    """
    物料检验规范模型
    用于记录物料的检验标准、关键特性和版本管理
    """
    __tablename__ = "inspection_specs"
    
    # 主键
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    
    # 物料信息
    material_code: Mapped[str] = mapped_column(String(100), nullable=False, index=True, comment="物料编码")
    
    # 供应商信息
    supplier_id: Mapped[int] = mapped_column(ForeignKey("suppliers.id"), nullable=False, index=True, comment="供应商ID")
    
    # 版本号（格式：V1.0, V1.1, V2.0...）
    version: Mapped[str] = mapped_column(String(20), nullable=False, comment="版本号")
    
    # SIP 文件路径（双方签字版 PDF）
    sip_file_path: Mapped[Optional[str]] = mapped_column(String(500), comment="SIP 文件路径")
    
    # 关键检验项目（JSON 格式存储）
    # 包含：检验项目名称、规格要求、检验方法、抽样方案等
    # 示例：[{"item": "外观", "spec": "无划伤", "method": "目视", "sample_size": 5}, ...]
    key_characteristics: Mapped[Optional[dict]] = mapped_column(JSON, comment="关键检验项目")
    
    # 报告频率策略
    report_frequency_type: Mapped[Optional[str]] = mapped_column(String(20), comment="报告频率类型（batch/weekly/monthly/quarterly）")
    
    # 状态
    status: Mapped[str] = mapped_column(
        SQLEnum(InspectionSpecStatus, native_enum=False, length=20),
        default=InspectionSpecStatus.DRAFT,
        nullable=False,
        index=True,
        comment="状态"
    )
    
    # 审核信息
    reviewer_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), comment="审核人ID（SQE）")
    review_comments: Mapped[Optional[str]] = mapped_column(String(1000), comment="审核意见")
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, comment="批准时间")
    
    # 生效日期
    effective_date: Mapped[Optional[datetime]] = mapped_column(DateTime, index=True, comment="生效日期")
    
    # 审计字段
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, comment="创建时间")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False, comment="更新时间")
    created_by: Mapped[Optional[int]] = mapped_column(comment="创建人ID（SQE）")
    updated_by: Mapped[Optional[int]] = mapped_column(comment="更新人ID")
    
    # 关系映射
    # supplier: Mapped["Supplier"] = relationship("Supplier", back_populates="inspection_specs")
    # reviewer: Mapped["User"] = relationship("User", foreign_keys=[reviewer_id])
    
    def __repr__(self) -> str:
        return f"<InspectionSpec(id={self.id}, material_code='{self.material_code}', version='{self.version}', status='{self.status}')>"
    
    def to_dict(self) -> dict:
        """转换为字典格式"""
        return {
            "id": self.id,
            "material_code": self.material_code,
            "supplier_id": self.supplier_id,
            "version": self.version,
            "sip_file_path": self.sip_file_path,
            "key_characteristics": self.key_characteristics,
            "report_frequency_type": self.report_frequency_type,
            "status": self.status,
            "reviewer_id": self.reviewer_id,
            "review_comments": self.review_comments,
            "approved_at": self.approved_at.isoformat() if self.approved_at else None,
            "effective_date": self.effective_date.isoformat() if self.effective_date else None,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }
