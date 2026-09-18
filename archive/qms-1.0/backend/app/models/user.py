"""
用户数据模型
User Model - 用户基础信息、认证与权限管理
"""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, Integer, ForeignKey, Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
import enum

from .base import Base


class UserType(str, enum.Enum):
    """用户类型枚举"""
    INTERNAL = "internal"  # 内部员工
    SUPPLIER = "supplier"  # 供应商用户


class UserStatus(str, enum.Enum):
    """用户状态枚举"""
    PENDING = "pending"    # 待审核
    ACTIVE = "active"      # 已激活
    FROZEN = "frozen"      # 已冻结
    REJECTED = "rejected"  # 已驳回


class User(Base):
    """
    用户模型
    支持内部员工和外部供应商的统一认证与权限管理
    """
    __tablename__ = "users"
    
    # 主键
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    
    # 基础认证信息
    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True, comment="用户名")
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False, comment="密码哈希")
    
    # 个人信息
    full_name: Mapped[str] = mapped_column(String(100), nullable=False, comment="姓名")
    email: Mapped[str] = mapped_column(String(100), nullable=False, comment="邮箱")
    phone: Mapped[Optional[str]] = mapped_column(String(20), comment="电话")
    
    # 用户类型
    user_type: Mapped[str] = mapped_column(
        SQLEnum(UserType, native_enum=False, length=20),
        nullable=False,
        index=True,
        comment="用户类型"
    )
    
    # 账号状态
    status: Mapped[str] = mapped_column(
        SQLEnum(UserStatus, native_enum=False, length=20),
        default=UserStatus.PENDING,
        nullable=False,
        index=True,
        comment="账号状态"
    )
    
    # 内部员工专属字段
    department: Mapped[Optional[str]] = mapped_column(String(100), comment="部门")
    position: Mapped[Optional[str]] = mapped_column(String(100), comment="职位")
    
    # 供应商用户专属字段
    supplier_id: Mapped[Optional[int]] = mapped_column(
        Integer,
        ForeignKey("suppliers.id", ondelete="SET NULL"),
        index=True,
        comment="关联供应商ID"
    )
    
    # 头像
    avatar_image_path: Mapped[Optional[str]] = mapped_column(String(255), comment="头像图片路径")
    
    # 环境权限：可选值 "stable"、"preview"、"stable,preview"
    allowed_environments: Mapped[str] = mapped_column(String(50), nullable=False, default="stable", comment="允许访问的环境，逗号分隔")
    
    # 电子签名
    digital_signature: Mapped[Optional[str]] = mapped_column(String(255), comment="电子签名图片路径")
    
    # 安全字段
    failed_login_attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False, comment="连续登录失败次数")
    locked_until: Mapped[Optional[datetime]] = mapped_column(DateTime, comment="账号锁定截止时间")
    password_changed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, comment="密码最后修改时间")
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime, comment="最后登录时间")
    
    # 审计字段
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, comment="创建时间")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False, comment="更新时间")
    created_by: Mapped[Optional[int]] = mapped_column(Integer, comment="创建人ID")
    updated_by: Mapped[Optional[int]] = mapped_column(Integer, comment="更新人ID")
    
    # 关系映射
    # supplier: Mapped[Optional["Supplier"]] = relationship("Supplier", back_populates="users")
    # permissions: Mapped[list["Permission"]] = relationship("Permission", back_populates="user", cascade="all, delete-orphan")
    role_assignments: Mapped[list["UserRoleAssignment"]] = relationship(
        "UserRoleAssignment",
        back_populates="user",
        cascade="all, delete-orphan"
    )
    operation_logs: Mapped[list["OperationLog"]] = relationship("OperationLog", back_populates="user")
    notifications: Mapped[list["Notification"]] = relationship("Notification", back_populates="user", cascade="all, delete-orphan")
    
    def __repr__(self) -> str:
        return f"<User(id={self.id}, username='{self.username}', user_type='{self.user_type}', status='{self.status}')>"
    
    def to_dict(self) -> dict:
        """转换为字典格式（不包含敏感信息）"""
        return {
            "id": self.id,
            "username": self.username,
            "full_name": self.full_name,
            "email": self.email,
            "phone": self.phone,
            "user_type": self.user_type,
            "status": self.status,
            "department": self.department,
            "position": self.position,
            "supplier_id": self.supplier_id,
            "avatar_image_path": self.avatar_image_path,
            "digital_signature": self.digital_signature,
            "last_login_at": self.last_login_at.isoformat() if self.last_login_at else None,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }
    
    def is_account_locked(self) -> bool:
        """检查账号是否被锁定"""
        if self.locked_until is None:
            return False
        return datetime.utcnow() < self.locked_until
    
    def is_password_expired(self, expire_days: int = 90) -> bool:
        """检查密码是否过期"""
        if self.password_changed_at is None:
            return True  # 首次登录，强制修改密码
        
        from datetime import timedelta
        expiry_date = self.password_changed_at + timedelta(days=expire_days)
        return datetime.utcnow() > expiry_date
