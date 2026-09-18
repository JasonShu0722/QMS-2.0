"""
权限数据模型
Permission Model - 细粒度权限控制
"""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, Integer, ForeignKey, Boolean, Enum as SQLEnum, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
import enum

from .base import Base


class OperationType(str, enum.Enum):
    """操作类型枚举"""
    CREATE = "create"  # 录入/新建
    READ = "read"      # 查阅
    UPDATE = "update"  # 修改/编辑
    DELETE = "delete"  # 删除
    EXPORT = "export"  # 导出


class Permission(Base):
    """
    权限模型
    基于"功能模块-操作类型"的二维权限配置
    实现细粒度的权限控制体系
    """
    __tablename__ = "permissions"
    
    # 主键
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    
    # 用户关联
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="用户ID"
    )
    
    # 功能模块路径
    # 例如: "supplier.performance.monthly_score" (供应商 > 绩效考核 > 月度评分)
    # 例如: "quality.incoming.iqc" (质量管理 > 来料检验 > IQC)
    module_path: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        index=True,
        comment="功能模块路径（支持多级：一级.二级.三级）"
    )
    
    # 操作类型
    operation_type: Mapped[str] = mapped_column(
        SQLEnum(OperationType, native_enum=False, length=20),
        nullable=False,
        index=True,
        comment="操作类型"
    )
    
    # 权限授予状态
    is_granted: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
        comment="是否授予权限"
    )
    
    # 审计字段
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, comment="创建时间")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False, comment="更新时间")
    created_by: Mapped[Optional[int]] = mapped_column(Integer, comment="创建人ID")
    
    # 唯一约束：同一用户对同一模块的同一操作只能有一条记录
    __table_args__ = (
        UniqueConstraint('user_id', 'module_path', 'operation_type', name='uq_user_module_operation'),
    )
    
    # 关系映射
    # user: Mapped["User"] = relationship("User", back_populates="permissions")
    
    def __repr__(self) -> str:
        return f"<Permission(id={self.id}, user_id={self.user_id}, module='{self.module_path}', operation='{self.operation_type}', granted={self.is_granted})>"
    
    def to_dict(self) -> dict:
        """转换为字典格式"""
        return {
            "id": self.id,
            "user_id": self.user_id,
            "module_path": self.module_path,
            "operation_type": self.operation_type,
            "is_granted": self.is_granted,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }
    
    @staticmethod
    def build_permission_key(module_path: str, operation_type: str) -> str:
        """
        构建权限键
        用于快速权限检查
        
        Args:
            module_path: 功能模块路径
            operation_type: 操作类型
            
        Returns:
            权限键字符串，格式: "module_path.operation_type"
        """
        return f"{module_path}.{operation_type}"
    
    @property
    def permission_key(self) -> str:
        """获取当前权限的权限键"""
        # operation_type 可能是 OperationType 枚举对象或纯字符串
        # 需要确保提取其 value 值
        op_value = self.operation_type.value if hasattr(self.operation_type, 'value') else str(self.operation_type)
        return self.build_permission_key(self.module_path, op_value)
