"""
权限相关的 Pydantic 数据校验模型
Permission Schemas - 用于 API 请求/响应的数据验证
"""
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field, validator
from datetime import datetime

from app.models.permission import OperationType
from app.schemas.role_tag import RoleTagSummarySchema


class PermissionBase(BaseModel):
    """权限基础模型"""
    module_path: str = Field(..., description="功能模块路径", example="supplier.performance.monthly_score")
    operation_type: OperationType = Field(..., description="操作类型")
    is_granted: bool = Field(True, description="是否授予权限")


class PermissionCreate(PermissionBase):
    """创建权限请求模型"""
    user_id: int = Field(..., description="用户ID")


class PermissionUpdate(BaseModel):
    """更新权限请求模型"""
    is_granted: bool = Field(..., description="是否授予权限")


class PermissionResponse(PermissionBase):
    """权限响应模型"""
    id: int
    user_id: int
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class PermissionGrantRequest(BaseModel):
    """批量授予权限请求模型"""
    user_ids: List[int] = Field(..., description="用户ID列表", min_items=1)
    permissions: List[Dict[str, str]] = Field(
        ..., 
        description="权限列表，每个权限包含 module_path 和 operation_type",
        example=[
            {"module_path": "supplier.performance", "operation_type": "read"},
            {"module_path": "supplier.performance", "operation_type": "create"}
        ]
    )
    
    @validator('permissions')
    def validate_permissions(cls, v):
        """验证权限列表格式"""
        for perm in v:
            if 'module_path' not in perm or 'operation_type' not in perm:
                raise ValueError("每个权限必须包含 module_path 和 operation_type")
            # 验证 operation_type 是否有效
            if perm['operation_type'] not in [op.value for op in OperationType]:
                raise ValueError(f"无效的操作类型: {perm['operation_type']}")
        return v


class PermissionRevokeRequest(BaseModel):
    """批量撤销权限请求模型"""
    user_ids: List[int] = Field(..., description="用户ID列表", min_items=1)
    permissions: List[Dict[str, str]] = Field(
        ..., 
        description="权限列表，每个权限包含 module_path 和 operation_type"
    )
    
    @validator('permissions')
    def validate_permissions(cls, v):
        """验证权限列表格式"""
        for perm in v:
            if 'module_path' not in perm or 'operation_type' not in perm:
                raise ValueError("每个权限必须包含 module_path 和 operation_type")
            # 验证 operation_type 是否有效
            if perm['operation_type'] not in [op.value for op in OperationType]:
                raise ValueError(f"无效的操作类型: {perm['operation_type']}")
        return v


class UserPermissionSummary(BaseModel):
    """用户权限摘要（用于权限矩阵）"""
    user_id: int
    username: str
    full_name: str
    user_type: str
    department: Optional[str] = None
    position: Optional[str] = None
    permissions: Dict[str, Dict[str, bool]] = Field(
        default_factory=dict,
        description="权限树，格式: {module_path: {operation: is_granted}}"
    )


class PermissionMatrixModule(BaseModel):
    """权限矩阵列定义"""
    module_path: str
    module_name: str
    group_key: str | None = None
    group_name: str | None = None
    operations: List[str]


class PermissionMatrixRow(BaseModel):
    """权限矩阵行定义"""
    role: RoleTagSummarySchema
    permissions: Dict[str, bool]


class PermissionMatrixResponse(BaseModel):
    """权限矩阵响应模型"""
    modules: List[PermissionMatrixModule] = Field(..., description="矩阵列定义")
    rows: List[PermissionMatrixRow] = Field(..., description="矩阵行数据")
    
    class Config:
        json_schema_extra = {
            "example": {
                "rows": [
                    {
                        "role": {
                            "id": 1,
                            "role_key": "quality.process.engineer",
                            "role_name": "制程质量工程师",
                            "applicable_user_type": "internal",
                            "is_active": True,
                            "assigned_user_count": 12
                        },
                        "permissions": {
                            "supplier.performance": {
                                "read": True,
                                "create": False,
                                "update": True,
                                "delete": False,
                                "export": True
                            }
                        }
                    }
                ],
                "modules": [
                    {
                        "module_path": "supplier.performance",
                        "module_name": "供应商绩效",
                        "operations": ["create", "read", "update", "delete", "export"]
                    }
                ]
            }
        }


class UserPermissionDetailResponse(BaseModel):
    """用户权限详情响应模型"""
    user_id: int
    username: str
    full_name: str
    user_type: str
    permissions: List[PermissionResponse] = Field(..., description="用户的所有权限记录")
    permission_tree: Dict[str, Dict[str, bool]] = Field(
        ..., 
        description="结构化的权限树"
    )
    
    class Config:
        json_schema_extra = {
            "example": {
                "user_id": 1,
                "username": "john_doe",
                "full_name": "John Doe",
                "user_type": "internal",
                "permissions": [
                    {
                        "id": 1,
                        "user_id": 1,
                        "module_path": "supplier.performance",
                        "operation_type": "read",
                        "is_granted": True,
                        "created_at": "2024-01-01T00:00:00",
                        "updated_at": "2024-01-01T00:00:00"
                    }
                ],
                "permission_tree": {
                    "supplier.performance": {
                        "read": True,
                        "create": False,
                        "update": True,
                        "delete": False,
                        "export": True
                    }
                }
            }
        }


class PermissionOperationResponse(BaseModel):
    """权限操作响应模型"""
    success: bool = Field(..., description="操作是否成功")
    message: str = Field(..., description="操作结果消息")
    affected_users: int = Field(..., description="受影响的用户数量")
    affected_permissions: int = Field(..., description="受影响的权限数量")
