"""
条码校验数据模型
Barcode Validation - 关键件防错与追溯扫描
"""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Integer, Boolean, DateTime, ForeignKey, JSON, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class BarcodeValidation(Base):
    """
    条码校验模型
    用于配置物料的条码校验规则和记录扫码验证结果
    """
    __tablename__ = "barcode_validations"
    
    # 主键
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    
    # 物料信息
    material_code: Mapped[str] = mapped_column(String(100), nullable=False, index=True, comment="物料编码")
    
    # 校验规则（JSON 格式存储）
    # 包含：固定前缀、固定后缀、长度限制等
    # 示例：{"prefix": "A", "suffix": "XYZ", "min_length": 10, "max_length": 20}
    validation_rules: Mapped[Optional[dict]] = mapped_column(JSON, comment="校验规则")
    
    # 正则表达式（用于格式校验）
    regex_pattern: Mapped[Optional[str]] = mapped_column(String(200), comment="正则表达式")
    
    # 是否启用唯一性校验（防重逻辑）
    is_unique_check: Mapped[bool] = mapped_column(default=False, nullable=False, comment="是否启用唯一性校验")
    
    # 审计字段
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, comment="创建时间")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False, comment="更新时间")
    created_by: Mapped[Optional[int]] = mapped_column(comment="创建人ID（SQE）")
    updated_by: Mapped[Optional[int]] = mapped_column(comment="更新人ID")
    
    def __repr__(self) -> str:
        return f"<BarcodeValidation(id={self.id}, material_code='{self.material_code}')>"
    
    def to_dict(self) -> dict:
        """转换为字典格式"""
        return {
            "id": self.id,
            "material_code": self.material_code,
            "validation_rules": self.validation_rules,
            "regex_pattern": self.regex_pattern,
            "is_unique_check": self.is_unique_check,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }


class BarcodeScanRecord(Base):
    """
    条码扫描记录模型
    用于记录每次扫码验证的结果和追溯信息
    """
    __tablename__ = "barcode_scan_records"
    
    # 主键
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    
    # 物料信息
    material_code: Mapped[str] = mapped_column(String(100), nullable=False, index=True, comment="物料编码")
    
    # 供应商信息
    supplier_id: Mapped[int] = mapped_column(ForeignKey("suppliers.id"), nullable=False, index=True, comment="供应商ID")
    
    # 批次号
    batch_number: Mapped[Optional[str]] = mapped_column(String(100), index=True, comment="批次号")
    
    # 条码内容
    barcode_content: Mapped[str] = mapped_column(String(200), nullable=False, index=True, comment="条码内容")
    
    # 判定结果
    is_pass: Mapped[bool] = mapped_column(nullable=False, index=True, comment="是否通过")
    
    # 错误原因（NG时记录）
    error_reason: Mapped[Optional[str]] = mapped_column(String(500), comment="错误原因")
    
    # 扫描信息
    scanned_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, comment="扫描人ID")
    scanned_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True, comment="扫描时间")
    
    # 设备信息
    device_ip: Mapped[Optional[str]] = mapped_column(String(50), comment="设备IP")
    
    # 是否已归档
    is_archived: Mapped[bool] = mapped_column(default=False, nullable=False, index=True, comment="是否已归档")
    archived_at: Mapped[Optional[datetime]] = mapped_column(DateTime, comment="归档时间")
    
    # 关系映射
    # supplier: Mapped["Supplier"] = relationship("Supplier")
    # scanner: Mapped["User"] = relationship("User", foreign_keys=[scanned_by])
    
    def __repr__(self) -> str:
        return f"<BarcodeScanRecord(id={self.id}, material_code='{self.material_code}', is_pass={self.is_pass})>"
    
    def to_dict(self) -> dict:
        """转换为字典格式"""
        return {
            "id": self.id,
            "material_code": self.material_code,
            "supplier_id": self.supplier_id,
            "batch_number": self.batch_number,
            "barcode_content": self.barcode_content,
            "is_pass": self.is_pass,
            "error_reason": self.error_reason,
            "scanned_by": self.scanned_by,
            "scanned_at": self.scanned_at.isoformat(),
            "device_ip": self.device_ip,
            "is_archived": self.is_archived,
            "archived_at": self.archived_at.isoformat() if self.archived_at else None,
        }
