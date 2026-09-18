"""
权限引擎核心逻辑
Permission Engine - 细粒度权限检查、缓存管理、数据隔离
"""
import asyncio
from time import monotonic
from typing import Optional, Dict, Set, Any, Iterable
from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import json
import redis.asyncio as redis

from app.core.config import settings
from app.core.database import get_db
from app.core.dependencies import get_current_active_user
from app.models.user import User, UserType
from app.models.permission import Permission, OperationType
from app.models.role_permission import RolePermission
from app.models.role_tag import RoleTag
from app.models.user_role_assignment import UserRoleAssignment

QUALITY_DASHBOARD_MODULE = "quality.data_panel"
QUALITY_DASHBOARD_READ_KEY = Permission.build_permission_key(
    QUALITY_DASHBOARD_MODULE,
    OperationType.READ.value
)
SUPPLIER_PERFORMANCE_MODULE = "supplier.performance"
SUPPLIER_PERFORMANCE_READ_KEY = Permission.build_permission_key(
    SUPPLIER_PERFORMANCE_MODULE,
    OperationType.READ.value
)


# Redis 客户端（用于权限缓存）
_redis_client: Optional[redis.Redis] = None
_redis_disabled_until = 0.0
REDIS_OPERATION_TIMEOUT_SECONDS = 0.25
REDIS_FAILURE_BACKOFF_SECONDS = 60.0


def _is_redis_temporarily_disabled() -> bool:
    return monotonic() < _redis_disabled_until


def _mark_redis_temporarily_disabled() -> None:
    global _redis_disabled_until
    _redis_disabled_until = monotonic() + REDIS_FAILURE_BACKOFF_SECONDS


async def get_redis_client() -> redis.Redis:
    """
    获取 Redis 客户端（单例模式）
    
    Returns:
        redis.Redis: Redis 异步客户端
    """
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
            socket_connect_timeout=REDIS_OPERATION_TIMEOUT_SECONDS,
            socket_timeout=REDIS_OPERATION_TIMEOUT_SECONDS,
            retry_on_timeout=False,
            health_check_interval=30,
        )
    return _redis_client


class PermissionChecker:
    """
    权限检查器
    
    提供细粒度的权限检查、用户权限获取、供应商数据隔离等核心功能。
    支持 Redis 缓存以提升性能。
    """
    
    # Redis 缓存配置
    CACHE_PREFIX = "perm:"
    CACHE_EXPIRE_SECONDS = 3600  # 1 小时
    
    @staticmethod
    async def check_permission(
        user_id: int,
        module_path: str,
        operation: OperationType,
        db: AsyncSession
    ) -> bool:
        """
        检查用户是否有权限执行指定操作
        
        优先从 Redis 缓存读取，缓存未命中时查询数据库并更新缓存。
        
        Args:
            user_id: 用户ID
            module_path: 功能模块路径（如："supplier.performance.monthly_score"）
            operation: 操作类型（create/read/update/delete/export）
            db: 数据库会话
            
        Returns:
            bool: True 表示有权限，False 表示无权限
            
        Example:
            has_perm = await PermissionChecker.check_permission(
                user_id=1,
                module_path="supplier.performance",
                operation=OperationType.READ,
                db=db
            )
        """
        # 构建权限键
        permission_key = Permission.build_permission_key(module_path, operation.value)
        
        # 尝试从缓存获取用户权限集合
        user_permissions = await PermissionChecker._get_cached_permissions(user_id)
        
        if user_permissions is None:
            # 缓存未命中，从数据库加载
            user_permissions = await PermissionChecker._load_permissions_from_db(user_id, db)
            # 更新缓存
            await PermissionChecker._cache_permissions(user_id, user_permissions)
        
        # 检查权限键是否在用户权限集合中
        if (
            module_path == QUALITY_DASHBOARD_MODULE
            and operation == OperationType.READ
            and await PermissionChecker._can_access_quality_dashboard(user_id, db)
        ):
            return True

        if (
            module_path == SUPPLIER_PERFORMANCE_MODULE
            and operation == OperationType.READ
            and await PermissionChecker._can_access_supplier_performance(user_id, db)
        ):
            return True

        return permission_key in user_permissions
    
    @staticmethod
    async def get_user_permissions(user_id: int, db: AsyncSession) -> Dict[str, Any]:
        """
        获取用户的所有权限（用于前端菜单渲染）
        
        返回结构化的权限树，方便前端根据权限动态渲染菜单和操作按钮。
        
        Args:
            user_id: 用户ID
            db: 数据库会话
            
        Returns:
            Dict: 权限字典，格式如下：
            {
                "supplier.performance": {
                    "read": True,
                    "create": False,
                    "update": True,
                    "delete": False,
                    "export": True
                },
                "quality.incoming": {
                    "read": True,
                    "create": True,
                    ...
                }
            }
        """
        # 尝试从缓存获取
        user_permissions = await PermissionChecker._get_cached_permissions(user_id)
        
        if user_permissions is None:
            # 缓存未命中，从数据库加载
            user_permissions = await PermissionChecker._load_permissions_from_db(user_id, db)
            # 更新缓存
            await PermissionChecker._cache_permissions(user_id, user_permissions)
        
        # 将扁平的权限集合转换为结构化的权限树
        if await PermissionChecker._can_access_quality_dashboard(user_id, db):
            user_permissions.add(QUALITY_DASHBOARD_READ_KEY)
        if await PermissionChecker._can_access_supplier_performance(user_id, db):
            user_permissions.add(SUPPLIER_PERFORMANCE_READ_KEY)

        permissions_tree: Dict[str, Dict[str, bool]] = {}
        
        for perm_key in user_permissions:
            # 解析权限键：module_path.operation_type
            parts = perm_key.rsplit(".", 1)
            if len(parts) == 2:
                module_path, operation = parts
                if module_path not in permissions_tree:
                    permissions_tree[module_path] = {}
                permissions_tree[module_path][operation] = True
        
        return permissions_tree
    
    @staticmethod
    async def filter_by_supplier(user: User, queryset: Any) -> Any:
        """
        供应商数据隔离过滤器
        
        如果用户是供应商类型，自动过滤查询结果，仅返回关联到该供应商的数据。
        
        Args:
            user: 当前用户对象
            queryset: SQLAlchemy 查询对象（需包含 supplier_id 字段）
            
        Returns:
            Any: 过滤后的查询对象
            
        Example:
            # 在 Service 层使用
            query = select(SomeModel)
            query = await PermissionChecker.filter_by_supplier(current_user, query)
            results = await db.execute(query)
        """
        if user.user_type == UserType.SUPPLIER and user.supplier_id is not None:
            # 供应商用户：仅返回关联到该供应商的数据
            # 假设查询对象有 filter 方法（适用于 SQLAlchemy Select）
            if hasattr(queryset, 'filter'):
                return queryset.filter_by(supplier_id=user.supplier_id)
            elif hasattr(queryset, 'where'):
                # 对于 select() 语句
                from sqlalchemy import Column
                # 动态获取 supplier_id 列
                # 注意：这里假设查询的模型有 supplier_id 属性
                return queryset.where(queryset.column_descriptions[0]['entity'].supplier_id == user.supplier_id)
        
        # 内部用户：返回所有数据
        return queryset
    
    @staticmethod
    async def clear_user_cache(user_id: int) -> None:
        """
        清除用户权限缓存
        
        当用户权限发生变更时调用，确保下次检查时重新加载最新权限。
        
        Args:
            user_id: 用户ID
        """
        try:
            if _is_redis_temporarily_disabled():
                return
            redis_client = await get_redis_client()
            cache_key = f"{PermissionChecker.CACHE_PREFIX}{user_id}"
            await asyncio.wait_for(
                redis_client.delete(cache_key),
                timeout=REDIS_OPERATION_TIMEOUT_SECONDS,
            )
        except Exception as e:
            _mark_redis_temporarily_disabled()
            # Redis 连接失败不应阻塞业务，仅记录日志
            print(f"Warning: Failed to clear permission cache for user {user_id}: {e}")

    @staticmethod
    async def clear_users_cache(user_ids: Iterable[int]) -> None:
        for user_id in set(user_ids):
            await PermissionChecker.clear_user_cache(user_id)
    
    # ========== 私有方法：缓存管理 ==========
    
    @staticmethod
    async def _get_cached_permissions(user_id: int) -> Optional[Set[str]]:
        """
        从 Redis 缓存获取用户权限集合
        
        Args:
            user_id: 用户ID
            
        Returns:
            Optional[Set[str]]: 权限键集合，缓存未命中时返回 None
        """
        try:
            if _is_redis_temporarily_disabled():
                return None
            redis_client = await get_redis_client()
            cache_key = f"{PermissionChecker.CACHE_PREFIX}{user_id}"
            cached_data = await asyncio.wait_for(
                redis_client.get(cache_key),
                timeout=REDIS_OPERATION_TIMEOUT_SECONDS,
            )
            
            if cached_data:
                # 反序列化 JSON 字符串为集合
                return set(json.loads(cached_data))
            
            return None
        except Exception as e:
            _mark_redis_temporarily_disabled()
            # Redis 连接失败不应阻塞业务，返回 None 触发数据库查询
            print(f"Warning: Failed to get cached permissions for user {user_id}: {e}")
            return None
    
    @staticmethod
    async def _cache_permissions(user_id: int, permissions: Set[str]) -> None:
        """
        将用户权限集合缓存到 Redis
        
        Args:
            user_id: 用户ID
            permissions: 权限键集合
        """
        try:
            if _is_redis_temporarily_disabled():
                return
            redis_client = await get_redis_client()
            cache_key = f"{PermissionChecker.CACHE_PREFIX}{user_id}"
            # 序列化集合为 JSON 字符串
            cached_data = json.dumps(list(permissions))
            await asyncio.wait_for(
                redis_client.setex(
                    cache_key,
                    PermissionChecker.CACHE_EXPIRE_SECONDS,
                    cached_data,
                ),
                timeout=REDIS_OPERATION_TIMEOUT_SECONDS,
            )
        except Exception as e:
            _mark_redis_temporarily_disabled()
            # Redis 连接失败不应阻塞业务，仅记录日志
            print(f"Warning: Failed to cache permissions for user {user_id}: {e}")
    
    @staticmethod
    async def _load_permissions_from_db(user_id: int, db: AsyncSession) -> Set[str]:
        """
        从数据库加载用户权限集合
        
        Args:
            user_id: 用户ID
            db: 数据库会话
            
        Returns:
            Set[str]: 权限键集合
        """
        # 查询用户的所有已授予权限
        stmt = select(Permission).where(
            Permission.user_id == user_id,
            Permission.is_granted == True
        )
        result = await db.execute(stmt)
        direct_permissions = result.scalars().all()

        role_stmt = (
            select(RolePermission)
            .join(UserRoleAssignment, UserRoleAssignment.role_tag_id == RolePermission.role_tag_id)
            .join(RoleTag, RoleTag.id == RolePermission.role_tag_id)
            .where(
                UserRoleAssignment.user_id == user_id,
                RoleTag.is_active == True,
                RolePermission.is_granted == True,
            )
        )
        role_result = await db.execute(role_stmt)
        role_permissions = role_result.scalars().all()

        # 构建权限键集合
        permission_keys = {perm.permission_key for perm in direct_permissions}
        permission_keys.update({perm.permission_key for perm in role_permissions})

        return permission_keys

    @staticmethod
    async def _can_access_quality_dashboard(user_id: int, db: AsyncSession) -> bool:
        user_result = await db.execute(select(User).where(User.id == user_id))
        user = user_result.scalar_one_or_none()
        if not user:
            return False

        return user.user_type in {UserType.INTERNAL, UserType.SUPPLIER}

    @staticmethod
    async def _can_access_supplier_performance(user_id: int, db: AsyncSession) -> bool:
        user_result = await db.execute(select(User).where(User.id == user_id))
        user = user_result.scalar_one_or_none()
        if not user:
            return False

        return user.user_type == UserType.SUPPLIER


def require_permission(module_path: str, operation: OperationType):
    """
    权限检查装饰器（FastAPI 依赖注入）
    
    用于保护需要特定权限的路由端点。
    如果用户没有所需权限，自动返回 403 Forbidden 错误。
    
    Args:
        module_path: 功能模块路径
        operation: 操作类型
        
    Returns:
        Callable: FastAPI 依赖注入函数
        
    Usage:
        @router.post("/suppliers")
        async def create_supplier(
            data: SupplierCreate,
            current_user: User = Depends(require_permission("supplier.management", OperationType.CREATE)),
            db: AsyncSession = Depends(get_db)
        ):
            # 只有拥有 "supplier.management.create" 权限的用户才能访问
            ...
    """
    async def permission_dependency(
        current_user: User = Depends(get_current_active_user),
        db: AsyncSession = Depends(get_db)
    ) -> User:
        """
        依赖注入函数：检查当前用户是否有权限
        
        Args:
            current_user: 当前激活用户
            db: 数据库会话
            
        Returns:
            User: 当前用户对象（权限检查通过）
            
        Raises:
            HTTPException: 权限不足时抛出 403 错误
        """
        has_permission = await PermissionChecker.check_permission(
            user_id=current_user.id,
            module_path=module_path,
            operation=operation,
            db=db
        )
        
        if not has_permission:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"权限不足：需要 '{module_path}.{operation.value}' 权限"
            )
        
        return current_user
    
    return permission_dependency


# ========== 便捷函数：快速权限检查 ==========

async def has_permission(
    user: User,
    module_path: str,
    operation: OperationType,
    db: AsyncSession
) -> bool:
    """
    便捷函数：检查用户是否有权限
    
    用于在业务逻辑中进行权限检查（非路由装饰器场景）。
    
    Args:
        user: 用户对象
        module_path: 功能模块路径
        operation: 操作类型
        db: 数据库会话
        
    Returns:
        bool: True 表示有权限，False 表示无权限
    """
    return await PermissionChecker.check_permission(
        user_id=user.id,
        module_path=module_path,
        operation=operation,
        db=db
    )


async def require_any_permission(
    user: User,
    permissions: list[tuple[str, OperationType]],
    db: AsyncSession
) -> bool:
    """
    便捷函数：检查用户是否拥有任意一个权限
    
    Args:
        user: 用户对象
        permissions: 权限列表，每个元素为 (module_path, operation) 元组
        db: 数据库会话
        
    Returns:
        bool: True 表示至少有一个权限，False 表示无任何权限
    """
    for module_path, operation in permissions:
        if await has_permission(user, module_path, operation, db):
            return True
    return False


async def require_all_permissions(
    user: User,
    permissions: list[tuple[str, OperationType]],
    db: AsyncSession
) -> bool:
    """
    便捷函数：检查用户是否拥有所有权限
    
    Args:
        user: 用户对象
        permissions: 权限列表，每个元素为 (module_path, operation) 元组
        db: 数据库会话
        
    Returns:
        bool: True 表示拥有所有权限，False 表示缺少至少一个权限
    """
    for module_path, operation in permissions:
        if not await has_permission(user, module_path, operation, db):
            return False
    return True
